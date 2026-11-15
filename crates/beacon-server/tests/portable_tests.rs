//! Project import/export, delete, global vars, datasets, GraphQL, notifications, and the
//! pre-request script hook, driven through `app_router` against a temp data dir.
use axum::body::Body;
use beacon_server::{app_router, state::AppState};
use http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

fn app() -> axum::Router {
    let dir = std::env::temp_dir().join(format!("beacon-portable-{}-{}", std::process::id(), uuid::Uuid::new_v4().simple()));
    let _ = std::fs::remove_dir_all(&dir);
    std::env::set_var("BEACON_DATA_DIR", &dir);
    app_router(AppState::new())
}

async fn call(app: &axum::Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let req = Request::builder()
        .uri(uri)
        .method(method)
        .header("Content-Type", "application/json")
        .body(body.map(|b| Body::from(b.to_string())).unwrap_or_else(Body::empty))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

#[tokio::test]
async fn import_preview_every_format() {
    let app = app();
    for (file, format, endpoints) in [
        ("beacon.json", "beacon", 2),
        ("postman.json", "postman", 2),
        ("openapi.yaml", "openapi3", 2),
        ("swagger.json", "swagger2", 1),
        ("insomnia.json", "insomnia", 1),
        ("capture.har", "har", 1),
    ] {
        let (status, body) = call(&app, "POST", "/projects/import/preview", Some(json!({ "content": fixture(file), "filename": file }))).await;
        assert_eq!(status, StatusCode::OK, "{file}: {body}");
        assert_eq!(body["format"], format, "{file}: {body}");
        assert_eq!(body["summary"]["endpoints"], endpoints, "{file}: {body}");
        assert!(body.get("project").is_none(), "preview must not include the project");
    }
    let (status, body) = call(&app, "POST", "/projects/import/preview", Some(json!({ "content": "hello: world" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["detail"].as_str().unwrap().contains("not recognized"));
}

#[tokio::test]
async fn import_export_delete_roundtrip() {
    let app = app();
    let (status, imported) = call(&app, "POST", "/projects/import", Some(json!({ "content": fixture("openapi.yaml"), "filename": "openapi.yaml" }))).await;
    assert_eq!(status, StatusCode::OK, "{imported}");
    assert_eq!(imported["imported"]["tests"], 2);
    assert_eq!(imported["config"]["base_url"], "https://pets.example.com/v1");
    let pid = imported["id"].as_str().unwrap().to_string();

    let (_, list) = call(&app, "GET", "/projects", None).await;
    assert_eq!(list["current_project_id"], pid);

    let (status, exported) = call(&app, "GET", &format!("/projects/{pid}/export"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(exported["format"], "security-tools.project");
    assert_eq!(exported["secrets_included"], false);
    assert_eq!(exported["project"]["items"][0]["type"], "folder");

    // Export re-imports (Beacon format) and respects include_secrets.
    let (_, pm) = call(&app, "POST", "/projects/import", Some(json!({ "content": fixture("postman.json") }))).await;
    let pm_id = pm["id"].as_str().unwrap();
    let (_, redacted) = call(&app, "GET", &format!("/projects/{pm_id}/export"), None).await;
    assert_eq!(redacted["project"]["environments"][0]["variables"]["token"], "");
    let (_, full) = call(&app, "GET", &format!("/projects/{pm_id}/export?include_secrets=true"), None).await;
    assert_eq!(full["project"]["environments"][0]["variables"]["token"], "secret");
    let (status, again) = call(&app, "POST", "/projects/import/preview", Some(full.clone())).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["format"], "beacon");

    let (status, t) = call(&app, "GET", "/projects/template", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(t["project"]["items"].as_array().unwrap().len(), 2);

    // Deleting the active project leaves a valid active project.
    let (status, del) = call(&app, "DELETE", &format!("/projects/{pm_id}"), None).await;
    assert_eq!(status, StatusCode::OK, "{del}");
    assert_ne!(del["current_project_id"], pm_id);
    assert!(del["current_project_id"].is_string());
    let (status, _) = call(&app, "DELETE", &format!("/projects/{pm_id}"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn global_variables_dataset_and_graphql() {
    let app = app();
    let (status, g) = call(&app, "PUT", "/global", Some(json!({ "variables": { "region": "eu" } }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(g["global_variables"]["region"], "eu");
    let (_, cfg) = call(&app, "GET", "/config", None).await;
    assert_eq!(cfg["variables"]["region"], "eu");

    let (status, ds) = call(&app, "POST", "/datasets/preview", Some(json!({ "text": "user,pass\nalice,a1\nbob,b2\n", "format": "csv" }))).await;
    assert_eq!(status, StatusCode::OK, "{ds}");
    assert_eq!(ds["rows"], 2);
    assert_eq!(ds["columns"], json!(["user", "pass"]));
    assert_eq!(ds["preview"][1]["user"], "bob");
    let (status, ds) = call(&app, "POST", "/datasets/preview", Some(json!({ "text": "[1]" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(ds["detail"].as_str().unwrap().contains("not an object"));

    let (status, gq) = call(&app, "POST", "/graphql/introspect", Some(json!({ "target_url": "http://127.0.0.1:1/graphql" }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(gq["ok"], false);
    let (status, _) = call(&app, "POST", "/graphql/introspect", Some(json!({}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn notification_test_validates_webhook() {
    let app = app();
    let (_, list) = call(&app, "GET", "/projects", None).await;
    let pid = list["current_project_id"].as_str().unwrap();
    let (status, n) = call(&app, "POST", &format!("/projects/{pid}/notifications/test"), Some(json!({ "webhook_url": "https://example.com/x" }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(n["ok"], false);
    assert!(n["error"].as_str().unwrap().contains("Discord or Slack"));
    let (status, _) = call(&app, "POST", "/projects/nope/notifications/test", Some(json!({ "webhook_url": "" }))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn pre_request_script_sets_variable_used_in_request() {
    if std::process::Command::new("python3").arg("--version").output().is_err() {
        eprintln!("skipping: python3 not installed");
        return;
    }
    let app = app();
    // Local server that echoes the request path so the test proves the script's variable reached the URL.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut buf = vec![0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = head.split_whitespace().nth(1).unwrap_or("").to_string();
                let body = json!({ "path": path }).to_string();
                let _ = sock.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await;
            });
        }
    });

    let (status, test) = call(&app, "POST", "/tests", Some(json!({
        "id": "ep-scripted", "name": "scripted", "url": format!("http://{addr}/items/{{{{item_id}}}}"), "method": "GET",
        "pre_request_script": "import uuid\nbeacon.environment.set('item_id', 'from-script')\nbeacon.request.url = beacon.request.url.replace('{{item_id}}', beacon.environment.get('item_id'))",
    }))).await;
    assert_eq!(status, StatusCode::OK, "{test}");
    let id = test["id"].as_str().unwrap();

    let (status, sent) = call(&app, "POST", "/send", Some(json!({ "test_id": id }))).await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    assert_eq!(sent["ok"], true, "{sent}");
    assert_eq!(sent["json"]["path"], "/items/from-script", "{sent}");
    assert!(sent["extracted"].as_array().unwrap().contains(&json!("item_id")));
    // The variable the script set is persisted and templated on the next send.
    let (_, cfg) = call(&app, "GET", "/config", None).await;
    assert_eq!(cfg["variables"]["item_id"], "from-script");

    // A broken script never blocks the request and is reported.
    let (_, bad) = call(&app, "POST", "/send", Some(json!({ "test_id": id, "draft": { "pre_request_script": "import os" } }))).await;
    assert_eq!(bad["ok"], true, "{bad}");
    assert!(bad["error"].as_str().unwrap().contains("not available"), "{bad}");
}
