mod common;

use common::*;

#[test]
fn list_endpoints_json_has_expected_columns() {
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", "https://example.test", &[])
        .endpoint("ep-1", "Ping", "/get", "GET", "")
        .folder_with("folder-1", "Auth", &[("ep-2", "Login", "/login", "POST", "")], "")
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["list", "endpoints", dir.path().to_str().unwrap(), "--json"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let json: serde_json::Value = serde_json::from_str(&stdout(&output)).unwrap();
    assert_eq!(json["resource"], "endpoints");
    let items = json["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    let login = items.iter().find(|i| i["name"] == "Login").unwrap();
    assert_eq!(login["method"], "POST");
    assert_eq!(login["folder"], "Auth");
    assert_eq!(login["id"], "ep-2");
}

#[test]
fn list_folders_reports_nested_endpoint_count() {
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", "https://example.test", &[])
        .folder_with(
            "folder-1",
            "Auth",
            &[
                ("ep-1", "Ping", "/get", "GET", ""),
                ("ep-2", "Login", "/login", "POST", ""),
            ],
            "",
        )
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["list", "folders", dir.path().to_str().unwrap(), "--json"]);
    assert!(output.status.success());
    let json: serde_json::Value = serde_json::from_str(&stdout(&output)).unwrap();
    let items = json["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["endpoints"], 2);
    assert_eq!(items[0]["path"], "Auth");
}

#[test]
fn list_environments_marks_active() {
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", "https://example.test", &[])
        .environment("env-2", "Staging", "https://staging.test", &[])
        .endpoint("ep-1", "Ping", "/get", "GET", "")
        .build("proj-1", "Sample Project", "env-2");

    let output = run_cli(&["list", "environments", dir.path().to_str().unwrap(), "--json"]);
    assert!(output.status.success());
    let json: serde_json::Value = serde_json::from_str(&stdout(&output)).unwrap();
    let items = json["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    let staging = items.iter().find(|i| i["name"] == "Staging").unwrap();
    assert_eq!(staging["active"], true);
    let default = items.iter().find(|i| i["name"] == "Default").unwrap();
    assert_eq!(default["active"], false);
}

#[test]
fn list_text_mode_prints_table_without_json() {
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", "https://example.test", &[])
        .endpoint("ep-1", "Ping", "/get", "GET", "")
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["list", "endpoints", dir.path().to_str().unwrap()]);
    assert!(output.status.success());
    let text = stdout(&output);
    assert!(text.contains("METHOD"));
    assert!(text.contains("Ping"));
}
