pub mod orchestrator;
pub mod prompt;
pub mod tools;

pub use orchestrator::AgentOrchestrator;
pub use prompt::BEACON_AGENT_SYSTEM_PROMPT;
pub use tools::{agent_tool_definitions, execute_tool};

use axum::{
    extract::State,
    response::sse::{KeepAlive, Sse},
    response::Json,
    routing::{get, post},
    Router,
};
use beacon_core::TestConfig;
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Clone)]
pub struct AgentState {
    pub orchestrator: Arc<AgentOrchestrator>,
    pub get_config: Arc<dyn Fn() -> TestConfig + Send + Sync>,
}

pub fn agent_router(state: AgentState) -> Router {
    Router::new()
        .route("/agent/chat", post(handle_agent_chat))
        .route("/agent/models", get(handle_agent_models))
        .route("/agent/context", get(handle_agent_context))
        .with_state(state)
}

async fn handle_agent_chat(
    State(state): State<AgentState>,
    Json(payload): Json<Value>,
) -> Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>> {
    let messages: Vec<Value> = payload
        .get("messages")
        .and_then(|m| serde_json::from_value(m.clone()).ok())
        .unwrap_or_default();
    let model = payload.get("model").and_then(|m| m.as_str()).map(String::from);
    let config = (state.get_config)();

    let stream = state.orchestrator.run_stream(messages, model, config);
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn handle_agent_models(State(state): State<AgentState>) -> Json<Value> {
    let mut subscriptions = Vec::new();
    let accounts = state.orchestrator.gateway.store.list_accounts();

    for op in beacon_gateway::OAUTH_PROVIDERS {
        if accounts.iter().any(|a| a.provider == op.id) {
            let mut models = vec![format!("{}/auto", op.alias)];
            for m in op.seed_models {
                models.push(format!("{}/{}", op.alias, m));
            }
            subscriptions.push(json!({
                "provider": op.id,
                "alias": op.alias,
                "models": models,
            }));
        }
    }

    let default_model = if let Some(codex_acc) = accounts.iter().find(|a| a.provider == "codex") {
        if codex_acc.is_free() {
            Some("cx/gpt-5-mini".to_string())
        } else {
            Some("cx/gpt-5.6-terra".to_string())
        }
    } else if let Some(first_sub) = subscriptions.first() {
        first_sub.get("models").and_then(|m| m.as_array()).and_then(|a| a.get(1)).and_then(|v| v.as_str()).map(String::from)
    } else {
        None
    };

    Json(json!({
        "combos": [],
        "subscriptions": subscriptions,
        "apikeys": [],
        "has_any": !subscriptions.is_empty(),
        "default_model": default_model,
    }))
}

async fn handle_agent_context(State(state): State<AgentState>) -> Json<Value> {
    let config = (state.get_config)();
    let accounts = state.orchestrator.gateway.store.list_accounts();
    let has_gw = !accounts.is_empty();

    let default_model = if let Some(codex_acc) = accounts.iter().find(|a| a.provider == "codex") {
        if codex_acc.is_free() {
            Some("cx/gpt-5-mini")
        } else {
            Some("cx/gpt-5.6-terra")
        }
    } else if has_gw {
        Some("cx/gpt-5-mini")
    } else {
        None
    };

    Json(json!({
        "base_url": config.base_url,
        "endpoints_count": config.tests.len(),
        "has_gateway_model": has_gw,
        "default_model": default_model,
    }))
}
