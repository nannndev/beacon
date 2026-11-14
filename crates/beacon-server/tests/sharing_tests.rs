//! LAN sharing lifecycle over real loopback TLS: host enables, member joins with
//! a pairing code, edits sync both ways, conflicts are detected and resolved.
use axum::body::Body;
use beacon_server::{app_router, state::AppState};
use http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

async fn call(app: &axum::Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let req = Request::builder()
        .uri(uri)
        .method(method)
        .header("content-type", "application/json")
        .body(body.map(|b| Body::from(b.to_string())).unwrap_or_else(Body::empty))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn fresh_state(name: &str, project_id: &str) -> AppState {
    let dir = std::env::temp_dir().join(format!("beacon-sharing-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("tests.json"),
        json!({
            "current_project_id": project_id,
            "projects": [{
                "id": project_id, "name": format!("{name} project"), "current_environment_id": "env1",
                "environments": [{"id": "env1", "name": "Local", "base_url": "https://example.com", "variables": {"api_token": "SECRET-VALUE", "region": "eu"}}],
                "notifications": {"discord_webhook": "https://discord/hook"},
                "items": [{"id": "e1", "type": "request", "name": "Before", "url": "https://example.com", "method": "GET", "headers": {}, "payload": {}}]
            }],
            "global_variables": {}
        })
        .to_string(),
    )
    .unwrap();
    // AppState reads BEACON_DATA_DIR at construction; this file holds a single test so the env var is not raced.
    std::env::set_var("BEACON_DATA_DIR", &dir);
    AppState::new()
}

fn project(app: &axum::Router) -> impl std::future::Future<Output = Value> + '_ {
    async move {
        let (_, body) = call(app, "GET", "/projects", None).await;
        body["projects"].as_array().unwrap().iter().find(|p| p["id"] == "p1").cloned().unwrap()
    }
}

#[tokio::test]
async fn host_member_lifecycle_over_loopback_tls() {
    std::env::set_var("BEACON_SHARE_PORT", "0");
    let host_state = fresh_state("host", "p1");
    let host = app_router(host_state.clone());
    let member_state = fresh_state("member", "own-project");
    let member = app_router(member_state.clone());

    // Every endpoint in the sharing surface must be routed (never 404 for "unknown route").
    for (m, uri) in [
        ("GET", "/sharing/projects/zzz"), ("GET", "/sharing/projects/zzz/revisions"), ("GET", "/sharing/projects/zzz/watch"),
        ("POST", "/sharing/projects/zzz/enable"), ("POST", "/sharing/projects/zzz/disable"), ("POST", "/sharing/projects/zzz/pairing-code"),
        ("POST", "/sharing/projects/zzz/requests/r/decision"), ("POST", "/sharing/projects/zzz/sync"), ("POST", "/sharing/projects/zzz/conflict/team"),
        ("POST", "/sharing/projects/zzz/leave"), ("POST", "/sharing/projects/zzz/duplicate-private"), ("PATCH", "/sharing/projects/zzz/members/d"),
        ("DELETE", "/sharing/projects/zzz/members/d"), ("POST", "/sharing/join"), ("POST", "/sharing/join/status"),
    ] {
        let (status, body) = call(&host, m, uri, Some(json!({}))).await;
        assert!(status != StatusCode::METHOD_NOT_ALLOWED, "{m} {uri} not routed");
        assert!(status == StatusCode::OK || body["detail"].is_string(), "{m} {uri}: {status} {body}");
    }

    // Not shared yet.
    let (status, body) = call(&host, "GET", "/sharing/projects/p1", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["sharing_enabled"], false);

    // Enable: repository snapshot must redact secrets and device-local metadata.
    let (status, enabled) = call(&host, "POST", "/sharing/projects/p1/enable", None).await;
    assert_eq!(status, StatusCode::OK, "{enabled}");
    assert_eq!(enabled["sharing_enabled"], true);
    assert_eq!(enabled["host"]["hosting"], true);
    let address = enabled["host"]["address"].as_str().unwrap().to_string();
    let port = address.rsplit(':').next().unwrap().to_string();
    let code = enabled["host"]["pairing_code"].as_str().unwrap().to_string();
    assert_eq!(code.len(), 6);
    let snapshot = host_state.sharing.repo.snapshot("p1").unwrap().unwrap();
    let vars = &snapshot["source"]["environments"][0]["variables"];
    assert_eq!(vars["api_token"], json!({"key": "api_token", "scope": "private", "value": null}));
    assert_eq!(vars["region"]["value"], "eu");
    assert!(snapshot["source"].get("notifications").is_none());
    assert!(!snapshot.to_string().contains("SECRET-VALUE"));

    // Refresh pairing code.
    let (status, refreshed) = call(&host, "POST", "/sharing/projects/p1/pairing-code", None).await;
    assert_eq!(status, StatusCode::OK);
    let code = refreshed["pairing_code"].as_str().unwrap().to_string();

    // Join with wrong code is refused with the host's detail.
    let loopback = format!("127.0.0.1:{port}");
    let (status, body) = call(&member, "POST", "/sharing/join", Some(json!({"address": loopback, "code": "000000", "device_name": "Laptop"}))).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body["detail"], "Invalid pairing code");

    // Join with the right code -> pending, then host approves as editor.
    let (status, pending) = call(&member, "POST", "/sharing/join", Some(json!({"address": loopback, "code": code, "device_name": "Laptop"}))).await;
    assert_eq!(status, StatusCode::OK, "{pending}");
    assert_eq!(pending["status"], "pending");
    assert!(pending["certificate_fingerprint"].as_str().unwrap().contains(':'));
    let request_id = pending["request_id"].as_str().unwrap().to_string();
    let (_, body) = call(&member, "POST", "/sharing/join/status", Some(json!({"address": loopback, "request_id": request_id}))).await;
    assert_eq!(body["status"], "pending");
    let (_, status_body) = call(&host, "GET", "/sharing/projects/p1", None).await;
    assert_eq!(status_body["host"]["pending_requests"][0]["device_name"], "Laptop");
    let (status, decided) = call(&host, "POST", &format!("/sharing/projects/p1/requests/{request_id}/decision"), Some(json!({"approved": true, "role": "editor"}))).await;
    assert_eq!(status, StatusCode::OK, "{decided}");
    assert_eq!(decided["status"], "approved");

    let (status, joined) = call(&member, "POST", "/sharing/join/status", Some(json!({"address": loopback, "request_id": request_id}))).await;
    assert_eq!(status, StatusCode::OK, "{joined}");
    assert_eq!(joined["status"], "approved");
    assert_eq!(joined["project_id"], "p1");
    let member_project = project(&member).await;
    assert_eq!(member_project["shared_origin"]["role"], "editor");
    // Secret never reached the teammate; shared variable did.
    assert_eq!(member_project["environments"][0]["variables"]["api_token"], "");
    assert_eq!(member_project["environments"][0]["variables"]["region"], "eu");
    assert_eq!(member_project["notifications"], json!({}));
    let (_, member_status) = call(&member, "GET", "/sharing/projects/p1", None).await;
    assert_eq!(member_status["member"]["connection_state"], "connected");
    let (_, host_status) = call(&host, "GET", "/sharing/projects/p1", None).await;
    assert_eq!(host_status["trusted_devices"][0]["role"], "editor");
    assert_eq!(host_status["host"]["connected_members"][0]["device_name"], "Laptop");

    // Host edits -> member watch sees the change.
    let mut edited = project(&host).await;
    edited["name"] = json!("Renamed by host");
    let (status, _) = call(&host, "PUT", "/projects/p1", Some(edited)).await;
    assert_eq!(status, StatusCode::OK);
    let (_, synced) = call(&host, "POST", "/sharing/projects/p1/sync", None).await;
    assert_eq!(synced["status"]["revision"], 2);
    let (_, revs) = call(&host, "GET", "/sharing/projects/p1/revisions?after=1", None).await;
    assert_eq!(revs["items"][0]["summary"], "Renamed project to Renamed by host");
    let (status, watched) = call(&member, "GET", "/sharing/projects/p1/watch?timeout=2&activity=viewing&active_target_id=e1", None).await;
    assert_eq!(status, StatusCode::OK, "{watched}");
    assert_eq!(watched["changed"], true);
    assert_eq!(project(&member).await["name"], "Renamed by host");
    let (_, host_status) = call(&host, "GET", "/sharing/projects/p1", None).await;
    assert_eq!(host_status["host"]["connected_members"][0]["activity"], "viewing");

    // Member edits -> pushed on sync, host pulls it.
    let mut mine = project(&member).await;
    mine["items"][0]["name"] = json!("Member edit");
    call(&member, "PUT", "/projects/p1", Some(mine)).await;
    let (_, pushed) = call(&member, "POST", "/sharing/projects/p1/sync", None).await;
    assert_eq!(pushed["status"]["revision"], 3, "{pushed}");
    let (_, pulled) = call(&host, "POST", "/sharing/projects/p1/sync", None).await;
    assert_eq!(pulled["changed"], true);
    assert_eq!(project(&host).await["items"][0]["name"], "Member edit");

    // Conflict: both rename the project; member push must surface a conflict, then "team" resolves it.
    let mut h = project(&host).await;
    h["name"] = json!("Host name");
    call(&host, "PUT", "/projects/p1", Some(h)).await;
    call(&host, "POST", "/sharing/projects/p1/sync", None).await;
    let mut m = project(&member).await;
    m["name"] = json!("Member name");
    call(&member, "PUT", "/projects/p1", Some(m)).await;
    let (_, conflicted) = call(&member, "POST", "/sharing/projects/p1/sync", None).await;
    assert_eq!(conflicted["status"]["member"]["connection_state"], "conflict", "{conflicted}");
    assert_eq!(conflicted["status"]["member"]["conflict"]["fields"][0]["label"], "name");
    let (status, body) = call(&member, "POST", "/sharing/projects/p1/conflict/merge", Some(json!({"choices": {}}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let (status, resolved) = call(&member, "POST", "/sharing/projects/p1/conflict/merge", Some(json!({"choices": {"name": "mine"}}))).await;
    assert_eq!(status, StatusCode::OK, "{resolved}");
    assert_eq!(resolved["status"]["member"]["connection_state"], "connected");
    call(&host, "POST", "/sharing/projects/p1/sync", None).await;
    assert_eq!(project(&host).await["name"], "Member name");

    // Members: demote to viewer, then revoke.
    let device_id = host_status["host"]["connected_members"][0]["device_id"].as_str().unwrap().to_string();
    let (status, _) = call(&host, "PATCH", &format!("/sharing/projects/p1/members/{device_id}"), Some(json!({"role": "viewer"}))).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = call(&host, "PATCH", &format!("/sharing/projects/p1/members/{device_id}"), Some(json!({"role": "owner"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let (status, removed) = call(&host, "DELETE", &format!("/sharing/projects/p1/members/{device_id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(removed["removed"], true);
    let (_, host_status) = call(&host, "GET", "/sharing/projects/p1", None).await;
    assert_eq!(host_status["trusted_devices"].as_array().unwrap().len(), 0);
    // Revoked session can no longer reconnect: the member is marked access_expired.
    let (_, after_revoke) = call(&member, "GET", "/sharing/projects/p1/watch?timeout=0.2", None).await;
    assert_eq!(after_revoke["status"]["member"]["connection_state"], "access_expired", "{after_revoke}");

    // Member leaves via private copy, then leaves the shared project.
    let (status, copy) = call(&member, "POST", "/sharing/projects/p1/duplicate-private", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(copy["project_name"].as_str().unwrap().ends_with("(Private copy)"));
    let (status, left) = call(&member, "POST", "/sharing/projects/p1/leave", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(left["left"], true);
    assert_eq!(left["current_project_id"], "own-project");
    assert!(!copy["project_id"].as_str().unwrap().is_empty());
    let (status, body) = call(&member, "POST", "/sharing/projects/p1/leave", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    // Disable stops hosting.
    let (_, disabled) = call(&host, "POST", "/sharing/projects/p1/disable", None).await;
    assert_eq!(disabled["sharing_enabled"], false);
    assert_eq!(disabled["host"]["hosting"], false);
    let (status, body) = call(&host, "POST", "/sharing/projects/p1/pairing-code", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}
