//! `/sharing/*` routes (port of `routers/sharing.py`).
use crate::sharing::privacy::sanitize_project_source;
use crate::state::AppState;
use crate::store::Project;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

type ApiError = (StatusCode, Json<Value>);

fn fail(status: StatusCode, detail: impl Into<String>) -> ApiError {
    (status, Json(json!({ "detail": detail.into() })))
}

fn fail_pair((status, detail): (StatusCode, String)) -> ApiError {
    fail(status, detail)
}

fn project_value(state: &AppState, project_id: &str) -> Option<Value> {
    let mut store = state.store.write();
    store.save_active_project();
    store.projects.iter().find(|p| p.id == project_id).and_then(|p| serde_json::to_value(p).ok())
}

fn joined_project(state: &AppState, project_id: &str) -> Result<Value, ApiError> {
    let project = project_value(state, project_id).ok_or_else(|| fail(StatusCode::NOT_FOUND, "Project not found"))?;
    if !project["shared_origin"].is_object() {
        return Err(fail(StatusCode::BAD_REQUEST, "This project was not joined from another device"));
    }
    Ok(project)
}

/// Replace a project in the store with its updated JSON form and persist.
fn replace_project(state: &AppState, updated: Value) -> Result<(), ApiError> {
    let parsed: Project = serde_json::from_value(updated).map_err(|e| fail(StatusCode::INTERNAL_SERVER_ERROR, format!("Invalid project source: {e}")))?;
    let mut store = state.store.write();
    if let Some(idx) = store.projects.iter().position(|p| p.id == parsed.id) {
        store.projects[idx] = parsed;
    }
    store.sync_current_config();
    store.save().map_err(|e| fail(StatusCode::INTERNAL_SERVER_ERROR, e))
}

pub async fn sharing_status(State(state): State<AppState>, Path(id): Path<String>) -> Json<Value> {
    let project = project_value(&state, &id);
    Json(
        state
            .sharing
            .status(&id, project.as_ref())
            .unwrap_or_else(|| json!({"project_id": id, "sharing_enabled": false, "revision": null, "host": {"hosting": false}})),
    )
}

pub async fn enable_sharing(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let project = project_value(&state, &id).ok_or_else(|| fail(StatusCode::NOT_FOUND, "Project not found"))?;
    if project["shared_origin"].is_object() {
        return Err(fail(StatusCode::BAD_REQUEST, "Joined projects are shared by their host; create a private copy to host it yourself"));
    }
    state.sharing.enable(&project).await.map(Json).map_err(fail_pair)
}

pub async fn disable_sharing(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    state.sharing.disable(&id).map(Json).map_err(|_| fail(StatusCode::NOT_FOUND, "Shared project not found"))
}

pub async fn refresh_pairing_code(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    state.sharing.refresh_pairing_code(&id).map(Json).map_err(fail_pair)
}

pub async fn join_local_project(State(state): State<AppState>, Json(data): Json<Value>) -> Result<Json<Value>, ApiError> {
    let address = data["address"].as_str().unwrap_or("").trim().to_string();
    let code = data["code"].as_str().unwrap_or("").trim().to_string();
    if address.is_empty() || code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err(fail(StatusCode::BAD_REQUEST, "Host address and six-digit pairing code are required"));
    }
    let device_name = data["device_name"].as_str().filter(|s| !s.is_empty()).unwrap_or("Beacon device");
    state.sharing.request_join(&address, &code, device_name).await.map(Json).map_err(|e| fail(e.http_status(), e.user_detail()))
}

pub async fn joined_project_status(State(state): State<AppState>, Json(data): Json<Value>) -> Result<Json<Value>, ApiError> {
    let address = data["address"].as_str().unwrap_or("");
    let request_id = data["request_id"].as_str().unwrap_or("");
    let result = state.sharing.complete_join(address, request_id).await.map_err(|e| fail(e.http_status(), e.user_detail()))?;
    if result["status"] != "approved" {
        return Ok(Json(result));
    }
    let project: Project = serde_json::from_value(result["project"].clone()).map_err(|e| fail(StatusCode::BAD_GATEWAY, format!("Host returned an invalid project snapshot: {e}")))?;
    let mut store = state.store.write();
    if store.projects.iter().any(|p| p.id == project.id) {
        return Err(fail(StatusCode::CONFLICT, "This shared project already exists on this device"));
    }
    let (project_id, project_name) = (project.id.clone(), project.name.clone());
    store.save_active_project();
    store.projects.push(project);
    store.current_project_id = Some(project_id.clone());
    store.sync_current_config();
    store.save().map_err(|e| fail(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(json!({"status": "approved", "project_id": project_id, "project_name": project_name})))
}

pub async fn decide_pairing(State(state): State<AppState>, Path((id, request_id)): Path<(String, String)>, Json(data): Json<Value>) -> Result<Json<Value>, ApiError> {
    if state.sharing.host.hosted_project_id().as_deref() != Some(id.as_str()) {
        return Err(fail(StatusCode::NOT_FOUND, "Project is not currently hosted"));
    }
    let role = data["role"].as_str().filter(|r| !r.is_empty()).unwrap_or("viewer");
    state.sharing.host.decide_pairing(&request_id, data["approved"].as_bool().unwrap_or(false), role).map(Json)
}

pub async fn update_member(State(state): State<AppState>, Path((id, device_id)): Path<(String, String)>, Json(data): Json<Value>) -> Result<Json<Value>, ApiError> {
    state.sharing.update_member(&id, &device_id, data["role"].as_str().unwrap_or("")).map(Json).map_err(fail_pair)
}

pub async fn remove_member(State(state): State<AppState>, Path((id, device_id)): Path<(String, String)>) -> Result<Json<Value>, ApiError> {
    state.sharing.remove_member(&id, &device_id).map(Json).map_err(fail_pair)
}

pub async fn duplicate_shared_project(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let mut source = joined_project(&state, &id)?;
    let new_id = Uuid::new_v4().to_string();
    let name = format!("{} (Private copy)", source["name"].as_str().unwrap_or("Shared project"));
    source["id"] = json!(new_id);
    source["name"] = json!(name);
    source.as_object_mut().map(|o| o.remove("shared_origin"));
    let project: Project = serde_json::from_value(source).map_err(|e| fail(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut store = state.store.write();
    store.projects.push(project);
    store.current_project_id = Some(new_id.clone());
    store.sync_current_config();
    store.save().map_err(|e| fail(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(json!({"project_id": new_id, "project_name": name})))
}

pub async fn leave_shared_project(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    joined_project(&state, &id)?;
    let mut store = state.store.write();
    store.projects.retain(|p| p.id != id);
    store.current_project_id = store.projects.first().map(|p| p.id.clone());
    store.sync_current_config();
    store.save().map_err(|e| fail(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(json!({"left": true, "current_project_id": store.current_project_id})))
}

async fn finish(state: &AppState, id: &str, changed: bool, updated: Option<Value>, key: &str) -> Result<Json<Value>, ApiError> {
    if let Some(updated) = updated {
        replace_project(state, updated)?;
    }
    let project = project_value(state, id);
    Ok(Json(json!({ key: changed, "status": state.sharing.status(id, project.as_ref()) })))
}

pub async fn sync_shared_project(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let mut project = project_value(&state, &id).ok_or_else(|| fail(StatusCode::NOT_FOUND, "Project not found"))?;
    if project["shared_origin"].is_object() {
        let changed = member_sync(&state, &mut project).await || state.sharing.pull_if_joined(&mut project).await;
        return finish(&state, &id, changed, Some(project), "changed").await;
    }
    let updated = state.sharing.sync_host_project(&project);
    finish(&state, &id, updated.is_some(), updated, "changed").await
}

/// Members push unsynced local edits before pulling, as the Python save hook did.
async fn member_sync(state: &AppState, project: &mut Value) -> bool {
    let origin = &project["shared_origin"];
    let dirty = origin["conflict"].is_null() && origin["last_synced_source"] != sanitize_project_source(project);
    dirty && state.sharing.push_if_joined(project).await
}

#[derive(serde::Deserialize)]
pub struct WatchQuery {
    pub timeout: Option<f64>,
    pub active_target_id: Option<String>,
    pub active_target_name: Option<String>,
    pub activity: Option<String>,
}

pub async fn watch_shared_project(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<WatchQuery>) -> Result<Json<Value>, ApiError> {
    let mut project = joined_project(&state, &id)?;
    let timeout = q.timeout.unwrap_or(5.0).clamp(0.1, 10.0);
    let presence = [("active_target_id", q.active_target_id), ("active_target_name", q.active_target_name), ("activity", q.activity)];
    let pushed = member_sync(&state, &mut project).await;
    let changed = state.sharing.watch_updates(&mut project, timeout, &presence, true).await || pushed;
    finish(&state, &id, changed, Some(project), "changed").await
}

pub async fn resolve_shared_project_conflict(State(state): State<AppState>, Path((id, resolution)): Path<(String, String)>, body: Option<Json<Value>>) -> Result<Json<Value>, ApiError> {
    let mut project = joined_project(&state, &id)?;
    let choices = body.as_ref().and_then(|b| b.get("choices").cloned());
    state.sharing.resolve_conflict(&mut project, &resolution, choices.as_ref()).await.map_err(fail_pair)?;
    finish(&state, &id, true, Some(project), "resolved").await
}

#[derive(serde::Deserialize)]
pub struct AfterQuery {
    #[serde(default)]
    pub after: i64,
}

pub async fn project_revisions(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<AfterQuery>) -> Result<Json<Value>, ApiError> {
    let project = project_value(&state, &id);
    if state.sharing.status(&id, project.as_ref()).is_none() {
        return Err(fail(StatusCode::NOT_FOUND, "Shared project not found"));
    }
    let items = state.sharing.revisions_after(&id, q.after.max(0)).map_err(|e| fail(StatusCode::INTERNAL_SERVER_ERROR, e.message()))?;
    Ok(Json(json!({"items": items})))
}
