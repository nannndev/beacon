pub mod orchestrator;
pub mod prompt;
pub mod tools;

pub use orchestrator::AgentOrchestrator;
pub use prompt::BEACON_AGENT_SYSTEM_PROMPT;
pub use tools::{agent_tool_definitions, execute_tool, ConfigWorkspace, WorkspaceOps};

use axum::{
    extract::State,
    response::sse::{KeepAlive, Sse},
    response::Json,
    routing::{get, post},
    Router,
};
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Clone)]
pub struct AgentState {
    pub orchestrator: Arc<AgentOrchestrator>,
    pub workspace: Arc<dyn WorkspaceOps>,
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
    // 0 means unlimited; hard cap keeps a runaway loop from burning quota.
    let max_steps = match payload.get("max_steps").and_then(|m| m.as_u64()).unwrap_or(10) {
        0 => 500,
        n => n.min(500),
    } as usize;
    let context = payload.get("context").cloned().unwrap_or(Value::Null);
    let workspace = Arc::clone(&state.workspace);

    let stream = state.orchestrator.run_stream(messages, model, workspace, max_steps, context);
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
            Some("cx/chatgpt-4o-latest".to_string())
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
    let config = state.workspace.get_config();
    let accounts = state.orchestrator.gateway.store.list_accounts();
    let has_gw = !accounts.is_empty();

    let default_model = if let Some(codex_acc) = accounts.iter().find(|a| a.provider == "codex") {
        if codex_acc.is_free() {
            Some("cx/chatgpt-4o-latest")
        } else {
            Some("cx/gpt-5.6-terra")
        }
    } else if has_gw {
        Some("cx/chatgpt-4o-latest")
    } else {
        None
    };

    Json(json!({
        "status": "ready",
        "has_gateway": has_gw,
        "accounts_connected": accounts.len(),
        "endpoints_count": config.tests.len(),
        "default_model": default_model,
        "base_url": config.base_url,
    }))
}
