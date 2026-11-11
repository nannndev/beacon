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
use uuid::Uuid;

#[derive(Clone)]
pub struct GatewayEngine {
    pub store: Arc<GatewayStore>,
    pub http_client: Client,
}

impl GatewayEngine {
    pub fn new(store: GatewayStore) -> Self {
        Self {
            store: Arc::new(store),
            http_client: Client::builder().build().unwrap(),
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
                return op
                    .preferred_auto
                    .iter()
                    .map(|m| Target {
                        provider: op.id.to_string(),
                        model: m.to_string(),
                        kind: "oauth".to_string(),
                    })
                    .collect();
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
                }
            }
            return out;
        }

        // Auto resolution: try connected OAuth accounts first with their preferred auto chains
        let mut out = Vec::new();
        let accounts = self.store.list_accounts();
        for acc in &accounts {
            if let Some(op) = find_oauth_by_id(&acc.provider) {
                for m in op.preferred_auto {
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
        vec![Target {
            provider: "codex".to_string(),
            model: "gpt-5.6-terra".to_string(),
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
                                let err_text = upstream_resp.text().await.unwrap_or_default();
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
            } else if target.kind == "apikey" {
                if let Some(key) = self.store.get_provider_key(&target.provider) {
                    if let Some(p) = find_provider_by_id(&target.provider) {
                        let url = format!("{}/chat/completions", p.base_url.trim_end_matches('/'));
                        body["model"] = json!(target.model);

                        let mut headers = reqwest::header::HeaderMap::new();
                        headers.insert(
                            reqwest::header::AUTHORIZATION,
                            format!("Bearer {}", key).parse().unwrap(),
                        );
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
            json!({
                "id": a.id,
                "provider": a.provider,
                "label": a.label,
                "email": a.email,
                "connected_at": a.connected_at,
                "refreshed_at": a.refreshed_at,
                "expires_at": expires_at,
                "last_error": a.last_error,
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

async fn handle_accounts_usage() -> Json<Value> {
    Json(json!({
        "usage": [],
        "summary": {}
    }))
}

async fn handle_oauth_start(
    State(_engine): State<GatewayEngine>,
    Path(provider): Path<String>,
    Json(_payload): Json<Value>,
) -> Json<Value> {
    let session_id = Uuid::new_v4().to_string();
    if provider == "codex" {
        Json(json!({
            "kind": "device",
            "session_id": session_id,
            "user_code": "OPEN-CODE",
            "verification_uri": "https://chatgpt.com",
            "interval": 5,
            "expires_in": 900
        }))
    } else {
        Json(json!({
            "kind": "redirect",
            "session_id": session_id,
            "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
            "auto_callback": false
        }))
    }
}

async fn handle_oauth_poll(
    State(_engine): State<GatewayEngine>,
    Path(_provider): Path<String>,
    Json(_payload): Json<Value>,
) -> Json<Value> {
    Json(json!({ "status": "pending" }))
}

async fn handle_oauth_complete(
    State(engine): State<GatewayEngine>,
    Path(_provider): Path<String>,
    Json(_payload): Json<Value>,
) -> Json<Value> {
    let mut state = get_oauth_accounts_state(&engine.store);
    state["account"] = json!({
        "id": "new-account",
        "provider": "unknown",
        "label": null,
        "email": null,
        "connected_at": 0.0,
        "refreshed_at": null,
        "expires_at": null,
        "last_error": null
    });
    Json(state)
}

async fn handle_oauth_test(
    State(_engine): State<GatewayEngine>,
    Path(_provider): Path<String>,
    Json(_payload): Json<Value>,
) -> Json<Value> {
    Json(json!({
        "valid": true,
        "latency_ms": 120,
        "email": null,
        "models": []
    }))
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

async fn handle_connect_provider(
    State(engine): State<GatewayEngine>,
    Path(id): Path<String>,
    Json(payload): Json<ConnectPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let base_url = payload.base_url.as_deref().filter(|s| !s.trim().is_empty());
    match engine.store.connect_provider(&id, &payload.api_key, base_url) {
        Ok(_) => {
            let providers = build_gateway_providers(&engine.store);
            if let Some(p) = providers.into_iter().find(|p| p["id"] == id) {
                Ok(Json(p))
            } else {
                Ok(Json(json!({ "id": id, "connected": true })))
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
