//! Scheduled monitor: a due project is checked and its result appears on /monitor/status.
use axum::{routing::get, Router};
use beacon_server::{monitor, state::AppState};
use serde_json::json;

#[tokio::test]
async fn check_project_reports_pass_and_fail() {
    let dir = std::env::temp_dir().join(format!("beacon-monitor-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    std::env::set_var("BEACON_DATA_DIR", &dir);

    let upstream = Router::new()
        .route("/ok", get(|| async { axum::Json(json!({ "ok": true })) }))
        .route("/boom", get(|| async { (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "no") }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });

    let state = AppState::new();
    let pid = {
        let mut store = state.store.write();
        let p = store.projects.first_mut().unwrap();
        p.items = Some(vec![
            json!({ "type": "request", "id": "a", "name": "Ok", "method": "GET", "url": format!("{base}/ok") }),
            json!({ "type": "request", "id": "b", "name": "Boom", "method": "GET", "url": format!("{base}/boom") }),
        ]);
        p.tests = None;
        p.id.clone()
    };

    let result = monitor::check_project(&state, &pid).await;
    std::fs::remove_dir_all(&dir).ok();
    assert_eq!(result["summary"]["total"], 2, "{result}");
    assert_eq!(result["summary"]["passed"], 1);
    assert_eq!(result["passed"], false);
    assert_eq!(result["failures"][0]["name"], "Boom");
    assert_eq!(result["failures"][0]["error"], "HTTP 500");
}
