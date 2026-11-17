//! GitHub PAT connection + Repo/Code Summarizer + Collection Generator routes.

use crate::github::{self, DiscoveredEndpoint};
use crate::importer::materialize_items;
use crate::state::AppState;
use crate::store::{Environment, Project};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use uuid::Uuid;

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

fn bad(msg: impl Into<String>) -> (StatusCode, Json<Value>) {
    (StatusCode::BAD_REQUEST, Json(json!({ "detail": msg.into() })))
}

fn server_err(msg: impl Into<String>) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "detail": msg.into() })),
    )
}

fn data_dir(state: &AppState) -> std::path::PathBuf {
    let store = state.store.read();
    store
        .file_path
        .parent()
        .unwrap_or(Path::new("config"))
        .to_path_buf()
}

pub async fn status(State(state): State<AppState>) -> ApiResult {
    let dir = data_dir(&state);
    let st = github::get_status(&dir);
    Ok(Json(serde_json::to_value(st).unwrap_or(json!({ "connected": false }))))
}

#[derive(Deserialize)]
pub struct ConnectReq {
    pub token: String,
    #[serde(default)]
    pub api_base: Option<String>,
}

pub async fn connect(State(state): State<AppState>, Json(body): Json<ConnectReq>) -> ApiResult {
    let dir = data_dir(&state);
    let st = github::connect_pat(&dir, &body.token, body.api_base.as_deref())
        .await
        .map_err(bad)?;
    Ok(Json(serde_json::to_value(st).unwrap_or(json!({ "connected": true }))))
}

pub async fn disconnect(State(state): State<AppState>) -> ApiResult {
    let dir = data_dir(&state);
    github::disconnect(&dir).map_err(server_err)?;
    Ok(Json(json!({ "status": "disconnected", "connected": false })))
}

pub async fn repos(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult {
    let dir = data_dir(&state);
    let search = q.get("q").map(String::as_str);
    let per_page = q
        .get("per_page")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(50);
    let list = github::list_repos(&dir, search, per_page)
        .await
        .map_err(bad)?;
    Ok(Json(json!({ "repos": list })))
}

#[derive(Deserialize)]
pub struct SummarizeRepoReq {
    pub repo: String,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default = "default_true")]
    pub use_ai: bool,
}

fn default_true() -> bool {
    true
}

pub async fn summarize_repo(
    State(state): State<AppState>,
    Json(body): Json<SummarizeRepoReq>,
) -> ApiResult {
    let dir = data_dir(&state);
    let result = github::summarize_github_repo(
        &dir,
        Some(&state.gateway),
        &body.repo,
        body.branch.as_deref(),
        body.use_ai,
    )
    .await
    .map_err(bad)?;
    Ok(Json(serde_json::to_value(result).unwrap_or(json!({}))))
}

#[derive(Deserialize)]
pub struct SummarizeCodeReq {
    pub path: String,
    #[serde(default = "default_true")]
    pub use_ai: bool,
}

pub async fn summarize_code(
    State(state): State<AppState>,
    Json(body): Json<SummarizeCodeReq>,
) -> ApiResult {
    let result = github::summarize_local_project(Some(&state.gateway), &body.path, body.use_ai)
        .await
        .map_err(bad)?;
    Ok(Json(serde_json::to_value(result).unwrap_or(json!({}))))
}

#[derive(Deserialize)]
pub struct GenerateCollectionReq {
    pub name: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub endpoints: Vec<DiscoveredEndpoint>,
}

pub async fn generate_collection(
    State(state): State<AppState>,
    Json(body): Json<GenerateCollectionReq>,
) -> ApiResult {
    let selected: Vec<&DiscoveredEndpoint> = body.endpoints.iter().filter(|e| e.selected).collect();
    if selected.is_empty() {
        return Err(bad("Select at least one endpoint to generate a collection"));
    }

    let base = body.base_url.trim().trim_end_matches('/').to_string();
    let base_url = if base.is_empty() {
        "http://localhost:8000".to_string()
    } else {
        base
    };

    let raw_items: Vec<Value> = selected
        .iter()
        .map(|ep| {
            let clean_path = if ep.path.starts_with('/') {
                ep.path.clone()
            } else {
                format!("/{}", ep.path)
            };
            let url = format!("{base_url}{clean_path}");
            let mut headers = serde_json::Map::new();
            if let Some(auth) = &ep.auth_hint {
                if !auth.trim().is_empty() {
                    headers.insert("Authorization".to_string(), json!(auth));
                }
            }
            let payload = ep
                .sample_body
                .as_deref()
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .unwrap_or_else(|| json!({}));

            json!({
                "name": ep.name,
                "method": ep.method.to_uppercase(),
                "url": url,
                "folder": ep.folder,
                "description": ep.description,
                "headers": Value::Object(headers),
                "payload": payload,
            })
        })
        .collect();

    let (materialized, _) = materialize_items(&raw_items).map_err(bad)?;

    let mut store = state.store.write();
    let target_id = if let Some(pid) = body.project_id.as_deref().filter(|s| !s.is_empty()) {
        if let Some(proj) = store.projects.iter_mut().find(|p| p.id == pid) {
            let existing = proj.items.get_or_insert_with(Vec::new);
            existing.extend(materialized);
            pid.to_string()
        } else {
            return Err(bad("Target project not found"));
        }
    } else {
        let proj_id = Uuid::new_v4().to_string();
        let env_id = Uuid::new_v4().to_string();
        let mut vars = HashMap::new();
        vars.insert("base_url".to_string(), json!(base_url));
        let project = Project {
            id: proj_id.clone(),
            name: if body.name.trim().is_empty() {
                "Generated API Collection".to_string()
            } else {
                body.name.trim().to_string()
            },
            template_id: None,
            environments: vec![Environment {
                id: env_id.clone(),
                name: "Default".to_string(),
                base_url,
                variables: vars,
            }],
            current_environment_id: Some(env_id),
            notifications: None,
            shared_origin: None,
            file_sync: None,
            items: Some(materialized),
            tests: None,
            auth: None,
        };
        store.projects.push(project);
        store.current_project_id = Some(proj_id.clone());
        proj_id
    };

    store.sync_current_config();
    store.save().map_err(server_err)?;

    Ok(Json(json!({
        "status": "generated",
        "project_id": target_id,
        "endpoints_added": selected.len(),
        "current_project_id": store.current_project_id,
        "config": serde_json::to_value(&store.current_config).unwrap_or(json!({})),
    })))
}
