use crate::providers::{
    find_oauth_by_alias, find_oauth_by_id, find_provider_by_id,
    parse_model_string, Target, OAUTH_PROVIDERS, PROVIDERS,
};
use crate::store::{AccountRecord, GatewayStore};
use crate::translate::{openai_to_codex, CodexStreamTranslator};
use axum::{
    body::Body,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{delete, get, post},
    Router,
};
use futures::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::Arc;

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
// Axum Router for Gateway API
// ---------------------------------------------------------------------
pub fn gateway_router(engine: GatewayEngine) -> Router {
    Router::new()
        .route("/v1/chat/completions", post(handle_chat_completions))
        .route("/v1/models", get(handle_list_models))
        .route("/gateway/admin/accounts", get(handle_list_accounts).post(handle_save_account))
        .route("/gateway/admin/accounts/:provider/:id", delete(handle_remove_account))
        .route("/gateway/admin/providers", get(handle_list_providers))
        .route("/gateway/admin/providers/:id/key", post(handle_save_provider_key))
        .route("/gateway/admin/combos", get(handle_list_combos).post(handle_save_combo))
        .route("/gateway/admin/combos/:name", delete(handle_delete_combo))
        .with_state(engine)
}

async fn handle_chat_completions(
    State(engine): State<GatewayEngine>,
    Json(payload): Json<Value>,
) -> impl IntoResponse {
    engine.chat_completions(payload).await
}

async fn handle_list_models() -> Json<Value> {
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

async fn handle_list_accounts(State(engine): State<GatewayEngine>) -> Json<Vec<AccountRecord>> {
    Json(engine.store.list_accounts())
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
    Json(json!({ "status": "deleted" }))
}

async fn handle_list_providers(State(engine): State<GatewayEngine>) -> Json<Value> {
    Json(json!({
        "providers": engine.store.list_providers()
    }))
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

async fn handle_list_combos(State(engine): State<GatewayEngine>) -> Json<Value> {
    Json(json!(engine.store.list_combos()))
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
        Ok(_) => Ok(Json(json!({ "status": "saved" }))),
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(json!({ "detail": e })))),
    }
}

async fn handle_delete_combo(
    State(engine): State<GatewayEngine>,
    Path(name): Path<String>,
) -> Json<Value> {
    let _ = engine.store.delete_combo(&name);
    Json(json!({ "status": "deleted" }))
}
