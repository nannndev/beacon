use crate::state::AppState;
use crate::store::{Environment, Project};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

pub async fn list_projects(State(state): State<AppState>) -> Json<Value> {
    let mut store = state.store.write();
    store.save_active_project();

    let projects_json: Vec<Value> = store
        .projects
        .iter()
        .map(|p| {
            let items = p.items.clone().unwrap_or_else(|| {
                p.tests
                    .clone()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|mut t| {
                        if let Some(obj) = t.as_object_mut() {
                            obj.insert("type".into(), json!("request"));
                        }
                        t
                    })
                    .collect()
            });

            json!({
                "id": p.id,
                "name": p.name,
                "template_id": p.template_id,
                "environments": p.environments,
                "current_environment_id": p.current_environment_id,
                "notifications": p.notifications.clone().unwrap_or_else(|| json!({})),
                "shared_origin": p.shared_origin,
                "file_sync": p.file_sync,
                "items": items,
            })
        })
        .collect();

    Json(json!({
        "current_project_id": store.current_project_id,
        "projects": projects_json,
        "global_variables": store.global_variables,
    }))
}

pub async fn create_project(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut store = state.store.write();
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&format!("Project {}", store.projects.len() + 1))
        .to_string();

    let pid = Uuid::new_v4().to_string();
    let env_id = Uuid::new_v4().to_string();

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
        name: "Local".to_string(),
        base_url,
        variables,
    };

    let new_p = Project {
        id: pid.clone(),
        name: name.clone(),
        template_id: None,
        environments: vec![new_env],
        current_environment_id: Some(env_id),
        notifications: None,
        shared_origin: None,
        file_sync: None,
        items: Some(Vec::new()),
        tests: None,
        auth: None,
    };

    store.projects.push(new_p);
    store.current_project_id = Some(pid.clone());
    store.sync_current_config();
    if let Err(e) = store.save() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": format!("Failed to save project: {}", e) })),
        ));
    }

    Ok(Json(json!({ "id": pid, "name": name })))
}

pub async fn switch_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut store = state.store.write();
    if !store.projects.iter().any(|p| p.id == project_id) {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "Project not found" })),
        ));
    }

    store.current_project_id = Some(project_id.clone());
    store.sync_current_config();
    if let Err(e) = store.save() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": format!("Failed to save store: {}", e) })),
        ));
    }

    Ok(Json(json!({
        "status": "switched",
        "current_project_id": store.current_project_id,
        "config": serde_json::to_value(&store.current_config).unwrap_or(json!({}))
    })))
}

pub async fn update_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut store = state.store.write();
    let idx = match store.projects.iter().position(|p| p.id == project_id) {
        Some(i) => i,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "detail": "Project not found" })),
            ));
        }
    };

    let proj = &mut store.projects[idx];
    if let Some(name) = payload.get("name").and_then(|n| n.as_str()) {
        proj.name = name.to_string();
    }
    if let Some(envs) = payload.get("environments") {
        if let Ok(parsed_envs) = serde_json::from_value::<Vec<Environment>>(envs.clone()) {
            proj.environments = parsed_envs;
            if !proj
                .environments
                .iter()
                .any(|e| Some(&e.id) == proj.current_environment_id.as_ref())
            {
                proj.current_environment_id = proj.environments.first().map(|e| e.id.clone());
            }
        }
    }
    if let Some(items) = payload.get("items").and_then(|i| i.as_array()) {
        proj.items = Some(items.clone());
    }
    if let Some(notifs) = payload.get("notifications") {
        proj.notifications = Some(notifs.clone());
    }

    store.sync_current_config();
    if let Err(e) = store.save() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": format!("Failed to save store: {}", e) })),
        ));
    }

    let updated_proj = store.projects[idx].clone();
    Ok(Json(json!({
        "status": "updated",
        "project": updated_proj
    })))
}

pub async fn reorder_projects(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let project_ids = match payload.get("project_ids").and_then(|ids| ids.as_array()) {
        Some(arr) => arr
            .iter()
            .filter_map(|id| id.as_str().map(String::from))
            .collect::<Vec<String>>(),
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "detail": "project_ids array is required" })),
            ));
        }
    };

    let mut store = state.store.write();
    let current_ids: Vec<String> = store.projects.iter().map(|p| p.id.clone()).collect();

    if project_ids.len() != current_ids.len() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "detail": "project_ids must contain all projects" })),
        ));
    }

    let mut by_id: HashMap<String, Project> = HashMap::new();
    for p in store.projects.drain(..) {
        by_id.insert(p.id.clone(), p);
    }

    for id in &project_ids {
        if let Some(p) = by_id.remove(id) {
            store.projects.push(p);
        } else {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "detail": format!("Unknown project id: {}", id) })),
            ));
        }
    }

    if let Err(e) = store.save() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": format!("Failed to save store: {}", e) })),
        ));
    }

    Ok(Json(json!({ "status": "reordered", "project_ids": project_ids })))
}

pub async fn sample_jsonplaceholder(State(state): State<AppState>) -> Json<Value> {
    let mut store = state.store.write();
    let existing_id = store
        .projects
        .iter()
        .find(|p| p.template_id.as_deref() == Some("jsonplaceholder-v1"))
        .map(|p| p.id.clone());

    if let Some(id) = existing_id {
        store.current_project_id = Some(id.clone());
        store.sync_current_config();
        let _ = store.save();
        return Json(json!({ "project_id": id, "created": false }));
    }

    let pid = Uuid::new_v4().to_string();
    let env_id = Uuid::new_v4().to_string();
    let sample = Project {
        id: pid.clone(),
        name: "JSONPlaceholder API".to_string(),
        template_id: Some("jsonplaceholder-v1".to_string()),
        environments: vec![Environment {
            id: env_id.clone(),
            name: "JSONPlaceholder".to_string(),
            base_url: "https://jsonplaceholder.typicode.com".to_string(),
            variables: HashMap::from([
                ("post_id".into(), json!(1)),
                ("comment_id".into(), json!(1)),
                ("user_id".into(), json!(1)),
            ]),
        }],
        current_environment_id: Some(env_id),
        notifications: None,
        shared_origin: None,
        file_sync: None,
        items: Some(Vec::new()),
        tests: None,
        auth: None,
    };

    store.projects.push(sample);
    store.current_project_id = Some(pid.clone());
    store.sync_current_config();
    let _ = store.save();

    Json(json!({ "project_id": pid, "created": true }))
}
