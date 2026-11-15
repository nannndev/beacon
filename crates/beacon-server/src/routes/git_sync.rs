//! Git + file-sync endpoints for projects linked to a folder on disk.
//! Handlers clone the project out of the store, run the (async) git work
//! without holding the lock, then write the result back through `persist`.
use crate::file_sync as fsync;
use crate::git;
use crate::state::AppState;
use crate::store::{Environment, Project};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

type Fail = (StatusCode, Json<Value>);
type Reply = Result<Json<Value>, Fail>;

fn bad(detail: impl Into<String>) -> Fail {
    (StatusCode::BAD_REQUEST, Json(json!({ "detail": detail.into() })))
}

fn field(payload: &Value, key: &str) -> String {
    payload.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

fn project(state: &AppState, id: &str) -> Result<Project, Fail> {
    state.store.read().projects.iter().find(|p| p.id == id).cloned()
        .ok_or((StatusCode::NOT_FOUND, Json(json!({ "detail": "Project not found" }))))
}

/// Replace (or add) the project in the store and save, like `update_project`.
fn persist(state: &AppState, project: Project, activate: bool) -> Result<(), Fail> {
    let mut store = state.store.write();
    let id = project.id.clone();
    match store.projects.iter().position(|p| p.id == id) {
        Some(i) => store.projects[i] = project,
        None => store.projects.push(project),
    }
    if activate {
        store.current_project_id = Some(id);
    }
    store.sync_current_config();
    store.save().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "detail": format!("Failed to save store: {e}") }))))
}

fn linked_result(project: &Project, cloned_path: Option<&str>) -> Value {
    json!({
        "project_id": project.id, "project_name": project.name,
        "path": project.file_sync.as_ref().and_then(|m| m.get("path")).cloned().unwrap_or(Value::Null),
        "cloned_path": cloned_path, "missing_private_values": fsync::missing_private_values(project),
    })
}

// ---- git ----

pub async fn git_status(State(state): State<AppState>, Path(id): Path<String>) -> Reply {
    git::status(&project(&state, &id)?).await.map(Json).map_err(bad)
}

pub async fn git_branches(State(state): State<AppState>, Path(id): Path<String>) -> Reply {
    git::branches(&project(&state, &id)?).await.map(Json).map_err(bad)
}

pub async fn git_fetch(State(state): State<AppState>, Path(id): Path<String>) -> Reply {
    git::fetch(&project(&state, &id)?).await.map(Json).map_err(bad)
}

pub async fn git_compare(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<Value>) -> Reply {
    git::compare_branch(&project(&state, &id)?, &field(&payload, "branch")).await.map(Json).map_err(bad)
}

pub async fn git_create_branch(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<Value>) -> Reply {
    git::create_branch(&project(&state, &id)?, &field(&payload, "name")).await.map(Json).map_err(bad)
}

pub async fn git_switch(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<Value>) -> Reply {
    let mut project = project(&state, &id)?;
    let previous = git::status(&project).await.map_err(bad)?["branch"].as_str().map(String::from);
    let result = git::switch_branch(&project, &field(&payload, "branch")).await.map_err(bad)?;
    if result["current"].as_str() == previous.as_deref() {
        return Ok(Json(result));
    }
    if let Err(reload_error) = fsync::reload(&mut project) {
        if let Some(prev) = previous {
            git::switch_branch(&project, &prev).await.map_err(bad)?;
            fsync::reload(&mut project).map_err(bad)?;
        }
        return Err(bad(format!("Could not load that branch as a Beacon project: {reload_error}")));
    }
    persist(&state, project, false)?;
    Ok(Json(result))
}

pub async fn git_init(State(state): State<AppState>, Path(id): Path<String>) -> Reply {
    git::init(&project(&state, &id)?).await.map(Json).map_err(bad)
}

pub async fn git_set_remote(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<Value>) -> Reply {
    git::set_remote(&project(&state, &id)?, &field(&payload, "url")).await.map(Json).map_err(bad)
}

pub async fn git_commit(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<Value>) -> Reply {
    git::commit(&project(&state, &id)?, &field(&payload, "message")).await.map(Json).map_err(bad)
}

pub async fn git_pull(State(state): State<AppState>, Path(id): Path<String>) -> Reply {
    let mut project = project(&state, &id)?;
    let result = git::pull(&project).await.map_err(bad)?;
    fsync::reload(&mut project).map_err(bad)?;
    persist(&state, project, false)?;
    Ok(Json(result))
}

pub async fn git_push(State(state): State<AppState>, Path(id): Path<String>) -> Reply {
    git::push(&project(&state, &id)?).await.map(Json).map_err(bad)
}

pub async fn git_diff(State(state): State<AppState>, Path(id): Path<String>, Query(query): Query<HashMap<String, String>>) -> Reply {
    let scope = query.get("scope").map(String::as_str).unwrap_or("working");
    git::diff(&project(&state, &id)?, scope, query.get("path").map(String::as_str)).await.map(Json).map_err(bad)
}

// ---- file-sync ----

pub async fn file_sync_status(State(state): State<AppState>, Path(id): Path<String>) -> Reply {
    Ok(Json(fsync::status(&project(&state, &id)?)))
}

pub async fn file_sync_link(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<Value>) -> Reply {
    let mut project = project(&state, &id)?;
    let status = fsync::link(&mut project, &field(&payload, "path")).map_err(bad)?;
    persist(&state, project, false)?;
    Ok(Json(status))
}

pub async fn file_sync_reload(State(state): State<AppState>, Path(id): Path<String>) -> Reply {
    let mut project = project(&state, &id)?;
    let status = fsync::reload(&mut project).map_err(bad)?;
    persist(&state, project, false)?;
    Ok(Json(status))
}

pub async fn file_sync_unlink(State(state): State<AppState>, Path(id): Path<String>) -> Reply {
    let mut project = project(&state, &id)?;
    let status = fsync::unlink(&mut project);
    persist(&state, project, false)?;
    Ok(Json(status))
}

fn open_linked(state: &AppState, path: &str, cloned_path: Option<&str>) -> Reply {
    let ids: Vec<String> = state.store.read().projects.iter().map(|p| p.id.clone()).collect();
    let project = fsync::open_existing(path, &ids).map_err(bad)?;
    let result = linked_result(&project, cloned_path);
    persist(state, project, true)?;
    Ok(Json(result))
}

pub async fn file_sync_open(State(state): State<AppState>, Json(payload): Json<Value>) -> Reply {
    open_linked(&state, &field(&payload, "path"), None)
}

pub async fn file_sync_clone(State(state): State<AppState>, Json(payload): Json<Value>) -> Reply {
    let target = git::clone(&field(&payload, "url"), &field(&payload, "destination")).await.map_err(bad)?;
    let target = target.to_string_lossy().to_string();
    let mut inspection = fsync::inspect(&target).map_err(bad)?;
    if inspection["mode"] == "beacon_project" {
        let mut opened = open_linked(&state, &target, Some(&target))?.0;
        opened["mode"] = json!("opened");
        return Ok(Json(opened));
    }
    inspection["inspection_mode"] = inspection["mode"].clone();
    inspection["mode"] = json!("inspection_required");
    inspection["cloned_path"] = json!(target);
    Ok(Json(inspection))
}

pub async fn file_sync_import_candidate(State(state): State<AppState>, Json(payload): Json<Value>) -> Reply {
    let root = field(&payload, "path");
    let report = fsync::load_candidate(&root, &field(&payload, "candidate")).map_err(bad)?;
    crate::routes::portable::persist_import(&state, &report, Some(&root))
}

pub async fn file_sync_initialize(State(state): State<AppState>, Json(payload): Json<Value>) -> Reply {
    let inspection = fsync::inspect(&field(&payload, "path")).map_err(bad)?;
    if inspection["mode"] == "beacon_project" {
        return Err(bad("This repository already contains beacon.yaml"));
    }
    let root = inspection["repository_path"].as_str().unwrap_or("").to_string();
    let mut name = field(&payload, "name").trim().to_string();
    if name.is_empty() {
        name = inspection["repository_name"].as_str().filter(|n| !n.is_empty()).unwrap_or("API Project").to_string();
    }
    let env_id = Uuid::new_v4().to_string();
    let mut project = Project {
        id: Uuid::new_v4().to_string(),
        name,
        template_id: None,
        environments: vec![Environment { id: env_id.clone(), name: "Local".into(), base_url: String::new(), variables: HashMap::new() }],
        current_environment_id: Some(env_id),
        notifications: None,
        shared_origin: None,
        file_sync: None,
        items: Some(Vec::new()),
        tests: None,
        auth: None,
    };
    fsync::link(&mut project, &root).map_err(bad)?;
    let result = linked_result(&project, Some(&root));
    persist(&state, project, true)?;
    Ok(Json(result))
}
