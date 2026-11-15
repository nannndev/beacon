use crate::providers::{
    find_oauth_by_alias, find_oauth_by_id, find_provider_by_id,
    parse_model_string, Target, OAUTH_PROVIDERS, PROVIDERS,
};
use crate::store::{AccountRecord, GatewayStore, ProviderRecord};
use crate::translate::{openai_to_codex, CodexStreamTranslator};
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{delete, get, patch, post, put},
    Router,
};
use futures::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Clone)]
pub struct GatewayEngine {
    pub store: Arc<GatewayStore>,
    pub http_client: Client,
    pub oauth: crate::oauth::OAuthManager,
}

impl GatewayEngine {
    pub fn new(store: GatewayStore) -> Self {
        Self {
            store: Arc::new(store),
            // Meta (Muse) answers UA-less requests with a 302 to a login page
            http_client: Client::builder().user_agent("Beacon/1.0").build().unwrap(),
            oauth: crate::oauth::OAuthManager::new(),
        }
    }

    pub fn resolve_targets(&self, requested: &str) -> Vec<Target> {
        let req = requested.trim();
        if let Some(combo_name) = req.strip_prefix("auto/") {
            let combos = self.store.list_combos();
            if let Some(targets_str) = combos.get(combo_name) {
                let mut out = Vec::new();
                for t in targets_str {
                    if let Ok(target) = parse_model_string(t) {
                        out.push(target);
                    }
                }
                if !out.is_empty() {
                    return out;
                }
            }
        }

        if req.ends_with("/auto") {
            let prefix = req.strip_suffix("/auto").unwrap();
            if let Some(op) = find_oauth_by_alias(prefix).or_else(|| find_oauth_by_id(prefix)) {
                let accounts = self.store.list_accounts();
                let matching: Vec<_> = accounts.iter().filter(|a| a.provider == op.id).collect();
                let is_all_free = matching.is_empty() || matching.iter().all(|a| a.is_free());

                let mut out = Vec::new();
                if is_all_free {
                    for m in op.preferred_auto_free {
                        out.push(Target {
                            provider: op.id.to_string(),
                            model: m.to_string(),
                            kind: "oauth".to_string(),
                        });
                    }
                } else {
                    for m in op.preferred_auto {
                        out.push(Target {
                            provider: op.id.to_string(),
                            model: m.to_string(),
                            kind: "oauth".to_string(),
                        });
                    }
                    for m in op.preferred_auto_free {
                        let t = Target {
                            provider: op.id.to_string(),
                            model: m.to_string(),
                            kind: "oauth".to_string(),
                        };
                        if !out.contains(&t) {
                            out.push(t);
                        }
                    }
                }
                return out;
            }
        }

        if let Ok(t) = parse_model_string(req) {
            let mut out = vec![t.clone()];
            if t.kind == "oauth" {
                if let Some(op) = find_oauth_by_id(&t.provider) {
                    for m in op.preferred_auto {
                        if *m != t.model {
                            out.push(Target {
                                provider: op.id.to_string(),
                                model: m.to_string(),
                                kind: "oauth".to_string(),
                            });
                        }
                    }
                    for m in op.preferred_auto_free {
                        let candidate = Target {
                            provider: op.id.to_string(),
                            model: m.to_string(),
                            kind: "oauth".to_string(),
                        };
                        if !out.contains(&candidate) {
                            out.push(candidate);
                        }
                    }
                }
            }
            return out;
        }

        // Auto resolution: try connected OAuth accounts first with their plan-aware chains
        let mut out = Vec::new();
        let accounts = self.store.list_accounts();
        for acc in &accounts {
            if let Some(op) = find_oauth_by_id(&acc.provider) {
                let is_free = acc.is_free();
                let models: Vec<&str> = if is_free {
                    op.preferred_auto_free.to_vec()
                } else {
                    let mut list = op.preferred_auto.to_vec();
                    for fm in op.preferred_auto_free {
                        if !list.contains(fm) {
                            list.push(fm);
                        }
                    }
                    list
                };
                for m in models {
                    let target = Target {
                        provider: op.id.to_string(),
                        model: m.to_string(),
                        kind: "oauth".to_string(),
                    };
                    if !out.contains(&target) {
                        out.push(target);
                    }
                }
            }
        }

        let api_providers = self.store.list_providers();
        for p in api_providers {
            if !p.enabled {
                continue;
            }
            if let Some(prov) = find_provider_by_id(&p.id) {
                for m in prov.seed_models {
                    let target = Target {
                        provider: prov.id.to_string(),
                        model: m.to_string(),
                        kind: "apikey".to_string(),
                    };
                    if !out.contains(&target) {
                        out.push(target);
                    }
                }
            }
        }

        if !out.is_empty() {
            return out;
        }

        // Fallback default
        let default_codex_model = "gpt-5.6-terra";
        vec![Target {
            provider: "codex".to_string(),
            model: default_codex_model.to_string(),
            kind: "oauth".to_string(),
        }]
    }

    pub async fn chat_completions(&self, mut body: Value) -> Result<Response, (StatusCode, Json<Value>)> {
        let req_model = body
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("auto")
            .to_string();

        let targets = self.resolve_targets(&req_model);
        let _stream = body.get("stream").and_then(|s| s.as_bool()).unwrap_or(false);

        let mut last_error = "No provider available".to_string();

        for target in &targets {
            if target.kind == "oauth" && target.provider == "codex" {
                let accounts = self.store.list_accounts();
                let codex_accounts: Vec<AccountRecord> = accounts
                    .into_iter()
                    .filter(|a| a.provider == "codex")
                    .collect();

                for acc in codex_accounts {
                    let token = match acc.cred.get("access_token").and_then(|t| t.as_str()) {
                        Some(tok) => tok.to_string(),
                        None => continue,
                    };
                    let account_id = acc.cred.get("account_id").and_then(|a| a.as_str()).map(|s| s.to_string());

                    let mut headers = reqwest::header::HeaderMap::new();
                    headers.insert(
                        reqwest::header::AUTHORIZATION,
                        format!("Bearer {}", token).parse().unwrap(),
                    );
                    headers.insert(
                        reqwest::header::CONTENT_TYPE,
                        "application/json".parse().unwrap(),
                    );
                    headers.insert(
                        reqwest::header::ACCEPT,
                        "text/event-stream".parse().unwrap(),
                    );
                    headers.insert("originator", "codex_cli_rs".parse().unwrap());
                    headers.insert("user-agent", "codex_cli_rs/0.101.0".parse().unwrap());
                    if let Some(ref aid) = account_id {
                        if let Ok(hdr_val) = aid.parse() {
                            headers.insert("chatgpt-account-id", hdr_val);
                        }
                    }

                    let codex_body = openai_to_codex(&body, &target.model);

                    let t0 = std::time::Instant::now();
                    let res = self
                        .http_client
                        .post("https://chatgpt.com/backend-api/codex/responses")
                        .headers(headers)
                        .json(&codex_body)
                        .send()
                        .await;

                    match res {
                        Ok(upstream_resp) => {
                            let status = upstream_resp.status();
                            if !status.is_success() {
                                let duration_ms = t0.elapsed().as_millis() as i64;
                                let err_text = upstream_resp.text().await.unwrap_or_default();
                                self.store.record_usage(
                                    None,
                                    Some("AI Copilot"),
                                    Some(&target.provider),
                                    Some(&target.model),
                                    120,
                                    0,
                                    duration_ms,
                                    "error",
                                    status.as_u16() as i64,
                                    Some(&err_text),
                                    true,
                                );
                                eprintln!("[GATEWAY CHAT] target={} acc={} status={} err={}", target.model, acc.email.as_deref().unwrap_or("?"), status, err_text);
                                // If plan error or rate limit, fallback to next candidate model
                                if err_text.contains("not in plan")
                                    || err_text.contains("not supported")
                                    || err_text.contains("model_not")
                                    || err_text.contains("upgrade your plan")
                                    || status.as_u16() == 404
                                    || status.as_u16() == 429
                                {
                                    last_error = format!("{}: model not in plan", target.model);
                                    continue;
                                }
                                last_error = format!("HTTP {}: {}", status, err_text);
                                continue;
                            }

                            let duration_ms = t0.elapsed().as_millis() as i64;
                            self.store.record_usage(
                                None,
                                Some("AI Copilot"),
                                Some(&target.provider),
                                Some(&target.model),
                                280,
                                420,
                                duration_ms,
                                "success",
                                200,
                                None,
                                true,
                            );

                            // Successful streaming translation
                            let mut translator = CodexStreamTranslator::new(target.public());
                            let start_frame = translator.start_chunk();

                            let stream_byte_stream = upstream_resp.bytes_stream().map(move |item| {
                                match item {
                                    Ok(bytes) => {
                                        let text = String::from_utf8_lossy(&bytes);
                                        let mut out = String::new();
                                        for line in text.lines() {
                                            let trimmed = line.trim();
                                            if let Some(data) = trimmed.strip_prefix("data:") {
                                                if let Ok(ev) = serde_json::from_str::<Value>(data.trim()) {
                                                    let frames = translator.feed(&ev);
                                                    for f in frames {
                                                        out.push_str(&f);
                                                    }
                                                }
                                            }
                                        }
                                        Ok::<_, std::io::Error>(axum::body::Bytes::from(out))
                                    }
                                    Err(e) => Err(std::io::Error::new(std::io::ErrorKind::Other, e)),
                                }
                            });

                            let full_stream = futures::stream::once(async move {
                                Ok(axum::body::Bytes::from(start_frame))
                            })
                            .chain(stream_byte_stream);

                            let body = Body::from_stream(full_stream);
                            return Ok(Response::builder()
                                .header("Content-Type", "text/event-stream")
                                .header("Cache-Control", "no-cache")
                                .body(body)
                                .unwrap());
                        }
                        Err(e) => {
                            last_error = e.to_string();
                        }
                    }
                }
            } else if target.kind == "oauth" {
                let accounts: Vec<AccountRecord> = self.store.list_accounts().into_iter().filter(|a| a.provider == target.provider).collect();
                for acc in accounts {
                    let t0 = std::time::Instant::now();
                    let mut resp = None;
                    // One forced refresh + retry when the upstream rejects the token.
                    for force in [false, true] {
                        let cred = match crate::oauth::fresh_credential(&self.http_client, &self.store, &acc, force).await {
                            Ok(c) => c,
                            Err(e) => { last_error = e; break; }
                        };
                        let Some((req, kind)) = crate::oauth::subscription_request(&self.http_client, &target.provider, &cred, &target.model, &body) else { break };
                        match req.send().await {
                            Ok(r) if r.status().as_u16() == 401 && !force => { last_error = format!("{}: 401", target.provider); continue; }
                            Ok(r) => { resp = Some((r, kind)); break; }
                            Err(e) => { last_error = format!("{}: {e}", target.provider); break; }
                        }
                    }
                    let Some((upstream, kind)) = resp else { continue };
                    let status = upstream.status();
                    if !status.is_success() {
                        let err_text = upstream.text().await.unwrap_or_default();
                        self.store.record_usage(None, Some("AI Copilot"), Some(&target.provider), Some(&target.model), 0, 0, t0.elapsed().as_millis() as i64, "error", status.as_u16() as i64, Some(&err_text), true);
                        last_error = format!("{} HTTP {}: {}", target.public(), status, err_text.chars().take(300).collect::<String>());
                        continue;
                    }
                    self.store.record_usage(None, Some("AI Copilot"), Some(&target.provider), Some(&target.model), 0, 0, t0.elapsed().as_millis() as i64, "success", 200, None, true);
                    let byte_stream: futures::stream::BoxStream<'static, Result<axum::body::Bytes, std::io::Error>> = if kind == "openai" {
                        upstream.bytes_stream().map(|b| b.map_err(std::io::Error::other)).boxed()
                    } else {
                        let mut tr = crate::translate::SseToOpenAi::new(kind, target.public());
                        let start = tr.base.start_chunk();
                        let mut buf = String::new();
                        let events = upstream.bytes_stream().map(move |item| {
                            let bytes = item.map_err(std::io::Error::other)?;
                            buf.push_str(&String::from_utf8_lossy(&bytes));
                            let mut out = String::new();
                            // SSE events can span network chunks: only consume complete lines.
                            while let Some(i) = buf.find('\n') {
                                let line: String = buf.drain(..=i).collect();
                                if let Some(data) = line.trim().strip_prefix("data:") {
                                    if let Ok(ev) = serde_json::from_str::<Value>(data.trim()) {
                                        match tr.feed(&ev) {
                                            Ok(frames) => out.extend(frames),
                                            Err(e) => out.push_str(&format!("data: {}\n\n", json!({ "error": { "message": e } }))),
                                        }
                                    }
                                }
                            }
                            Ok(axum::body::Bytes::from(out))
                        });
                        futures::stream::once(async move { Ok(axum::body::Bytes::from(start)) })
                            .chain(events)
                            .boxed()
                    };
                    return Ok(Response::builder()
                        .header("Content-Type", "text/event-stream")
                        .header("Cache-Control", "no-cache")
                        .body(Body::from_stream(byte_stream))
                        .unwrap());
                }
            } else if target.kind == "apikey" {
                if let Some(key) = self.store.get_provider_key(&target.provider) {
                    if let Some(p) = find_provider_by_id(&target.provider) {
                        let base = self.store.get_provider_record(&target.provider)
                            .and_then(|r| r.base_url)
                            .filter(|s| !s.trim().is_empty())
                            .unwrap_or_else(|| p.base_url.to_string());
                        let url = format!("{}/chat/completions", base.trim_end_matches('/'));
                        body["model"] = json!(target.model);

                        let mut headers = reqwest::header::HeaderMap::new();
                        if target.provider == "anthropic" || p.family == "anthropic" {
                            if let Ok(val) = key.parse() {
                                headers.insert("x-api-key", val);
                            }
                            if let Ok(ver) = "2023-06-01".parse() {
                                headers.insert("anthropic-version", ver);
                            }
                        } else {
                            if let Ok(val) = format!("Bearer {}", key).parse() {
                                headers.insert(reqwest::header::AUTHORIZATION, val);
                            }
                        }
                        headers.insert(
                            reqwest::header::CONTENT_TYPE,
                            "application/json".parse().unwrap(),
                        );

                        if let Ok(resp) = self
                            .http_client
                            .post(&url)
                            .headers(headers)
                            .json(&body)
                            .send()
                            .await
                        {
                            if resp.status().is_success() {
                                let bytes_stream = resp.bytes_stream().map(|b| {
                                    b.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
                                });
                                let body = Body::from_stream(bytes_stream);
                                return Ok(Response::builder()
                                    .header("Content-Type", "text/event-stream")
                                    .body(body)
                                    .unwrap());
                            }
                        }
                    }
                }
            }
        }

        Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "error": {
                    "message": format!("No connected AI provider could respond: {}", last_error),
                    "type": "gateway_error",
                }
            })),
        ))
    }
}

// ---------------------------------------------------------------------
// Helper builders for Client-compatible responses
// ---------------------------------------------------------------------
pub fn get_oauth_accounts_state(store: &GatewayStore) -> Value {
    let accounts = store.list_accounts();
    let client_accounts: Vec<Value> = accounts
        .into_iter()
        .map(|a| {
            let expires_at = a.cred.get("expires_at").and_then(|v| v.as_f64());
            let plan = a.display_plan();
            let is_free = a.is_free();
            json!({
                "id": a.id,
                "provider": a.provider,
                "label": a.label,
                "email": a.email,
                "connected_at": a.connected_at,
                "refreshed_at": a.refreshed_at,
                "expires_at": expires_at,
                "last_error": a.last_error,
                "plan": plan,
                "is_free": is_free,
            })
        })
        .collect();

    let mut models_map = serde_json::Map::new();
    let mut aliases_map = serde_json::Map::new();
    for op in OAUTH_PROVIDERS {
        models_map.insert(op.id.to_string(), json!(op.seed_models));
        aliases_map.insert(op.id.to_string(), json!(op.alias));
    }

    let settings = store.get_gateway_settings();

    json!({
        "accounts": client_accounts,
        "models": models_map,
        "aliases": aliases_map,
        "providers": OAUTH_PROVIDERS,
        "settings": settings,
    })
}

pub fn build_gateway_providers(store: &GatewayStore) -> Vec<Value> {
    let stored_records = store.list_providers();
    let record_map: std::collections::HashMap<String, ProviderRecord> = stored_records
        .into_iter()
        .map(|r| (r.id.clone(), r))
        .collect();

    let mut out = Vec::new();
    for p in PROVIDERS {
        let rec = record_map.get(p.id);
        let connected = rec.map(|r| r.has_key).unwrap_or(false) || !p.needs_key;
        let base_url = rec.and_then(|r| r.base_url.clone());
        let verified_at = rec.and_then(|r| r.verified_at);
        let latency_ms = rec.and_then(|r| r.latency_ms);
        let error = rec.and_then(|r| r.error.clone());
        let models: Vec<String> = rec
            .map(|r| r.models.clone())
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| p.seed_models.iter().map(|s| s.to_string()).collect());

        out.push(json!({
            "id": p.id,
            "alias": p.alias,
            "name": p.name,
            "family": p.family,
            "default_base_url": p.base_url,
            "needs_key": p.needs_key,
            "connected": connected,
            "base_url": base_url,
            "api_key": if connected && p.needs_key { Some("••••••••") } else { None },
            "models": models,
            "seed_models": p.seed_models,
            "verified_at": verified_at,
            "latency_ms": latency_ms,
            "cooling": false,
            "error": error,
        }));
    }
    out
}

// ---------------------------------------------------------------------
// Axum Router for Gateway API
// ---------------------------------------------------------------------
pub fn gateway_router(engine: GatewayEngine) -> Router {
    Router::new()
        // Core chat completions & health
        .route("/v1/chat/completions", post(handle_chat_completions))
        .route("/gateway/v1/chat/completions", post(handle_chat_completions))
        .route("/v1/models", get(handle_list_models_v1))
        .route("/gateway/v1/models", get(handle_list_models_v1))
        .route("/gateway/health", get(handle_health))

        // Accounts (OAuth)
        .route("/gateway/admin/accounts", get(handle_list_accounts).post(handle_save_account))
        .route("/gateway/admin/accounts/usage", get(handle_accounts_usage))
        .route("/gateway/admin/accounts/:provider", delete(handle_delete_account_by_query))
        .route("/gateway/admin/accounts/:provider/:id", delete(handle_remove_account))
        .route("/gateway/admin/accounts/:provider/reorder", post(handle_reorder_accounts))
        .route("/gateway/admin/accounts/:provider/start", post(handle_oauth_start))
        .route("/gateway/admin/accounts/:provider/complete", post(handle_oauth_complete))
        .route("/gateway/admin/accounts/:provider/poll", post(handle_oauth_poll))
        .route("/gateway/admin/accounts/:provider/test", post(handle_oauth_test))

        // Providers
        .route("/gateway/admin/providers", get(handle_list_providers))
        .route("/gateway/admin/providers/:id/connect", post(handle_connect_provider))
        .route("/gateway/admin/providers/:id/disconnect", post(handle_disconnect_provider))
        .route("/gateway/admin/providers/:id/key", post(handle_save_provider_key))

        // Virtual Keys
        .route("/gateway/admin/keys", get(handle_list_keys).post(handle_create_key))
        .route("/gateway/admin/keys/:id/toggle", patch(handle_toggle_key))
        .route("/gateway/admin/keys/:id", delete(handle_delete_key))

        // Combos
        .route("/gateway/admin/combos", get(handle_list_combos).post(handle_save_combo))
        .route("/gateway/admin/combos/:name", put(handle_put_combo).delete(handle_delete_combo))

        // Models
        .route("/gateway/admin/models", get(handle_admin_models))

        // Usage & Stats
        .route("/gateway/admin/usage", get(handle_list_usage).delete(handle_clear_usage))
        .route("/gateway/admin/stats", get(handle_get_stats))

        // Settings
        .route("/gateway/admin/settings", get(handle_get_settings).post(handle_update_settings))
        .with_state(engine)
}

async fn handle_chat_completions(
    State(engine): State<GatewayEngine>,
    Json(payload): Json<Value>,
) -> impl IntoResponse {
    engine.chat_completions(payload).await
}

async fn handle_health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn handle_list_models_v1() -> Json<Value> {
    let mut data = Vec::new();
    for op in OAUTH_PROVIDERS {
        for m in op.seed_models {
            data.push(json!({
                "id": format!("{}/{}", op.alias, m),
                "object": "model",
                "owned_by": op.id,
            }));
        }
    }
    for p in PROVIDERS {
        for m in p.seed_models {
            data.push(json!({
                "id": format!("{}/{}", p.alias, m),
                "object": "model",
                "owned_by": p.id,
            }));
        }
    }
    Json(json!({ "object": "list", "data": data }))
}

async fn handle_admin_models() -> Json<Value> {
    let mut models = Vec::new();
    for op in OAUTH_PROVIDERS {
        for m in op.seed_models {
            models.push(json!({
                "id": format!("{}/{}", op.alias, m),
                "owned_by": op.id,
            }));
        }
    }
    for p in PROVIDERS {
        for m in p.seed_models {
            models.push(json!({
                "id": format!("{}/{}", p.alias, m),
                "owned_by": p.id,
            }));
        }
    }
    Json(json!({ "models": models }))
}

async fn handle_list_accounts(State(engine): State<GatewayEngine>) -> Json<Value> {
    Json(get_oauth_accounts_state(&engine.store))
}

async fn handle_save_account(
    State(engine): State<GatewayEngine>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let provider = payload.get("provider").and_then(|p| p.as_str()).unwrap_or("");
    let cred = payload.get("cred").cloned().unwrap_or(json!({}));
    let label = payload.get("label").and_then(|l| l.as_str());
    let email = payload.get("email").and_then(|e| e.as_str());

    match engine.store.save_account(provider, &cred, label, email) {
        Ok(id) => Ok(Json(json!({ "status": "saved", "id": id }))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": e })),
        )),
    }
}

async fn handle_remove_account(
    State(engine): State<GatewayEngine>,
    Path((provider, id)): Path<(String, String)>,
) -> Json<Value> {
    let _ = engine.store.remove_account(&provider, Some(&id));
    Json(get_oauth_accounts_state(&engine.store))
}

#[derive(Deserialize)]
struct AccountDeleteQuery {
    account_id: Option<String>,
}

async fn handle_delete_account_by_query(
    State(engine): State<GatewayEngine>,
    Path(provider): Path<String>,
    Query(query): Query<AccountDeleteQuery>,
) -> Json<Value> {
    let _ = engine.store.remove_account(&provider, query.account_id.as_deref());
    Json(get_oauth_accounts_state(&engine.store))
}

#[derive(Deserialize)]
struct ReorderPayload {
    account_ids: Vec<String>,
}

async fn handle_reorder_accounts(
    State(engine): State<GatewayEngine>,
    Path(provider): Path<String>,
    Json(payload): Json<ReorderPayload>,
) -> Json<Value> {
    let _ = engine.store.reorder_accounts(&provider, &payload.account_ids);
    Json(get_oauth_accounts_state(&engine.store))
}

async fn handle_accounts_usage(State(engine): State<GatewayEngine>) -> Json<Value> {
    let accounts = engine.store.list_accounts();
    let mut usage = Vec::new();
    for a in &accounts {
        usage.push(json!({
            "provider": a.provider,
            "account_id": a.id,
            "email": a.email,
            "last_error": a.last_error,
            "plan": a.display_plan(),
            "windows": [],
            "limit_reached": false,
            "fetched_at": crate::store::now(),
        }));
    }
    Json(json!({
        "usage": usage,
        "summary": {}
    }))
}

#[derive(Deserialize)]
struct OAuthStartPayload {
    account_id: Option<String>,
    #[allow(dead_code)]
    label: Option<String>,
    gemini_oauth_client_id: Option<String>,
    gemini_oauth_client_secret: Option<String>,
}

async fn handle_oauth_start(
    State(engine): State<GatewayEngine>,
    Path(provider): Path<String>,
    Json(payload): Json<OAuthStartPayload>,
) -> (StatusCode, Json<Value>) {
    if let Some(ref cid) = payload.gemini_oauth_client_id {
        let _ = engine.store.set_setting("gemini_oauth_client_id", cid);
    }
    if let Some(ref sec) = payload.gemini_oauth_client_secret {
        let _ = engine.store.set_setting("gemini_oauth_client_secret", sec);
    }

    match provider.as_str() {
        "copilot" => {
            match crate::oauth::start_copilot_device_flow(&engine.http_client, &engine.oauth, payload.account_id).await {
                Ok(val) => (StatusCode::OK, Json(val)),
                Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e, "message": e }))),
            }
        }
        "claude" => {
            let val = crate::oauth::start_claude_pkce_flow(&engine.http_client, &engine.oauth, &engine.store, payload.account_id).await;
            (StatusCode::OK, Json(val))
        }
        "codex" => {
            let val = crate::oauth::start_codex_pkce_flow(&engine.http_client, &engine.oauth, &engine.store, payload.account_id).await;
            (StatusCode::OK, Json(val))
        }
        "gemini-cli" => {
            match crate::oauth::start_gemini_cli_flow(&engine.http_client, &engine.oauth, &engine.store, payload.account_id).await {
                Ok(val) => (StatusCode::OK, Json(val)),
                Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e, "message": e }))),
            }
        }
        _ => {
            match crate::oauth::start_device_flow(&engine.http_client, &engine.oauth, &provider, payload.account_id).await {
                Ok(val) => (StatusCode::OK, Json(val)),
                Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e, "message": e }))),
            }
        }
    }
}

#[derive(Deserialize)]
struct OAuthPollPayload {
    session_id: String,
    #[allow(dead_code)]
    account_id: Option<String>,
    #[allow(dead_code)]
    label: Option<String>,
}

async fn handle_oauth_poll(
    State(engine): State<GatewayEngine>,
    Path(provider): Path<String>,
    Json(payload): Json<OAuthPollPayload>,
) -> (StatusCode, Json<Value>) {
    let polled = if provider == "copilot" {
        crate::oauth::poll_copilot_device_flow(&engine.http_client, &engine.oauth, &engine.store, &payload.session_id).await
    } else {
        crate::oauth::poll_device_flow(&engine.http_client, &engine.oauth, &engine.store, &payload.session_id).await
    };
    match provider.as_str() {
        _ => {
            match polled {
                Ok(res) => {
                    if res.get("status").and_then(|v| v.as_str()) == Some("done") {
                        let mut state = get_oauth_accounts_state(&engine.store);
                        state["status"] = json!("done");
                        let accounts = engine.store.list_accounts();
                        if let Some(acc) = accounts.iter().rev().find(|a| a.provider == provider) {
                            state["account"] = json!({
                                "id": acc.id,
                                "provider": acc.provider,
                                "label": acc.label,
                                "email": acc.email,
                                "connected_at": acc.connected_at,
                                "refreshed_at": acc.refreshed_at,
                                "expires_at": null,
                                "last_error": acc.last_error,
                            });
                        }
                        (StatusCode::OK, Json(state))
                    } else {
                        (StatusCode::OK, Json(res))
                    }
                }
                Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "status": "error", "error": e, "message": e }))),
            }
        }
    }
}

#[derive(Deserialize)]
struct OAuthCompletePayload {
    session_id: String,
    callback: String,
    account_id: Option<String>,
    #[allow(dead_code)]
    label: Option<String>,
}

async fn handle_oauth_complete(
    State(engine): State<GatewayEngine>,
    Path(provider): Path<String>,
    Json(payload): Json<OAuthCompletePayload>,
) -> (StatusCode, Json<Value>) {
    let target_id = payload.account_id.as_deref();
    let res = match provider.as_str() {
        "claude" => {
            crate::oauth::complete_claude_pkce_flow(
                &engine.http_client,
                &engine.oauth,
                &engine.store,
                &payload.session_id,
                &payload.callback,
                target_id,
            ).await
        }
        "codex" => {
            crate::oauth::complete_codex_pkce_flow(
                &engine.http_client,
                &engine.oauth,
                &engine.store,
                &payload.session_id,
                &payload.callback,
                target_id,
            ).await
        }
        "gemini-cli" => {
            crate::oauth::complete_gemini_cli_flow(
                &engine.http_client,
                &engine.oauth,
                &engine.store,
                &payload.session_id,
                &payload.callback,
                target_id,
            ).await
        }
        _ => {
            crate::oauth::complete_generic_token_flow(
                &engine.store,
                &provider,
                &payload.callback,
                target_id,
            ).await
        }
    };

    match res {
        Ok(_) => {
            let mut state = get_oauth_accounts_state(&engine.store);
            let accounts = engine.store.list_accounts();
            if let Some(acc) = accounts.iter().rev().find(|a| a.provider == provider) {
                state["account"] = json!({
                    "id": acc.id,
                    "provider": acc.provider,
                    "label": acc.label,
                    "email": acc.email,
                    "connected_at": acc.connected_at,
                    "refreshed_at": acc.refreshed_at,
                    "expires_at": null,
                    "last_error": acc.last_error,
                });
            }
            (StatusCode::OK, Json(state))
        }
        Err(err) => (StatusCode::BAD_REQUEST, Json(json!({ "error": err, "message": err }))),
    }
}

#[derive(Deserialize)]
struct OAuthTestPayload {
    account_id: Option<String>,
}

async fn handle_oauth_test(
    State(engine): State<GatewayEngine>,
    Path(provider): Path<String>,
    Json(payload): Json<OAuthTestPayload>,
) -> Json<Value> {
    let accounts = engine.store.list_accounts();
    let target_account = if let Some(ref aid) = payload.account_id {
        accounts.into_iter().find(|a| a.provider == provider && a.id == *aid)
    } else {
        accounts.into_iter().find(|a| a.provider == provider)
    };

    if let Some(account) = target_account {
        let val = crate::oauth::test_oauth_account(&engine.http_client, &account).await;
        Json(val)
    } else {
        Json(json!({
            "valid": false,
            "error": format!("No connected account found for provider '{}'", provider)
        }))
    }
}

async fn handle_list_providers(State(engine): State<GatewayEngine>) -> Json<Value> {
    Json(json!({
        "providers": build_gateway_providers(&engine.store)
    }))
}

#[derive(Deserialize)]
struct ConnectPayload {
    api_key: String,
    base_url: Option<String>,
}

async fn verify_upstream_provider(
    client: &reqwest::Client,
    provider_id: &str,
    api_key: &str,
    base_url: &str,
) -> Result<i64, String> {
    let t0 = std::time::Instant::now();
    let trimmed_key = api_key.trim();
    let trimmed_base = base_url.trim_end_matches('/');

    let res = if provider_id == "ollama" {
        let url = format!("{}/api/tags", trimmed_base);
        client.get(&url).timeout(std::time::Duration::from_secs(5)).send().await
    } else if provider_id == "anthropic" {
        let url = if trimmed_base.ends_with("/v1") {
            format!("{}/messages", trimmed_base)
        } else {
            format!("{}/v1/messages", trimmed_base)
        };
        client
            .post(&url)
            .header("x-api-key", trimmed_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&json!({
                "model": "claude-3-5-haiku-20241022",
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "ping"}]
            }))
            .timeout(std::time::Duration::from_secs(8))
            .send()
            .await
    } else {
        let url = format!("{}/models", trimmed_base);
        let mut req = client.get(&url).timeout(std::time::Duration::from_secs(8));
        if !trimmed_key.is_empty() {
            req = req.header(reqwest::header::AUTHORIZATION, format!("Bearer {}", trimmed_key));
        }
        req.send().await
    };

    match res {
        Ok(resp) => {
            let latency_ms = t0.elapsed().as_millis() as i64;
            let status = resp.status();
            if status.is_success() {
                Ok(latency_ms)
            } else if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                let err_text = resp.text().await.unwrap_or_default();
                let detail = serde_json::from_str::<Value>(&err_text)
                    .ok()
                    .and_then(|v| {
                        v.get("error")
                            .and_then(|e| e.get("message"))
                            .and_then(|m| m.as_str())
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_else(|| format!("HTTP {} - invalid credentials", status));
                Err(format!("Authentication failed: {}", detail))
            } else {
                let err_text = resp.text().await.unwrap_or_default();
                let detail = serde_json::from_str::<Value>(&err_text)
                    .ok()
                    .and_then(|v| {
                        v.get("error")
                            .and_then(|e| e.get("message"))
                            .and_then(|m| m.as_str())
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_else(|| format!("HTTP {}", status));
                if status.as_u16() >= 400 && status.as_u16() < 500 && status != reqwest::StatusCode::NOT_FOUND {
                    Err(format!("Provider rejected key: {}", detail))
                } else {
                    Ok(latency_ms)
                }
            }
        }
        Err(e) => Err(format!("Connection check failed: {}", e)),
    }
}

async fn handle_connect_provider(
    State(engine): State<GatewayEngine>,
    Path(id): Path<String>,
    Json(payload): Json<ConnectPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let prov = find_provider_by_id(&id);
    let default_base = prov.map(|p| p.base_url).unwrap_or("");
    let custom_base = payload.base_url.as_deref().filter(|s| !s.trim().is_empty());
    let base_url = custom_base.unwrap_or(default_base);
    let api_key = payload.api_key.trim();

    if prov.map(|p| p.needs_key).unwrap_or(true) && api_key.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "detail": format!("API key is required for {}", prov.map(|p| p.name).unwrap_or(&id)) })),
        ));
    }

    let mut latency_ms: Option<i64> = None;
    if !base_url.is_empty() {
        match verify_upstream_provider(&engine.http_client, &id, api_key, base_url).await {
            Ok(lat) => {
                latency_ms = Some(lat);
            }
            Err(e) => {
                return Err((StatusCode::BAD_REQUEST, Json(json!({ "detail": e }))));
            }
        }
    }

    match engine.store.connect_provider(&id, api_key, custom_base) {
        Ok(_) => {
            let _ = engine.store.set_provider_verification(&id, latency_ms, None);
            let providers = build_gateway_providers(&engine.store);
            if let Some(p) = providers.into_iter().find(|p| p["id"] == id) {
                Ok(Json(p))
            } else {
                Ok(Json(json!({ "id": id, "connected": true, "latency_ms": latency_ms })))
            }
        }
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(json!({ "detail": e })))),
    }
}

async fn handle_disconnect_provider(
    State(engine): State<GatewayEngine>,
    Path(id): Path<String>,
) -> Json<Value> {
    let _ = engine.store.disconnect_provider(&id);
    let providers = build_gateway_providers(&engine.store);
    if let Some(p) = providers.into_iter().find(|p| p["id"] == id) {
        Json(p)
    } else {
        Json(json!({ "id": id, "connected": false }))
    }
}

async fn handle_save_provider_key(
    State(engine): State<GatewayEngine>,
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let key = payload.get("key").and_then(|k| k.as_str()).unwrap_or("");
    match engine.store.save_provider_key(&id, key) {
        Ok(_) => Ok(Json(json!({ "status": "saved" }))),
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(json!({ "detail": e })))),
    }
}

async fn handle_list_keys(State(engine): State<GatewayEngine>) -> Json<Value> {
    Json(json!({ "keys": engine.store.list_virtual_keys() }))
}

#[derive(Deserialize)]
struct CreateKeyPayload {
    name: String,
    allowed_providers: Option<Vec<String>>,
    rate_limit_per_min: Option<i64>,
}

async fn handle_create_key(
    State(engine): State<GatewayEngine>,
    Json(payload): Json<CreateKeyPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    match engine.store.create_virtual_key(&payload.name, payload.allowed_providers, payload.rate_limit_per_min) {
        Ok((record, secret)) => {
            let mut val = serde_json::to_value(&record).unwrap();
            val["key"] = json!(secret);
            Ok(Json(json!({ "key": val })))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "detail": e })))),
    }
}

async fn handle_toggle_key(
    State(engine): State<GatewayEngine>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    match engine.store.toggle_virtual_key(&id) {
        Ok(record) => Ok(Json(json!({ "key": record }))),
        Err(e) => Err((StatusCode::NOT_FOUND, Json(json!({ "detail": e })))),
    }
}

async fn handle_delete_key(
    State(engine): State<GatewayEngine>,
    Path(id): Path<String>,
) -> Json<Value> {
    let _ = engine.store.delete_virtual_key(&id);
    Json(json!({ "status": "deleted" }))
}

async fn handle_list_combos(State(engine): State<GatewayEngine>) -> Json<Value> {
    Json(json!({ "combos": engine.store.list_combos() }))
}

async fn handle_save_combo(
    State(engine): State<GatewayEngine>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let name = payload.get("name").and_then(|n| n.as_str()).unwrap_or("");
    let targets: Vec<String> = payload
        .get("targets")
        .and_then(|t| serde_json::from_value(t.clone()).ok())
        .unwrap_or_default();

    match engine.store.save_combo(name, &targets) {
        Ok(_) => Ok(Json(json!({ "combos": engine.store.list_combos() }))),
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(json!({ "detail": e })))),
    }
}

async fn handle_put_combo(
    State(engine): State<GatewayEngine>,
    Path(name): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let targets: Vec<String> = payload
        .get("targets")
        .and_then(|t| serde_json::from_value(t.clone()).ok())
        .unwrap_or_default();

    match engine.store.save_combo(&name, &targets) {
        Ok(_) => Ok(Json(json!({ "combos": engine.store.list_combos() }))),
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(json!({ "detail": e })))),
    }
}

async fn handle_delete_combo(
    State(engine): State<GatewayEngine>,
    Path(name): Path<String>,
) -> Json<Value> {
    let _ = engine.store.delete_combo(&name);
    Json(json!({ "combos": engine.store.list_combos() }))
}

#[derive(Deserialize)]
struct UsageQuery {
    limit: Option<i64>,
}

async fn handle_list_usage(
    State(engine): State<GatewayEngine>,
    Query(query): Query<UsageQuery>,
) -> Json<Value> {
    let limit = query.limit.unwrap_or(100);
    Json(json!({ "usage": engine.store.list_usage(limit) }))
}

async fn handle_clear_usage(
    State(engine): State<GatewayEngine>,
) -> Json<Value> {
    let _ = engine.store.clear_usage();
    Json(json!({ "status": "cleared" }))
}

async fn handle_get_stats(
    State(engine): State<GatewayEngine>,
) -> Json<Value> {
    Json(engine.store.get_stats())
}

async fn handle_get_settings(
    State(engine): State<GatewayEngine>,
) -> Json<Value> {
    Json(json!({ "settings": engine.store.get_gateway_settings() }))
}

#[derive(Deserialize)]
struct UpdateSettingsPayload {
    routing_strategy: Option<String>,
    gemini_oauth_client_id: Option<String>,
    gemini_oauth_client_secret: Option<String>,
    clear_gemini_secret: Option<bool>,
}

async fn handle_update_settings(
    State(engine): State<GatewayEngine>,
    Json(payload): Json<UpdateSettingsPayload>,
) -> Json<Value> {
    if let Some(strategy) = payload.routing_strategy {
        let _ = engine.store.set_setting("routing_strategy", &strategy);
    }
    if let Some(client_id) = payload.gemini_oauth_client_id {
        let _ = engine.store.set_setting("gemini_oauth_client_id", &client_id);
    }
    if payload.clear_gemini_secret == Some(true) {
        let _ = engine.store.set_setting("gemini_oauth_client_secret", "");
    } else if let Some(secret) = payload.gemini_oauth_client_secret {
        if !secret.trim().is_empty() {
            let _ = engine.store.set_setting("gemini_oauth_client_secret", &secret);
        }
    }
    Json(json!({ "settings": engine.store.get_gateway_settings() }))
}
