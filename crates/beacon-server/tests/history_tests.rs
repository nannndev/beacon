//! Run history + scenario endpoints, driven against a copy of a real
//! Python-written `history.db` so the legacy schema keeps working.

use axum::body::Body;
use axum::{routing::get, Router};
use beacon_server::{app_router, state::AppState};
use http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const LEGACY_DB: &str = "/tmp/parity/history-copy.db";

async fn call(app: &Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value, String) {
    let mut req = Request::builder().uri(uri).method(method);
    let body = match body {
        Some(b) => {
            req = req.header("Content-Type", "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).into_owned();
    (status, serde_json::from_str(&text).unwrap_or(Value::Null), text)
}

/// Tiny upstream so runs have something real to hit.
async fn upstream() -> String {
    let app = Router::new().route("/ping", get(|| async { axum::Json(json!({ "ok": true })) }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

// One test so BEACON_DATA_DIR is set exactly once for this process.
#[tokio::test]
async fn history_and_scenario_end_to_end() {
    let dir = std::env::temp_dir().join(format!("beacon-history-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let legacy = std::path::Path::new(LEGACY_DB).exists();
    if legacy {
        std::fs::copy(LEGACY_DB, dir.join("history.db")).unwrap();
    }
    std::env::set_var("BEACON_DATA_DIR", &dir);
    let app = app_router(AppState::new());

    // --- health + legacy read -------------------------------------------------
    let (st, health, _) = call(&app, "GET", "/history/health", None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(health["available"], true, "{health}");
    assert_eq!(health["backup_available"], false);

    if legacy {
        let (st, list, _) = call(&app, "GET", "/history?limit=5", None).await;
        assert_eq!(st, StatusCode::OK);
        let items = list["items"].as_array().unwrap();
        assert_eq!(items.len(), 5);
        assert!(list["next_cursor"].is_string());
        assert!(items[0]["is_pinned"].is_boolean());
        assert!(items[0]["started_at"].as_str().unwrap() >= items[1]["started_at"].as_str().unwrap());

        // Cursor pagination yields different rows; a bad cursor is a 400.
        let cursor = list["next_cursor"].as_str().unwrap();
        let (st, page2, _) = call(&app, "GET", &format!("/history?limit=5&cursor={cursor}"), None).await;
        assert_eq!(st, StatusCode::OK);
        assert_ne!(page2["items"][0]["id"], items[0]["id"]);
        let (st, _, _) = call(&app, "GET", "/history?cursor=%21%21", None).await;
        assert_eq!(st, StatusCode::BAD_REQUEST);

        // Filters.
        let (_, scen, _) = call(&app, "GET", "/history?source_type=scenario&status=completed&limit=100", None).await;
        assert!(scen["items"].as_array().unwrap().iter().all(|r| r["source_type"] == "scenario" && r["status"] == "completed"));
        let (st, _, _) = call(&app, "GET", "/history?status=bogus", None).await;
        assert_eq!(st, StatusCode::BAD_REQUEST);

        // Detail of a run that has metrics + samples.
        let (_, completed, _) = call(&app, "GET", "/history?status=completed&source_type=endpoint&limit=2", None).await;
        let a = completed["items"][0]["id"].as_str().unwrap().to_string();
        let b = completed["items"][1]["id"].as_str().unwrap().to_string();
        let (st, detail, _) = call(&app, "GET", &format!("/history/{a}"), None).await;
        assert_eq!(st, StatusCode::OK);
        assert!(detail["config_snapshot"].is_object());
        assert!(detail["metrics"]["attempts"].is_number());
        assert!(detail["steps"].is_array() && detail["samples"].is_array() && detail["events"].is_array());
        assert!(detail["steps"][0].get("run_id").is_none());

        // Compare.
        let (st, cmp, _) = call(&app, "POST", "/history/compare", Some(json!({ "baseline_id": a, "candidate_id": b }))).await;
        assert_eq!(st, StatusCode::OK, "{cmp}");
        assert_eq!(cmp["same_mode"], true);
        assert!(cmp["deltas"]["attempts"]["value"].is_number());
        assert!(cmp["deltas"]["p95_ms"].get("improved").is_some());
        assert!(cmp["series"].is_array());
        let (st, _, _) = call(&app, "POST", "/history/compare", Some(json!({ "baseline_id": a, "candidate_id": a }))).await;
        assert_eq!(st, StatusCode::BAD_REQUEST);

        // Export + report.
        let (st, export, _) = call(&app, "GET", &format!("/history/{a}/export"), None).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(export["format"], "beacon.run-history");
        assert_eq!(export["run"]["id"], a);
        let (st, _, html) = call(&app, "GET", &format!("/history/{a}/report"), None).await;
        assert_eq!(st, StatusCode::OK);
        assert!(html.starts_with("<!doctype html>") && html.contains("BEACON EXECUTIVE REPORT"));
        let (st, _, md) = call(&app, "GET", &format!("/history/{a}/report?format=md"), None).await;
        assert_eq!(st, StatusCode::OK);
        assert!(md.starts_with("# Beacon Run Report"));

        // Patch (label/pin) + delete.
        let (st, patched, _) = call(&app, "PATCH", &format!("/history/{a}"), Some(json!({ "label": "baseline", "is_pinned": true }))).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(patched["label"], "baseline");
        assert_eq!(patched["is_pinned"], true);
        let (_, pinned, _) = call(&app, "GET", "/history?pinned=true", None).await;
        assert!(pinned["items"].as_array().unwrap().iter().any(|r| r["id"] == a));
        let (st, _, _) = call(&app, "PATCH", &format!("/history/{a}"), Some(json!({ "mode": "x" }))).await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
        let (st, _, _) = call(&app, "DELETE", &format!("/history/{b}"), None).await;
        assert_eq!(st, StatusCode::OK);
        let (st, _, _) = call(&app, "GET", &format!("/history/{b}"), None).await;
        assert_eq!(st, StatusCode::NOT_FOUND);
    }

    // --- an endpoint to run against ------------------------------------------
    let base = upstream().await;
    let (st, ep, _) = call(&app, "POST", "/tests", Some(json!({ "id": "ping-ep", "name": "Ping", "url": format!("{base}/ping"), "method": "GET" }))).await;
    assert_eq!(st, StatusCode::OK);
    let ep_id = ep["id"].as_str().unwrap().to_string();

    // --- /run persists a history row -----------------------------------------
    let (st, run, _) = call(&app, "POST", "/run", Some(json!({ "test_id": ep_id, "max_requests": 3, "delay": 0, "concurrency": 1 }))).await;
    assert_eq!(st, StatusCode::OK);
    let history_id = run["history_id"].as_str().expect("history_id persisted").to_string();
    let run_id = run["run_id"].as_str().unwrap();
    for _ in 0..100 {
        let (_, status, _) = call(&app, "GET", &format!("/status/{run_id}"), None).await;
        if status["status"] == "finished" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let (st, detail, _) = call(&app, "GET", &format!("/history/{history_id}"), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(detail["status"], "completed");
    assert_eq!(detail["source_type"], "endpoint");
    assert_eq!(detail["metrics"]["attempts"], 3);
    assert_eq!(detail["metrics"]["success"], 3);
    assert_eq!(detail["steps"][0]["status"], "completed");
    assert_eq!(detail["config_snapshot"]["max_requests"], 3);
    assert!(detail["samples"].as_array().unwrap().len() >= 1);
    assert_eq!(detail["events"][0]["outcome"], "success");

    // --- grouped history (Run All) -------------------------------------------
    let (st, group, _) = call(&app, "POST", "/history/groups", Some(json!({ "source_type": "run_all", "endpoint_ids": [ep_id, ep_id], "mode": "load" }))).await;
    assert_eq!(st, StatusCode::OK, "{group}");
    let gid = group["history_id"].as_str().unwrap().to_string();
    let (st, _, _) = call(&app, "POST", "/history/groups", Some(json!({ "endpoint_ids": ["nope"] }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, run, _) = call(&app, "POST", "/run", Some(json!({ "test_id": ep_id, "max_requests": 2, "delay": 0, "history_id": gid, "history_step_index": 0 }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(run["history_id"], gid);
    let run_id = run["run_id"].as_str().unwrap();
    for _ in 0..100 {
        let (_, status, _) = call(&app, "GET", &format!("/status/{run_id}"), None).await;
        if status["status"] == "finished" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let (_, detail, _) = call(&app, "GET", &format!("/history/{gid}"), None).await;
    assert_eq!(detail["status"], "running", "group stays open until every step finishes");
    assert_eq!(detail["steps"][0]["status"], "completed");
    let (st, fin, _) = call(&app, "POST", &format!("/history/{gid}/finish"), Some(json!({ "status": "stopped" }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(fin["status"], "stopped");
    let (_, detail, _) = call(&app, "GET", &format!("/history/{gid}"), None).await;
    assert_eq!(detail["status"], "stopped");
    assert_eq!(detail["metrics"]["attempts"], 2);

    // --- scenario (sync) -----------------------------------------------------
    let (st, res, _) = call(&app, "POST", "/scenario", Some(json!({ "test_ids": [ep_id, "missing"], "continue_on_error": true }))).await;
    assert_eq!(st, StatusCode::OK, "{res}");
    assert_eq!(res["passed"], false);
    assert_eq!(res["completed"], 2);
    assert_eq!(res["steps"][0]["success"], true);
    assert_eq!(res["steps"][1]["failure"]["kind"], "endpoint_missing");
    let sid = res["history_id"].as_str().unwrap();
    let (_, detail, _) = call(&app, "GET", &format!("/history/{sid}"), None).await;
    assert_eq!(detail["source_type"], "scenario");
    assert_eq!(detail["status"], "completed", "only known endpoints become steps; the one step passed");
    let (st, _, _) = call(&app, "POST", "/scenario", Some(json!({ "test_ids": [] }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    // --- scenario/start (virtual users, polled) ------------------------------
    let (st, started, _) = call(&app, "POST", "/scenario/start", Some(json!({ "test_ids": [ep_id], "virtual_users": 2, "iterations": 2 }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(started["mode"], "scenario");
    let run_id = started["run_id"].as_str().unwrap();
    let mut last = Value::Null;
    for _ in 0..100 {
        let (_, status, _) = call(&app, "GET", &format!("/status/{run_id}"), None).await;
        last = status;
        if last["status"] != "running" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert_eq!(last["status"], "finished", "{last}");
    assert_eq!(last["result"]["passed"], true);
    assert_eq!(last["result"]["completed_flows"], 4);
    assert_eq!(last["progress"]["completed_flows"], 4);
    assert_eq!(last["scenario_steps"][0]["state"], "passed");
    assert_eq!(last["scenario_steps"][0]["attempts"], 4);
    assert_eq!(last["recent_events"].as_array().unwrap().len(), 4);
    let sid = last["result"]["history_id"].as_str().unwrap();
    let (_, detail, _) = call(&app, "GET", &format!("/history/{sid}"), None).await;
    assert_eq!(detail["status"], "completed");
    assert_eq!(detail["metrics"]["attempts"], 4);
    assert_eq!(detail["config_snapshot"]["virtual_users"], 2);

    // --- rebuild keeps a backup ---------------------------------------------
    let (st, _, _) = call(&app, "POST", "/history/rebuild", Some(json!({ "confirm": "no" }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    let (st, rebuilt, _) = call(&app, "POST", "/history/rebuild", Some(json!({ "confirm": "RESET HISTORY" }))).await;
    assert_eq!(st, StatusCode::OK, "{rebuilt}");
    let (_, health, _) = call(&app, "GET", "/history/health", None).await;
    assert_eq!(health["available"], true);
    assert_eq!(health["backup_available"], true);
    let (_, list, _) = call(&app, "GET", "/history", None).await;
    assert_eq!(list["items"].as_array().unwrap().len(), 0);

    let _ = std::fs::remove_dir_all(&dir);
}
