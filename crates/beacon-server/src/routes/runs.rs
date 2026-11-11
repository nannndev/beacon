use crate::state::{ActiveRun, AppState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use beacon_core::{APITester, EndpointTest};
use chrono::Local;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

pub async fn send_single(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let test_id = match payload.get("test_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "detail": "Missing required field: test_id" })),
            ));
        }
    };

    let mut test = match state.find_test(&test_id) {
        Some(t) => t,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "detail": "Endpoint not found" })),
            ));
        }
    };

    if let Some(draft) = payload.get("draft").and_then(|d| d.as_object()) {
        let mut test_json = serde_json::to_value(&test).unwrap_or(json!({}));
        if let Some(obj) = test_json.as_object_mut() {
            for (k, v) in draft {
                if !v.is_null() && k != "id" {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
        if let Ok(merged) = serde_json::from_value::<EndpointTest>(test_json) {
            test = merged;
        }
    }

    let config = {
        let store = state.store.read();
        store.current_config.clone()
    };

    let tester = APITester::new(test, config, 1, 0, 1, None);
    let output = match tester.execute_single().await {
        Ok(out) => out,
        Err(err) => {
            return Ok(Json(json!({
                "ok": false,
                "error": err,
                "status": 0,
                "time_ms": 0,
                "target": "",
                "headers": {},
                "body": "",
                "json": Value::Null,
                "assertions": [],
                "extracted": [],
                "passed": false,
            })));
        }
    };

    if !output.extracted.is_empty() {
        let mut store = state.store.write();
        let _ = store.save();
    }

    let all_passed = if output.assertions.is_empty() {
        None
    } else {
        Some(output.assertions.iter().all(|a| a.ok))
    };

    let res_json = json!({
        "ok": output.status >= 200 && output.status < 400,
        "status": output.status,
        "time_ms": output.time_ms,
        "size_bytes": output.body.len(),
        "target": output.target_url,
        "target_url": output.target_url,
        "method": output.method,
        "headers": output.headers,
        "body": output.body,
        "json": output.json,
        "assertions": output.assertions,
        "extracted": output.extracted,
        "rate_limited": output.rate_limited,
        "passed": all_passed,
        "attempts": 1,
    });

    Ok(Json(res_json))
}

pub async fn start_run(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let test_id = match payload.get("test_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "detail": "Missing required field: test_id" })),
            ));
        }
    };

    let test = match state.find_test(&test_id) {
        Some(t) => t,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "detail": "Endpoint not found" })),
            ));
        }
    };

    let concurrency = payload
        .get("concurrency")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as usize;
    let delay_s = payload
        .get("delay")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.1);
    let use_min_delay = payload
        .get("use_min_delay")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let delay_ms = if use_min_delay { 1 } else { (delay_s * 1000.0) as u64 };
    let max_requests = payload
        .get("max_requests")
        .and_then(|v| v.as_u64())
        .unwrap_or(100);
    let mode = payload
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("load")
        .to_string();

    let run_id = Uuid::new_v4().simple().to_string()[..16].to_string();
    let active_run = Arc::new(ActiveRun::new(run_id.clone(), test_id));

    {
        let mut runs = state.runs.write();
        runs.insert(run_id.clone(), Arc::clone(&active_run));
    }

    let config = {
        let store = state.store.read();
        store.current_config.clone()
    };

    let run_clone = Arc::clone(&active_run);
    let state_clone = state.clone();
    let run_id_clone = run_id.clone();

    tokio::spawn(async move {
        let tester = APITester::new(
            test,
            config,
            concurrency,
            delay_ms,
            max_requests,
            Some(Arc::clone(&run_clone.stop_flag)),
        );

        let snap = tester
            .run_load(|snap, maybe_output| {
                let snap_val = serde_json::to_value(snap).unwrap_or(json!({}));
                *run_clone.stats.write() = snap_val.clone();
                state_clone.broadcast_ws(json!({
                    "type": "stats",
                    "run_id": run_id_clone,
                    "stats": snap_val
                }));

                if let Some(out) = maybe_output {
                    let out_val = serde_json::to_value(out).unwrap_or(json!({}));
                    {
                        let mut resp_lock = run_clone.responses.write();
                        resp_lock.push(out_val.clone());
                        if resp_lock.len() > 100 {
                            resp_lock.remove(0);
                        }
                    }
                    state_clone.broadcast_ws(json!({
                        "type": "response",
                        "run_id": run_id_clone,
                        "response": out_val
                    }));

                    let ts = Local::now().format("%H:%M:%S").to_string();
                    let log_entry = format!("[{}] {} {} -> {}", ts, out.method, out.target_url, out.status);
                    {
                        let mut log_lock = run_clone.logs.write();
                        log_lock.push(log_entry.clone());
                        if log_lock.len() > 100 {
                            log_lock.remove(0);
                        }
                    }
                    state_clone.broadcast_ws(json!({
                        "type": "log",
                        "run_id": run_id_clone,
                        "message": log_entry
                    }));
                }
            })
            .await;

        let final_snap = serde_json::to_value(&snap).unwrap_or(json!({}));
        *run_clone.stats.write() = final_snap;
        *run_clone.status.write() = "finished".into();

        state_clone.broadcast_ws(json!({
            "type": "run_finished",
            "run_id": run_id_clone,
            "status": "finished"
        }));
    });

    Ok(Json(json!({
        "run_id": run_id,
        "mode": mode,
        "history_id": run_id
    })))
}

pub async fn get_status(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let runs = state.runs.read();
    let run = match runs.get(&run_id) {
        Some(r) => Arc::clone(r),
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "detail": "Run not found" })),
            ));
        }
    };

    let status = run.status.read().clone();
    let stats = run.stats.read().clone();
    let logs = run.logs.read().clone();
    let responses = run.responses.read().clone();
    let progress = run.progress.read().clone();
    let scenario_steps = run.scenario_steps.read().clone();
    let recent_events = run.recent_events.read().clone();
    let failure = run.failure.read().clone();

    Ok(Json(json!({
        "status": status,
        "stats": stats,
        "logs": logs,
        "responses": responses,
        "result": Value::Null,
        "progress": progress,
        "scenario_steps": scenario_steps,
        "recent_events": recent_events,
        "failure": failure,
    })))
}

pub async fn stop_run(State(state): State<AppState>, Path(run_id): Path<String>) -> Json<Value> {
    let runs = state.runs.read();
    if let Some(run) = runs.get(&run_id) {
        run.stop();
    }
    Json(json!({ "status": "stopping" }))
}

pub async fn proxy_request(
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let url = match payload.get("url").and_then(|v| v.as_str()) {
        Some(u) => u,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "detail": "Missing required field: url" })),
            ));
        }
    };

    let method_str = payload
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET")
        .to_uppercase();

    let client = reqwest::Client::new();
    let method = match method_str.as_str() {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(method, url);
    if let Some(headers) = payload.get("headers").and_then(|h| h.as_object()) {
        for (k, v) in headers {
            if let Some(val_str) = v.as_str() {
                req = req.header(k, val_str);
            }
        }
    }

    if let Some(body) = payload.get("payload") {
        if !body.is_null() {
            req = req.json(body);
        }
    }

    let start = std::time::Instant::now();
    match req.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let mut headers_map = HashMap::new();
            for (k, v) in resp.headers() {
                if let Ok(val) = v.to_str() {
                    headers_map.insert(k.as_str().to_string(), val.to_string());
                }
            }
            let text = resp.text().await.unwrap_or_default();
            let parsed_json = serde_json::from_str::<Value>(&text).ok();
            let elapsed = start.elapsed().as_millis() as f64;

            Ok(Json(json!({
                "ok": status >= 200 && status < 400,
                "status": status,
                "time_ms": elapsed,
                "headers": headers_map,
                "body": text,
                "json": parsed_json,
                "target": url,
            })))
        }
        Err(e) => Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({ "detail": format!("Proxy request failed: {}", e) })),
        )),
    }
}
