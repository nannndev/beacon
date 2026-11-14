//! Project delete/export/import, global variables, dataset preview, notification test,
//! and GraphQL introspection (port of the Python `routers/projects.py`, `runs.py`, `graphql.py`).

use crate::importer::{materialize_items, normalize_project};
use crate::state::AppState;
use crate::store::{Environment, Project};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::time::Duration;
use uuid::Uuid;

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

fn err(status: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "detail": msg.into() })))
}
fn bad(msg: impl Into<String>) -> (StatusCode, Json<Value>) {
    err(StatusCode::BAD_REQUEST, msg)
}
fn save_err(e: String) -> (StatusCode, Json<Value>) {
    err(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to save store: {e}"))
}

const EXPORT_FORMAT: &str = "security-tools.project";
const EXPORT_VERSION: u32 = 1;

pub async fn delete_project(State(state): State<AppState>, Path(project_id): Path<String>) -> ApiResult {
    let mut store = state.store.write();
    let Some(idx) = store.projects.iter().position(|p| p.id == project_id) else {
        return Err(err(StatusCode::NOT_FOUND, "Project not found"));
    };
    store.projects.remove(idx);
    if store.current_project_id.as_deref() == Some(&project_id) {
        store.current_project_id = store.projects.first().map(|p| p.id.clone());
    }
    if store.projects.is_empty() {
        // Python left the workspace empty; a desktop app needs an active project.
        store.load();
    }
    store.sync_current_config();
    store.save().map_err(save_err)?;
    Ok(Json(json!({
        "status": "deleted",
        "current_project_id": store.current_project_id,
        "config": serde_json::to_value(&store.current_config).unwrap_or(json!({})),
    })))
}

pub async fn export_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult {
    let include_secrets = q.get("include_secrets").map(|v| v == "true" || v == "1").unwrap_or(false);
    let mut store = state.store.write();
    store.save_active_project();
    let Some(proj) = store.projects.iter().find(|p| p.id == project_id) else {
        return Err(err(StatusCode::NOT_FOUND, "Project not found"));
    };
    let envs: Vec<Value> = proj
        .environments
        .iter()
        .map(|e| {
            let variables: Map<String, Value> = e
                .variables
                .iter()
                .map(|(k, v)| (k.clone(), if include_secrets { v.clone() } else { json!("") }))
                .collect();
            json!({ "name": e.name, "base_url": e.base_url, "variables": variables })
        })
        .collect();
    let items = proj.items.clone().unwrap_or_else(|| {
        proj.tests.clone().unwrap_or_default().into_iter().map(|mut t| { t["type"] = json!("request"); t }).collect()
    });
    Ok(Json(json!({
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "project": { "name": proj.name, "environments": envs, "items": items },
        "secrets_included": include_secrets,
    })))
}

pub async fn project_template() -> Json<Value> {
    Json(json!({
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "project": {
            "name": "My API Project",
            "environments": [{ "name": "Local", "base_url": "https://api.example.com", "variables": { "access_token": "", "refresh_token": "" } }],
            "items": [
                { "id": "folder-auth", "name": "Auth", "type": "folder", "items": [
                    { "id": "req-login", "name": "Example Login", "type": "request", "url": "/auth/login", "method": "POST",
                      "headers": { "Content-Type": "application/json" },
                      "payload": { "email": "{{random_email}}", "password": "ChangeMe123" }, "payload_type": "json",
                      "extractors": { "access_token": "body.access_token" }, "run_config": null }
                ]},
                { "id": "req-profile", "name": "Get Profile", "type": "request", "url": "/me", "method": "GET",
                  "headers": { "Authorization": "Bearer {{access_token}}" }, "payload": {}, "payload_type": "json",
                  "extractors": {}, "run_config": null }
            ]
        }
    }))
}

pub async fn preview_import(Json(data): Json<Value>) -> ApiResult {
    let mut report = normalize_project(&data).map_err(bad)?;
    report.as_object_mut().map(|o| o.remove("project"));
    Ok(Json(report))
}

pub async fn import_project(State(state): State<AppState>, Json(data): Json<Value>) -> ApiResult {
    let report = normalize_project(&data).map_err(bad)?;
    let payload = &report["project"];
    let (items, tests) = materialize_items(payload["items"].as_array().map(Vec::as_slice).unwrap_or(&[])).map_err(bad)?;
    let envs: Vec<Environment> = payload["environments"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|e| Environment {
            id: Uuid::new_v4().to_string(),
            name: e["name"].as_str().filter(|n| !n.is_empty()).unwrap_or("Imported").to_string(),
            base_url: e["base_url"].as_str().unwrap_or("").to_string(),
            variables: e["variables"].as_object().map(|o| o.clone().into_iter().collect()).unwrap_or_default(),
        })
        .collect();
    let pid = Uuid::new_v4().to_string();
    let name = payload["name"].as_str().unwrap_or("Imported Project").to_string();
    let project = Project {
        id: pid.clone(),
        name: name.clone(),
        template_id: None,
        current_environment_id: envs.first().map(|e| e.id.clone()),
        environments: envs,
        notifications: None,
        shared_origin: None,
        file_sync: None,
        items: Some(items),
        tests: None,
        auth: None,
    };
    let env_count = project.environments.len();
    let mut store = state.store.write();
    store.save_active_project();
    store.projects.push(project);
    store.current_project_id = Some(pid.clone());
    store.sync_current_config();
    store.save().map_err(save_err)?;
    Ok(Json(json!({
        "id": pid, "project_id": pid, "name": name, "project_name": name, "path": null,
        "imported": { "tests": tests, "environments": env_count },
        "format": report["format"], "warnings": report["warnings"],
        "missing_private_values": [],
        "config": serde_json::to_value(&store.current_config).unwrap_or(json!({})),
    })))
}

pub async fn update_global(State(state): State<AppState>, Json(data): Json<Value>) -> ApiResult {
    let mut store = state.store.write();
    if let Some(vars) = data.get("variables").and_then(Value::as_object) {
        store.global_variables = vars.clone().into_iter().collect();
    }
    store.sync_current_config();
    store.save().map_err(save_err)?;
    Ok(Json(json!({ "status": "updated", "global_variables": store.global_variables })))
}

// ---- notifications --------------------------------------------------------

fn is_discord(url: &str) -> bool {
    regex_lite_match(url, &["discord.com/api/webhooks/", "discordapp.com/api/webhooks/"])
}
fn is_slack(url: &str) -> bool {
    url.trim().starts_with("https://hooks.slack.com/services/")
}
fn regex_lite_match(url: &str, hosts: &[&str]) -> bool {
    let u = url.trim();
    u.starts_with("https://") && hosts.iter().any(|h| u.contains(h))
}

pub async fn test_notification(State(state): State<AppState>, Path(project_id): Path<String>, Json(data): Json<Value>) -> ApiResult {
    if !state.store.read().projects.iter().any(|p| p.id == project_id) {
        return Err(err(StatusCode::NOT_FOUND, "Project not found"));
    }
    let webhook = data["webhook_url"].as_str().unwrap_or("").trim().to_string();
    let (service, payload) = if is_discord(&webhook) {
        ("Discord", json!({ "embeds": [{ "title": "✅ Beacon connected", "description": "Run notifications will be posted to this channel.", "color": 0x22C55E, "footer": { "text": "Beacon" } }] }))
    } else if is_slack(&webhook) {
        ("Slack", json!({ "attachments": [{ "color": "#22C55E", "blocks": [
            { "type": "section", "text": { "type": "mrkdwn", "text": "✅ *Beacon connected*\nRun notifications will be posted to this channel." } },
            { "type": "context", "elements": [{ "type": "mrkdwn", "text": "Beacon" }] }
        ] }] }))
    } else {
        return Ok(Json(json!({ "ok": false, "error": "That doesn't look like a valid Discord or Slack webhook URL." })));
    };
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().unwrap_or_default();
    Ok(Json(match client.post(&webhook).json(&payload).send().await {
        Ok(r) if r.status().as_u16() >= 400 => json!({ "ok": false, "error": format!("{service} rejected the webhook (HTTP {}).", r.status().as_u16()) }),
        Ok(_) => json!({ "ok": true, "error": null }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }))
}

// ---- datasets -------------------------------------------------------------

const MAX_BYTES: usize = 10 * 1024 * 1024;
const MAX_ROWS: usize = 100_000;

fn cell(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn parse_json_rows(text: &str) -> Result<Vec<Vec<(String, String)>>, String> {
    let mut data: Value = serde_json::from_str(text).map_err(|e| format!("Invalid JSON (line {}): {e}", e.line()))?;
    if data["rows"].is_array() {
        data = data["rows"].take();
    }
    let Some(list) = data.as_array() else { return Err("JSON test data must be an array of objects".into()) };
    list.iter()
        .enumerate()
        .map(|(i, item)| {
            let obj = item.as_object().ok_or_else(|| format!("JSON row {} is not an object", i + 1))?;
            Ok(obj.iter().filter(|(k, _)| !k.trim().is_empty()).map(|(k, v)| (k.trim().to_string(), cell(v))).collect())
        })
        .collect()
}

/// Minimal RFC-4180 CSV: sniffed delimiter (`,;\t|`), double-quote escaping, blank lines skipped.
fn parse_csv_rows(text: &str) -> Result<Vec<Vec<(String, String)>>, String> {
    let sample = &text[..text.len().min(4096)];
    let delim = [',', ';', '\t', '|'].into_iter().max_by_key(|d| sample.matches(*d).count()).unwrap_or(',');
    let mut records: Vec<Vec<String>> = Vec::new();
    let (mut rec, mut field, mut quoted) = (Vec::new(), String::new(), false);
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => { field.push('"'); chars.next(); }
            '"' => quoted = !quoted,
            d if d == delim && !quoted => rec.push(std::mem::take(&mut field)),
            '\r' if !quoted => {}
            '\n' if !quoted => { rec.push(std::mem::take(&mut field)); records.push(std::mem::take(&mut rec)); }
            c => field.push(c),
        }
    }
    if !field.is_empty() || !rec.is_empty() {
        rec.push(field);
        records.push(rec);
    }
    let mut it = records.into_iter();
    let Some(header) = it.next() else { return Ok(vec![]) };
    let columns: Vec<String> = header.iter().map(|h| h.trim().to_string()).collect();
    if columns.iter().all(String::is_empty) {
        return Err("The CSV header row is empty".into());
    }
    let named: Vec<&String> = columns.iter().filter(|c| !c.is_empty()).collect();
    if named.iter().collect::<std::collections::HashSet<_>>().len() != named.len() {
        return Err("The CSV header has duplicate column names".into());
    }
    let mut rows = Vec::new();
    for values in it {
        if values.iter().all(|v| v.trim().is_empty()) {
            continue;
        }
        rows.push(columns.iter().enumerate().filter(|(_, c)| !c.is_empty()).map(|(i, c)| (c.clone(), values.get(i).cloned().unwrap_or_default())).collect());
        if rows.len() > MAX_ROWS {
            break;
        }
    }
    Ok(rows)
}

pub fn parse_dataset(text: &str, format: Option<&str>) -> Result<Vec<Vec<(String, String)>>, String> {
    if text.len() > MAX_BYTES {
        return Err(format!("Test data is larger than {} MB", MAX_BYTES / (1024 * 1024)));
    }
    let text = text.trim_start_matches('\u{feff}');
    let fmt = match format.map(str::to_lowercase).as_deref() {
        Some(f @ ("csv" | "json")) => f.to_string(),
        _ => if text.trim_start().starts_with(['[', '{']) { "json".into() } else { "csv".into() },
    };
    let rows = if fmt == "json" { parse_json_rows(text)? } else { parse_csv_rows(text)? };
    if rows.is_empty() {
        return Err("Test data has no rows".into());
    }
    if rows.len() > MAX_ROWS {
        return Err(format!("Test data has more than {MAX_ROWS} rows"));
    }
    Ok(rows)
}

pub async fn preview_dataset(Json(data): Json<Value>) -> ApiResult {
    if !data.is_object() {
        return Err(bad("Request body must be a JSON object"));
    }
    let rows = parse_dataset(data["text"].as_str().unwrap_or(""), data["format"].as_str()).map_err(|e| bad(format!("{e}")))?;
    let mut columns: Vec<&String> = Vec::new();
    for row in &rows {
        for (c, _) in row {
            if !columns.contains(&c) {
                columns.push(c);
            }
        }
    }
    let preview: Vec<Value> = rows.iter().take(5).map(|r| Value::Object(r.iter().map(|(k, v)| (k.clone(), json!(v))).collect())).collect();
    Ok(Json(json!({ "rows": rows.len(), "columns": columns, "preview": preview })))
}

// ---- GraphQL --------------------------------------------------------------

const INTROSPECTION_QUERY: &str = r#"
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind name description
      fields(includeDeprecated: true) {
        name description
        args { name description type { name kind ofType { name kind } } }
        type { name kind ofType { name kind } }
      }
      inputFields { name description type { name kind ofType { name kind } } }
      enumValues { name description }
    }
  }
}
"#;

// shortcut: no 5-minute schema cache (Python had one); add to AppState if introspection gets slow.
pub async fn graphql_introspect(Json(data): Json<Value>) -> ApiResult {
    let target = data["target_url"].as_str().unwrap_or("").trim().to_string();
    if target.is_empty() {
        return Err(bad("target_url is required"));
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().unwrap_or_default();
    let mut req = client.post(&target).json(&json!({ "query": INTROSPECTION_QUERY }));
    for (k, v) in data["headers"].as_object().into_iter().flatten() {
        req = req.header(k, cell(v));
    }
    let resp = match req.send().await.and_then(|r| r.error_for_status()) {
        Ok(r) => r,
        Err(e) => return Ok(Json(json!({ "ok": false, "error": format!("Could not reach the GraphQL endpoint: {e}") }))),
    };
    let Ok(body) = resp.json::<Value>().await else {
        return Ok(Json(json!({ "ok": false, "error": "The endpoint did not return valid JSON" })));
    };
    let schema = &body["data"]["__schema"];
    if !schema.is_object() {
        let msg = body["errors"][0]["message"].as_str().unwrap_or(if body["errors"].is_array() { "Unknown error" } else { "No schema returned" });
        return Ok(Json(json!({ "ok": false, "error": msg })));
    }
    use sha2::Digest;
    let hash = hex::encode(sha2::Sha256::digest(schema.to_string().as_bytes()))[..12].to_string();
    Ok(Json(json!({ "ok": true, "schema": schema, "hash": hash, "cached": false })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_and_json_datasets() {
        let rows = parse_dataset("a;b\n1;\"x;y\"\n\n2;z\n", None).unwrap();
        assert_eq!(rows[0], vec![("a".into(), "1".into()), ("b".into(), "x;y".into())]);
        assert_eq!(rows.len(), 2);
        assert!(parse_dataset("a,a\n1,2", Some("csv")).unwrap_err().contains("duplicate"));
        let rows = parse_dataset(r#"{"rows":[{"n":1,"t":true}]}"#, None).unwrap();
        assert_eq!(rows[0], vec![("n".into(), "1".into()), ("t".into(), "true".into())]);
        assert!(parse_dataset("", None).is_err());
    }
}
