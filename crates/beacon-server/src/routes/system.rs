use axum::response::Json;
use serde_json::{json, Value};
use std::env;

pub async fn system_info() -> Json<Value> {
    let app_version = env::var("BEACON_APP_VERSION").unwrap_or_else(|_| "dev".to_string());
    Json(json!({
        "app_version": app_version,
        "api_protocol": 2,
        "capabilities": [
            "scenario.start",
            "sharing.v1",
            "sharing.protocol.2",
            "history.v1",
            "mcp.v1",
            "project.import.preview",
            "project.file-sync.v1",
            "project.file-sync.import.v1",
            "project.repository.inspect.v1",
            "project.git.v1",
            "project.git.diff.v1",
            "project.git.branches.v1",
            "project.git.compare.v1",
            "ai.gateway.v1"
        ]
    }))
}

pub async fn monitor_status() -> Json<Value> {
    Json(json!({}))
}

