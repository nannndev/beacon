use crate::history::{compare_details, report, HistoryError, RunStart, StepStart, RUN_CONFIG_KEYS};
use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

type ApiError = (StatusCode, Json<Value>);
type ApiResult = Result<Json<Value>, ApiError>;

const VALID_STATUSES: [&str; 5] = ["running", "completed", "stopped", "failed", "interrupted"];
const VALID_SOURCES: [&str; 4] = ["endpoint", "folder", "run_all", "scenario"];

fn err(code: StatusCode, detail: &str) -> ApiError {
    (code, Json(json!({ "detail": detail })))
}

fn unavailable() -> ApiError {
    err(StatusCode::SERVICE_UNAVAILABLE, "Run history is unavailable")
}

fn map_err(e: HistoryError) -> ApiError {
    match e {
        HistoryError::BadCursor => err(StatusCode::BAD_REQUEST, "Invalid history cursor"),
        HistoryError::Unavailable => unavailable(),
    }
}

fn detail_or_404(state: &AppState, id: &str) -> Result<Value, ApiError> {
    state.history.get_run(id).map_err(map_err)?.ok_or_else(|| err(StatusCode::NOT_FOUND, "Run not found"))
}

/// Active project `(id, name)` for new history rows.
pub fn active_project(state: &AppState) -> (String, String) {
    let store = state.store.read();
    store
        .get_active_project()
        .map(|p| (p.id.clone(), p.name.clone()))
        .unwrap_or_else(|| ("unknown".into(), "Unknown project".into()))
}

/// Scalar execution controls only; request data never reaches history.
pub fn scalar_config(data: &Value) -> Map<String, Value> {
    RUN_CONFIG_KEYS
        .iter()
        .filter_map(|k| data.get(*k).filter(|v| v.is_null() || v.is_boolean() || v.is_number() || v.is_string()).map(|v| (k.to_string(), v.clone())))
        .collect()
}

pub async fn list_history(State(state): State<AppState>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    if q.get("status").map_or(false, |s| !s.is_empty() && !VALID_STATUSES.contains(&s.as_str())) {
        return Err(err(StatusCode::BAD_REQUEST, "Invalid history status"));
    }
    if q.get("source_type").map_or(false, |s| !s.is_empty() && !VALID_SOURCES.contains(&s.as_str())) {
        return Err(err(StatusCode::BAD_REQUEST, "Invalid history source type"));
    }
    let q = q.into_iter().filter(|(_, v)| !v.is_empty()).collect();
    state.history.list_runs(&q).map(Json).map_err(map_err)
}

pub async fn history_health(State(state): State<AppState>) -> Json<Value> {
    Json(state.history.health())
}

pub async fn rebuild_history(State(state): State<AppState>, Json(data): Json<Value>) -> ApiResult {
    if data["confirm"] != "RESET HISTORY" {
        return Err(err(StatusCode::BAD_REQUEST, "Type RESET HISTORY to confirm"));
    }
    if !state.history.rebuild() {
        return Err(err(StatusCode::SERVICE_UNAVAILABLE, "Run history could not be rebuilt"));
    }
    Ok(Json(json!({ "status": "rebuilt" })))
}

pub async fn compare_history(State(state): State<AppState>, Json(data): Json<Value>) -> ApiResult {
    let id = |k: &str| data.get(k).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(str::to_string);
    let (Some(b), Some(c)) = (id("baseline_id"), id("candidate_id")) else {
        return Err(err(StatusCode::BAD_REQUEST, "baseline_id and candidate_id are required"));
    };
    if b == c {
        return Err(err(StatusCode::BAD_REQUEST, "Choose two different runs"));
    }
    let baseline = detail_or_404(&state, &b)?;
    let candidate = detail_or_404(&state, &c)?;
    Ok(Json(compare_details(baseline, candidate)))
}

pub async fn create_history_group(State(state): State<AppState>, Json(data): Json<Value>) -> ApiResult {
    let source_type = data["source_type"].as_str().filter(|s| !s.is_empty()).unwrap_or("run_all").to_string();
    if source_type != "folder" && source_type != "run_all" {
        return Err(err(StatusCode::BAD_REQUEST, "Invalid group source type"));
    }
    let ids: Vec<String> = match data["endpoint_ids"].as_array() {
        Some(a) if !a.is_empty() => a.iter().map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string)).collect(),
        _ => return Err(err(StatusCode::BAD_REQUEST, "endpoint_ids must be a non-empty list")),
    };
    let mut steps = Vec::new();
    for (i, id) in ids.iter().enumerate() {
        let t = state.find_test(id).ok_or_else(|| err(StatusCode::NOT_FOUND, "One or more endpoints were not found"))?;
        steps.push(StepStart { sequence: i as i64, endpoint_id: t.id, endpoint_name: t.name, method: t.method, url_template: t.url });
    }
    let mut snapshot = scalar_config(&data);
    let mode = data["mode"].as_str().filter(|s| !s.is_empty()).unwrap_or("load").to_string();
    snapshot.insert("mode".into(), json!(mode));
    let (project_id, project_name) = active_project(&state);
    let history_id = uuid::Uuid::new_v4().to_string();
    let created = state.history.start(
        RunStart {
            id: history_id.clone(),
            project_id,
            project_name,
            source_type,
            target_id: data["target_id"].as_str().map(str::to_string),
            target_name: data["target_name"].as_str().filter(|s| !s.is_empty()).unwrap_or("Run all endpoints").to_string(),
            mode,
            config_snapshot: Value::Object(snapshot),
        },
        steps,
    );
    if !created {
        return Err(unavailable());
    }
    Ok(Json(json!({ "history_id": history_id })))
}

pub async fn finish_history_group(State(state): State<AppState>, Path(id): Path<String>, Json(data): Json<Value>) -> ApiResult {
    let status = data["status"].as_str().unwrap_or("");
    if status != "stopped" && status != "failed" {
        return Err(err(StatusCode::BAD_REQUEST, "Group finish status must be stopped or failed"));
    }
    if !state.history.is_available() {
        return Err(unavailable());
    }
    state.history.finish_run(&id, status);
    Ok(Json(json!({ "status": status })))
}

pub async fn export_history(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let d = detail_or_404(&state, &id)?;
    let run: Map<String, Value> = [
        "id", "workspace_id", "project_id", "project_name", "origin_device_id", "source_type", "target_id",
        "target_name", "mode", "status", "label", "is_pinned", "started_at", "completed_at", "duration_ms",
        "config_snapshot", "schema_version", "revision",
    ]
    .iter()
    .map(|k| (k.to_string(), d[*k].clone()))
    .collect();
    Ok(Json(json!({
        "format": "beacon.run-history",
        "version": 1,
        "run": run,
        "metrics": d["metrics"],
        "steps": d["steps"],
        "samples": d["samples"],
        "events": d["events"],
    })))
}

pub async fn history_report(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let format = q.get("format").map(|s| s.to_lowercase()).unwrap_or_else(|| "html".into());
    if !["html", "md", "markdown"].contains(&format.as_str()) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "format must be html, md or markdown"));
    }
    let d = detail_or_404(&state, &id)?;
    let slug: String = d["target_name"]
        .as_str()
        .unwrap_or("run")
        .split(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let slug = slug.trim_matches('-').chars().take(40).collect::<String>();
    let slug = if slug.is_empty() { "run".to_string() } else { slug };
    let (body, mime, ext) = if format == "html" {
        (report::render_html(&d), "text/html; charset=utf-8", "html")
    } else {
        (report::render_markdown(&d), "text/markdown; charset=utf-8", "md")
    };
    let disposition = format!("attachment; filename=\"beacon-report-{slug}.{ext}\"");
    Ok(([(header::CONTENT_TYPE, mime.to_string()), (header::CONTENT_DISPOSITION, disposition)], body).into_response())
}

pub async fn get_history(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    detail_or_404(&state, &id).map(Json)
}

pub async fn update_history(State(state): State<AppState>, Path(id): Path<String>, Json(data): Json<Value>) -> ApiResult {
    let Some(obj) = data.as_object() else {
        return Err(err(StatusCode::BAD_REQUEST, "Only label and is_pinned can be updated"));
    };
    if obj.keys().any(|k| k != "label" && k != "is_pinned") {
        return Err(err(StatusCode::BAD_REQUEST, "Only label and is_pinned can be updated"));
    }
    let label = obj.get("label").and_then(|v| v.as_str());
    let pinned = obj.get("is_pinned").and_then(|v| v.as_bool());
    if !state.history.update_run(&id, label, pinned).map_err(map_err)? {
        return Err(err(StatusCode::NOT_FOUND, "Run not found"));
    }
    get_history(State(state), Path(id)).await
}

pub async fn delete_history(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    if !state.history.delete_run(&id).map_err(map_err)? {
        return Err(err(StatusCode::NOT_FOUND, "Run not found"));
    }
    Ok(Json(json!({ "status": "deleted" })))
}
