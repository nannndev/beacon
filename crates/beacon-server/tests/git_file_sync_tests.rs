//! Git + file-sync endpoints against temp folders and a local bare remote.
//! One test function: BEACON_DATA_DIR and the git identity are process-global.
use axum::body::Body;
use axum::Router;
use beacon_server::{app_router, state::AppState};
use http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use tower::ServiceExt;

async fn call(app: &Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let req = Request::builder().uri(uri).method(method).header("Content-Type", "application/json")
        .body(match body { Some(b) => Body::from(b.to_string()), None => Body::empty() }).unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn ok(app: &Router, method: &str, uri: &str, body: Option<Value>) -> Value {
    let (status, json) = call(app, method, uri, body).await;
    assert_eq!(status, StatusCode::OK, "{method} {uri}: {json}");
    json
}

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git").args(args).current_dir(dir).output().expect("git available");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

fn manifest(dir: &Path, id: &str) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join("beacon.yaml"), format!(
        "format: beacon.project\nversion: 1\nproject:\n  id: {id}\n  name: External {id}\n  environments: []\n  items: []\n"
    )).unwrap();
}

fn s(dir: &Path) -> String {
    dir.to_string_lossy().to_string()
}

#[tokio::test]
async fn git_and_file_sync_round_trip() {
    if Command::new("git").arg("--version").output().is_err() {
        eprintln!("git not installed; skipping");
        return;
    }
    let tmp = std::env::temp_dir().join(format!("beacon-git-test-{}", uuid::Uuid::new_v4().simple()));
    let tmp = { std::fs::create_dir_all(&tmp).unwrap(); tmp.canonicalize().unwrap() };
    std::env::set_var("BEACON_DATA_DIR", tmp.join("data"));
    for (k, v) in [("GIT_AUTHOR_NAME", "Beacon Test"), ("GIT_AUTHOR_EMAIL", "test@example.invalid"), ("GIT_COMMITTER_NAME", "Beacon Test"), ("GIT_COMMITTER_EMAIL", "test@example.invalid")] {
        std::env::set_var(k, v);
    }
    let app = app_router(AppState::new());

    let created = ok(&app, "POST", "/projects", Some(json!({ "name": "Linked", "base_url": "https://example.invalid" }))).await;
    let id = created["id"].as_str().unwrap().to_string();
    let base = format!("/projects/{id}");
    let work = tmp.join("work");
    std::fs::create_dir_all(&work).unwrap();

    // link + status
    let (status, body) = call(&app, "POST", &format!("{base}/file-sync/link"), Some(json!({ "path": "relative/path" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let linked = ok(&app, "POST", &format!("{base}/file-sync/link"), Some(json!({ "path": s(&work) }))).await;
    assert_eq!(linked["linked"], true);
    assert_eq!(linked["state"], "clean");
    assert!(work.join("beacon.yaml").is_file());
    assert!(work.join(".beacon/environments.local.yaml").is_file());
    assert!(std::fs::read_to_string(work.join(".gitignore")).unwrap().contains(".beacon/"));
    assert_eq!(ok(&app, "GET", &format!("{base}/file-sync"), None).await["state"], "clean");
    let projects = ok(&app, "GET", "/projects", None).await;
    let me = projects["projects"].as_array().unwrap().iter().find(|p| p["id"] == id.as_str()).unwrap();
    assert_eq!(me["file_sync"]["path"], s(&work));

    // git: not a repo -> init -> working diff -> commit -> last_commit diff
    let st = ok(&app, "GET", &format!("{base}/git"), None).await;
    assert_eq!(st["available"], true);
    assert_eq!(st["repository"], false);
    let st = ok(&app, "POST", &format!("{base}/git/init"), None).await;
    assert_eq!(st["repository"], true);
    assert_eq!(st["branch"], "main");
    assert!(st["changes"].as_array().unwrap().iter().any(|c| c["path"] == "beacon.yaml" && c["status"] == "??"));
    let diff = ok(&app, "GET", &format!("{base}/git/diff?scope=working"), None).await;
    let manifest_diff = diff["files"].as_array().unwrap().iter().find(|f| f["path"] == "beacon.yaml").unwrap();
    assert!(manifest_diff["patch"].as_str().unwrap().contains("+format: beacon.project"));
    assert!(manifest_diff["additions"].as_u64().unwrap() > 0);
    let (status, body) = call(&app, "POST", &format!("{base}/git/commit"), Some(json!({ "message": "" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let st = ok(&app, "POST", &format!("{base}/git/commit"), Some(json!({ "message": "Initial project" }))).await;
    assert_eq!(st["changes"], json!([]));
    assert_eq!(st["message"], "Working tree is clean");
    let diff = ok(&app, "GET", &format!("{base}/git/diff?scope=last_commit"), None).await;
    assert_eq!(diff["commit"]["subject"], "Initial project");
    assert!(!diff["files"].as_array().unwrap().is_empty());

    // remote + push to a local bare repo
    let remote = tmp.join("remote.git");
    std::fs::create_dir_all(&remote).unwrap();
    git(&remote, &["init", "--bare", "-b", "main"]);
    let (status, _) = call(&app, "POST", &format!("{base}/git/push"), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "push without remote must fail");
    let st = ok(&app, "PUT", &format!("{base}/git/remote"), Some(json!({ "url": s(&remote) }))).await;
    assert_eq!(st["remote_url"], s(&remote));
    let st = ok(&app, "POST", &format!("{base}/git/push"), None).await;
    assert_eq!(st["upstream"], "origin/main");
    assert_eq!(st["ahead"], 0);

    // branches: create, change project (writes folder), commit, compare, switch back (reloads)
    let br = ok(&app, "POST", &format!("{base}/git/branches"), Some(json!({ "name": "feature" }))).await;
    assert_eq!(br["current"], "feature");
    assert_eq!(br["local"].as_array().unwrap().len(), 2);
    ok(&app, "PUT", &base, Some(json!({ "name": "Renamed" }))).await;
    let st = ok(&app, "GET", &format!("{base}/git"), None).await;
    assert!(st["changes"].as_array().unwrap().iter().any(|c| c["path"] == "beacon.yaml"), "{st}");
    ok(&app, "POST", &format!("{base}/git/commit"), Some(json!({ "message": "Rename" }))).await;
    let cmp = ok(&app, "POST", &format!("{base}/git/compare"), Some(json!({ "branch": "main" }))).await;
    assert_eq!(cmp["current_only_commits"], 1);
    assert_eq!(cmp["target_only_commits"], 0);
    assert_eq!(cmp["summary"]["modified"], 1);
    assert_eq!(cmp["files"][0]["path"], "beacon.yaml");
    let (status, body) = call(&app, "POST", &format!("{base}/git/switch"), Some(json!({ "branch": "nope" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let br = ok(&app, "POST", &format!("{base}/git/switch"), Some(json!({ "branch": "main" }))).await;
    assert_eq!(br["current"], "main");
    let projects = ok(&app, "GET", "/projects", None).await;
    let me = projects["projects"].as_array().unwrap().iter().find(|p| p["id"] == id.as_str()).unwrap();
    assert_eq!(me["name"], "Linked", "switching branches reloads the project from disk");
    let br = ok(&app, "GET", &format!("{base}/git/branches"), None).await;
    assert!(br["remote"].as_array().unwrap().iter().any(|b| b["full_name"] == "origin/main" && b["local_name"] == "main"));

    // fetch + pull (fast-forward no-op) + reload + unlink
    ok(&app, "POST", &format!("{base}/git/fetch"), None).await;
    let st = ok(&app, "POST", &format!("{base}/git/pull"), None).await;
    assert_eq!(st["behind"], 0);
    assert_eq!(ok(&app, "POST", &format!("{base}/file-sync/reload"), None).await["state"], "clean");
    let st = ok(&app, "DELETE", &format!("{base}/file-sync"), None).await;
    assert_eq!(st["linked"], false);
    assert_eq!(st["state"], "unlinked");
    let (status, body) = call(&app, "GET", &format!("{base}/git"), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    // open an existing project folder
    let ext = tmp.join("external");
    manifest(&ext, "ext-1");
    let opened = ok(&app, "POST", "/projects/file-sync/open", Some(json!({ "path": s(&ext) }))).await;
    assert_eq!(opened["project_id"], "ext-1");
    assert_eq!(opened["project_name"], "External ext-1");
    assert_eq!(opened["missing_private_values"], json!([]));
    let (status, _) = call(&app, "POST", "/projects/file-sync/open", Some(json!({ "path": s(&ext) }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "opening twice is refused");

    // initialize a plain repo folder as a new project
    let plain = tmp.join("plain-repo");
    std::fs::create_dir_all(&plain).unwrap();
    let init = ok(&app, "POST", "/projects/file-sync/initialize", Some(json!({ "path": s(&plain), "name": "" }))).await;
    assert_eq!(init["project_name"], "plain-repo");
    assert_eq!(init["path"], s(&plain));
    assert!(plain.join("beacon.yaml").is_file());
    let (status, _) = call(&app, "POST", "/projects/file-sync/initialize", Some(json!({ "path": s(&plain) }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "cannot initialize twice");

    // clone a bare remote that holds a Beacon project
    let src = tmp.join("clone-src");
    manifest(&src, "ext-2");
    git(&src, &["init", "-b", "main"]);
    git(&src, &["add", "."]);
    git(&src, &["commit", "-m", "seed"]);
    let remote2 = tmp.join("remote2.git");
    std::fs::create_dir_all(&remote2).unwrap();
    git(&remote2, &["init", "--bare", "-b", "main"]);
    git(&src, &["push", &s(&remote2), "main"]);
    let clones = tmp.join("clones");
    std::fs::create_dir_all(&clones).unwrap();
    let cloned = ok(&app, "POST", "/projects/file-sync/clone", Some(json!({ "url": s(&remote2), "destination": s(&clones) }))).await;
    assert_eq!(cloned["mode"], "opened");
    assert_eq!(cloned["project_id"], "ext-2");
    assert_eq!(cloned["cloned_path"], s(&clones.join("remote2")));
    assert_eq!(ok(&app, "GET", "/projects/ext-2/git", None).await["branch"], "main");
    let (status, body) = call(&app, "POST", "/projects/file-sync/clone", Some(json!({ "url": s(&remote2), "destination": "not/absolute" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    // every endpoint in the area answers something other than 404
    let (status, _) = call(&app, "POST", "/projects/file-sync/import-candidate", Some(json!({ "path": s(&plain), "candidate": "x.json" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(&app, "GET", "/projects/missing/git", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let _ = std::fs::remove_dir_all(&tmp);
    let _: PathBuf = tmp;
}
