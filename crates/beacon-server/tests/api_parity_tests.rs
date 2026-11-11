use axum::body::Body;
use beacon_server::{app_router, state::AppState};
use http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_system_info() {
    let state = AppState::new();
    let app = app_router(state);

    let req = Request::builder()
        .uri("/system/info")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json_val: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json_val["api_protocol"], 2);
    assert!(json_val["capabilities"].is_array());
}

#[tokio::test]
async fn test_projects_crud_and_config() {
    let state = AppState::new();
    let app = app_router(state);

    // 1. List projects
    let req = Request::builder()
        .uri("/projects")
        .method("GET")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json_val: Value = serde_json::from_slice(&body).unwrap();
    assert!(json_val["projects"].is_array());
    assert!(json_val["current_project_id"].is_string());

    // 2. Create a new project
    let req = Request::builder()
        .uri("/projects")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(
            json!({
                "name": "Rust Test Project",
                "base_url": "https://httpbin.org",
                "variables": { "foo": "bar" }
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let created: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(created["name"], "Rust Test Project");
    let _proj_id = created["id"].as_str().unwrap().to_string();

    // 3. Get config of the active project
    let req = Request::builder()
        .uri("/config")
        .method("GET")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let cfg: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(cfg["base_url"], "https://httpbin.org");
    assert_eq!(cfg["variables"]["foo"], "bar");

    // 4. Add an endpoint test
    let req = Request::builder()
        .uri("/tests")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(
            json!({
                "id": "t1",
                "name": "Get Anything",
                "url": "/anything",
                "method": "GET",
                "headers": {},
                "payload": {},
                "assertions": []
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 5. Verify test is in list
    let req = Request::builder()
        .uri("/tests")
        .method("GET")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let tests_arr: Vec<Value> = serde_json::from_slice(&body).unwrap();
    assert!(tests_arr.iter().any(|t| t["id"] == "t1"));

    // 6. Test Start Run and Stop Run
    let req = Request::builder()
        .uri("/run")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(
            json!({
                "test_id": "t1",
                "concurrency": 2,
                "delay": 0.05,
                "max_requests": 5,
                "mode": "load"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let run_res: Value = serde_json::from_slice(&body).unwrap();
    let run_id = run_res["run_id"].as_str().unwrap().to_string();

    // Check status
    let req = Request::builder()
        .uri(format!("/status/{}", run_id))
        .method("GET")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Stop run
    let req = Request::builder()
        .uri(format!("/stop/{}", run_id))
        .method("POST")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 7. Verify AI Gateway routes
    let req = Request::builder()
        .uri("/v1/models")
        .method("GET")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let models_val: Value = serde_json::from_slice(&body).unwrap();
    assert!(models_val["data"].is_array());
    assert!(!models_val["data"].as_array().unwrap().is_empty());

    let req = Request::builder()
        .uri("/gateway/admin/providers")
        .method("GET")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 8. Verify Beacon AI Agent routes
    let req = Request::builder()
        .uri("/agent/models")
        .method("GET")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let agent_models_val: Value = serde_json::from_slice(&body).unwrap();
    assert!(agent_models_val.get("subscriptions").is_some());

    let req = Request::builder()
        .uri("/agent/context")
        .method("GET")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let agent_ctx_val: Value = serde_json::from_slice(&body).unwrap();
    assert!(agent_ctx_val.get("base_url").is_some());
}
