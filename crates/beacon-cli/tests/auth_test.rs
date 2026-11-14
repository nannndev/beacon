mod common;

use common::*;
use serde_json::json;

/// A folder-level `bearer` auth spec must apply to requests nested under it
/// that leave their own `auth` unset/`inherit` -- mirrors `auth_chains` +
/// `effective_auth`/`resolve_auth_headers` in `core/auth.py`.
#[test]
fn folder_auth_is_inherited_by_nested_endpoints() {
    let (base_url, captured) = spawn_mock_server_capturing(vec![("GET /secure", MockResponse::json(200, json!({"ok": true})))]);

    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", &base_url, &[("token", Some("s3cr3t"))])
        .folder_with(
            "folder-1",
            "Secure",
            &[("ep-1", "Secure Ping", "/secure", "GET", "")],
            "type: bearer\ntoken: \"{{token}}\"\n",
        )
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["run", dir.path().to_str().unwrap(), "--quiet"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));

    let requests = captured.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].get("authorization").map(|s| s.as_str()), Some("Bearer s3cr3t"));
}

/// `--endpoint` runs just the named endpoint even when it lives inside a
/// folder with its own auth, applying that folder's inherited auth.
#[test]
fn endpoint_selector_runs_single_endpoint_with_inherited_auth() {
    let (base_url, captured) = spawn_mock_server_capturing(vec![
        ("GET /secure", MockResponse::json(200, json!({"ok": true}))),
        ("GET /open", MockResponse::json(200, json!({"ok": true}))),
    ]);

    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", &base_url, &[("token", Some("abc123"))])
        .endpoint("ep-open", "Open", "/open", "GET", "")
        .folder_with(
            "folder-1",
            "Secure",
            &[("ep-secure", "Secure Ping", "/secure", "GET", "")],
            "type: bearer\ntoken: \"{{token}}\"\n",
        )
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["run", dir.path().to_str().unwrap(), "--endpoint", "Secure Ping", "--quiet"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));

    let requests = captured.lock().unwrap();
    assert_eq!(requests.len(), 1, "only the selected endpoint should run");
    assert_eq!(requests[0].get("authorization").map(|s| s.as_str()), Some("Bearer abc123"));
}

/// `--folder` runs every endpoint nested below the named folder.
#[test]
fn folder_selector_runs_every_nested_endpoint() {
    let (base_url, captured) = spawn_mock_server_capturing(vec![
        ("GET /a", MockResponse::json(200, json!({"ok": true}))),
        ("GET /b", MockResponse::json(200, json!({"ok": true}))),
        ("GET /open", MockResponse::json(200, json!({"ok": true}))),
    ]);

    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", &base_url, &[])
        .endpoint("ep-open", "Open", "/open", "GET", "")
        .folder_with(
            "folder-1",
            "Group",
            &[
                ("ep-a", "A", "/a", "GET", ""),
                ("ep-b", "B", "/b", "GET", ""),
            ],
            "",
        )
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["run", dir.path().to_str().unwrap(), "--folder", "Group", "--quiet"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(captured.lock().unwrap().len(), 2, "only the folder's two endpoints should run");
}
