use crate::state::AppState;
use crate::store::Environment;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

pub async fn create_environment(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut store = state.store.write();
    let proj = match store.projects.iter_mut().find(|p| p.id == project_id) {
        Some(p) => p,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "detail": "Project not found" })),
            ));
        }
    };

    let env_id = Uuid::new_v4().to_string();
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("New Env")
        .to_string();
    let base_url = payload
        .get("base_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let variables: HashMap<String, Value> = payload
        .get("variables")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let new_env = Environment {
        id: env_id.clone(),
        name,
        base_url,
        variables,
    };

    proj.environments.push(new_env.clone());
    proj.current_environment_id = Some(env_id);

    store.sync_current_config();
    if let Err(e) = store.save() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": format!("Failed to save store: {}", e) })),
        ));
    }

    Ok(Json(serde_json::to_value(&new_env).unwrap_or(json!({}))))
}

pub async fn switch_environment(
    State(state): State<AppState>,
    Path((project_id, env_id)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut store = state.store.write();
    let proj = match store.projects.iter_mut().find(|p| p.id == project_id) {
        Some(p) => p,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "detail": "Project not found" })),
            ));
        }
    };

    if !proj.environments.iter().any(|e| e.id == env_id) {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "Environment not found" })),
        ));
    }

    proj.current_environment_id = Some(env_id);
    store.sync_current_config();
    if let Err(e) = store.save() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": format!("Failed to save store: {}", e) })),
        ));
    }

    Ok(Json(json!({
        "status": "switched",
        "config": serde_json::to_value(&store.current_config).unwrap_or(json!({}))
    })))
}

pub async fn capture_variable(
    State(state): State<AppState>,
    Path((project_id, env_id, name)): Path<(String, String, String)>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let var_val = payload.get("value").cloned().unwrap_or(Value::Null);

    let mut store = state.store.write();
    let proj = match store.projects.iter_mut().find(|p| p.id == project_id) {
        Some(p) => p,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "detail": "Project not found" })),
            ));
        }
    };

    let env = match proj.environments.iter_mut().find(|e| e.id == env_id) {
        Some(e) => e,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "detail": "Environment not found" })),
            ));
        }
    };

    env.variables.insert(name.clone(), var_val.clone());
    store.sync_current_config();
    if let Err(e) = store.save() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": format!("Failed to save store: {}", e) })),
        ));
    }

    Ok(Json(json!({
        "status": "saved",
        "name": name,
        "value": var_val
    })))
}

