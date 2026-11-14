mod common;

use common::*;

#[test]
fn validate_passes_for_a_well_formed_project() {
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", "https://example.test", &[])
        .endpoint(
            "ep-1",
            "Ping",
            "/get",
            "GET",
            "assertions:\n  - type: status\n    op: eq\n    value: 200\n",
        )
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["validate", dir.path().to_str().unwrap()]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert!(stdout(&output).contains("VALID: 0 errors"));
}

#[test]
fn validate_json_reports_structured_diagnostics() {
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", "https://example.test", &[])
        .endpoint("ep-1", "Ping", "/get", "GET", "")
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["validate", dir.path().to_str().unwrap(), "--json"]);
    assert!(output.status.success());
    let json: serde_json::Value = serde_json::from_str(&stdout(&output)).unwrap();
    assert_eq!(json["valid"], true);
    assert_eq!(json["summary"]["errors"], 0);
}

#[test]
fn validate_fails_on_invalid_method_and_missing_url() {
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", "https://example.test", &[])
        .endpoint("ep-1", "Broken", "", "FROBNICATE", "")
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["validate", dir.path().to_str().unwrap(), "--json"]);
    assert_eq!(output.status.code(), Some(2));
    let json: serde_json::Value = serde_json::from_str(&stdout(&output)).unwrap();
    assert_eq!(json["valid"], false);
    let codes: Vec<String> = json["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["code"].as_str().unwrap().to_string())
        .collect();
    assert!(codes.contains(&"missing_url".to_string()), "{:?}", codes);
    assert!(codes.contains(&"invalid_method".to_string()), "{:?}", codes);
}

#[test]
fn validate_flags_missing_private_variable_and_unknown_template() {
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", "https://example.test", &[("api_token", None)])
        .endpoint(
            "ep-1",
            "Ping",
            "/get",
            "GET",
            "headers:\n  Authorization: \"Bearer {{api_token}}\"\n  X-Bad: \"{{not_a_real_thing}}\"\n",
        )
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["validate", dir.path().to_str().unwrap(), "--json"]);
    assert_eq!(output.status.code(), Some(2));
    let json: serde_json::Value = serde_json::from_str(&stdout(&output)).unwrap();
    let codes: Vec<String> = json["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["code"].as_str().unwrap().to_string())
        .collect();
    assert!(codes.contains(&"missing_private_variable".to_string()), "{:?}", codes);
    assert!(codes.contains(&"unknown_variable".to_string()), "{:?}", codes);
}

#[test]
fn validate_strict_fails_on_ambiguous_name_warning() {
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", "https://example.test", &[])
        .endpoint("ep-1", "Dup", "/get", "GET", "")
        .endpoint("ep-2", "Dup", "/get2", "GET", "")
        .build("proj-1", "Sample Project", "env-1");

    let plain = run_cli(&["validate", dir.path().to_str().unwrap()]);
    assert!(plain.status.success(), "non-strict should pass despite the warning");

    let strict = run_cli(&["validate", dir.path().to_str().unwrap(), "--strict", "--json"]);
    assert_eq!(strict.status.code(), Some(2));
    let json: serde_json::Value = serde_json::from_str(&stdout(&strict)).unwrap();
    assert_eq!(json["summary"]["warnings"], 1);
}

#[test]
fn validate_env_var_overrides_missing_private_value() {
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", "https://example.test", &[("api_token", None)])
        .endpoint("ep-1", "Ping", "/get", "GET", "headers:\n  Authorization: \"Bearer {{api_token}}\"\n")
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&[
        "validate",
        dir.path().to_str().unwrap(),
        "--env-var",
        "api_token=secret-value",
    ]);
    assert!(output.status.success(), "stdout: {}", stdout(&output));
}
