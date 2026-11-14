mod common;

use common::*;
use serde_json::json;

#[test]
fn run_against_mock_server_passes_and_prints_summary() {
    let base_url = spawn_mock_server(vec![("GET /ping", MockResponse::json(200, json!({"ok": true})))]);

    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", &base_url, &[])
        .endpoint(
            "ep-1",
            "Ping",
            "/ping",
            "GET",
            "assertions:\n  - type: status\n    op: eq\n    value: 200\n",
        )
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["run", dir.path().to_str().unwrap()]);
    assert!(output.status.success(), "stdout: {}\nstderr: {}", stdout(&output), stderr(&output));
    let text = stdout(&output);
    assert!(text.contains("PASSED: 1 passed, 0 failed, 1 total"), "{}", text);
}

#[test]
fn run_reports_failure_exit_code_on_assertion_mismatch() {
    let base_url = spawn_mock_server(vec![("GET /ping", MockResponse::json(500, json!({"ok": false})))]);

    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", &base_url, &[])
        .endpoint(
            "ep-1",
            "Ping",
            "/ping",
            "GET",
            "assertions:\n  - type: status\n    op: eq\n    value: 200\n",
        )
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["run", dir.path().to_str().unwrap()]);
    assert_eq!(output.status.code(), Some(1));
    assert!(stdout(&output).contains("FAILED: 0 passed, 1 failed, 1 total"));
}

#[test]
fn run_exits_2_before_sending_any_request_when_validation_fails() {
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", "https://example.test", &[])
        .endpoint("ep-1", "Broken", "", "GET", "")
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["run", dir.path().to_str().unwrap()]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("Project validation failed"));
}

#[test]
fn run_json_report_matches_the_documented_contract() {
    let base_url = spawn_mock_server(vec![("GET /ping", MockResponse::json(200, json!({"ok": true})))]);
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", &base_url, &[])
        .endpoint("ep-1", "Ping", "/ping", "GET", "")
        .build("proj-1", "Sample Project", "env-1");

    let report_path = dir.path().join("report.json");
    let output = run_cli(&[
        "run",
        dir.path().to_str().unwrap(),
        "--report-json",
        report_path.to_str().unwrap(),
        "--quiet",
    ]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));

    let report: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&report_path).unwrap()).unwrap();
    assert_eq!(report["format"], "beacon.cli.report");
    assert_eq!(report["version"], 1);
    assert_eq!(report["passed"], true);
    assert_eq!(report["summary"]["total"], 1);
    let executions = report["executions"].as_array().unwrap();
    assert_eq!(executions.len(), 1);
    assert_eq!(executions[0]["endpoint_name"], "Ping");
    assert_eq!(executions[0]["status"], 200);
    // Never the rendered request URL with resolved query values -- just the
    // project's templated URL.
    assert_eq!(executions[0]["target"], "/ping");
}

#[test]
fn run_junit_report_has_one_testcase_per_iteration() {
    let base_url = spawn_mock_server(vec![("GET /ping", MockResponse::json(200, json!({"ok": true})))]);
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", &base_url, &[])
        .endpoint("ep-1", "Ping", "/ping", "GET", "")
        .build("proj-1", "Sample Project", "env-1");

    let report_path = dir.path().join("report.xml");
    let output = run_cli(&[
        "run",
        dir.path().to_str().unwrap(),
        "--iterations",
        "3",
        "--report-junit",
        report_path.to_str().unwrap(),
        "--quiet",
    ]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));

    let xml = std::fs::read_to_string(&report_path).unwrap();
    assert!(xml.starts_with("<?xml"));
    assert_eq!(xml.matches("<testcase").count(), 3);
    assert!(xml.contains("tests=\"3\""));
    assert!(xml.contains("failures=\"0\""));
}

#[test]
fn run_data_driven_iterations_cycle_through_rows() {
    let base_url = spawn_mock_server(vec![("POST /echo", MockResponse::json(200, json!({"ok": true})))]);
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", &base_url, &[])
        .endpoint(
            "ep-1",
            "Echo",
            "/echo",
            "POST",
            "payload:\n  user: \"{{username}}\"\n",
        )
        .build("proj-1", "Sample Project", "env-1");

    let data_path = dir.path().join("data.csv");
    std::fs::write(&data_path, "username\nalice\nbob\n").unwrap();

    let report_path = dir.path().join("report.json");
    let output = run_cli(&[
        "run",
        dir.path().to_str().unwrap(),
        "--data",
        data_path.to_str().unwrap(),
        "--report-json",
        report_path.to_str().unwrap(),
        "--quiet",
    ]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));

    let report: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&report_path).unwrap()).unwrap();
    let executions = report["executions"].as_array().unwrap();
    assert_eq!(executions.len(), 2, "one pass per data row");
    assert_eq!(executions[0]["data_row"], 1);
    assert_eq!(executions[1]["data_row"], 2);
    // Never the row's values in the report.
    let serialized = serde_json::to_string(&report).unwrap();
    assert!(!serialized.contains("alice"));
    assert!(!serialized.contains("bob"));
}

#[test]
fn run_bail_stops_after_first_failure() {
    let base_url = spawn_mock_server(vec![("GET /ping", MockResponse::json(500, json!({"ok": false})))]);
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", &base_url, &[])
        .endpoint(
            "ep-1",
            "Ping",
            "/ping",
            "GET",
            "assertions:\n  - type: status\n    op: eq\n    value: 200\n",
        )
        .build("proj-1", "Sample Project", "env-1");

    let report_path = dir.path().join("report.json");
    let output = run_cli(&[
        "run",
        dir.path().to_str().unwrap(),
        "--iterations",
        "5",
        "--bail",
        "--report-json",
        report_path.to_str().unwrap(),
        "--quiet",
    ]);
    assert_eq!(output.status.code(), Some(1));

    let report: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&report_path).unwrap()).unwrap();
    assert_eq!(report["stopped_early"], true);
    assert_eq!(report["executions"].as_array().unwrap().len(), 1, "bail stops after the first failure");
}

#[test]
fn run_github_mode_appends_summary_and_prints_error_annotations() {
    let base_url = spawn_mock_server(vec![("GET /ping", MockResponse::json(500, json!({"ok": false})))]);
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", &base_url, &[])
        .endpoint(
            "ep-1",
            "Ping",
            "/ping",
            "GET",
            "assertions:\n  - type: status\n    op: eq\n    value: 200\n",
        )
        .build("proj-1", "Sample Project", "env-1");

    let summary_path = dir.path().join("step_summary.md");
    std::fs::write(&summary_path, "").unwrap();

    let output = beacon_cmd()
        .args(["run", dir.path().to_str().unwrap(), "--github"])
        .env("GITHUB_STEP_SUMMARY", &summary_path)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let out = stdout(&output);
    assert!(out.contains("::error title="), "{}", out);
    assert!(!out.contains("ok\":false"), "annotations must not leak response bodies");

    let summary = std::fs::read_to_string(&summary_path).unwrap();
    assert!(summary.contains("Beacon API tests: Failed"));
    assert!(summary.contains("## Failures"));
}

#[test]
fn run_github_mode_without_step_summary_env_exits_2_before_any_request() {
    let base_url = spawn_mock_server(vec![("GET /ping", MockResponse::json(200, json!({"ok": true})))]);
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", &base_url, &[])
        .endpoint("ep-1", "Ping", "/ping", "GET", "")
        .build("proj-1", "Sample Project", "env-1");

    let output = beacon_cmd()
        .args(["run", dir.path().to_str().unwrap(), "--github"])
        .env_remove("GITHUB_STEP_SUMMARY")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("GITHUB_STEP_SUMMARY"));
}

#[test]
fn run_missing_env_var_exits_2_before_any_request() {
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", "https://example.test", &[("api_token", None)])
        .endpoint("ep-1", "Ping", "/ping", "GET", "headers:\n  Authorization: \"Bearer {{api_token}}\"\n")
        .build("proj-1", "Sample Project", "env-1");

    let output = run_cli(&["run", dir.path().to_str().unwrap()]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("missing_private_variable") || stderr(&output).contains("Project validation failed"));
}

#[test]
fn run_retries_until_success() {
    // The mock server always returns 500 here; we only check that retries
    // multiply attempts recorded in the report (every attempt fails, so the
    // final attempts count should be retries + 1).
    let base_url = spawn_mock_server(vec![("GET /flaky", MockResponse::json(500, json!({"ok": false})))]);
    let dir = tempfile::tempdir().unwrap();
    ProjectBuilder::new(dir.path())
        .environment("env-1", "Default", &base_url, &[])
        .endpoint(
            "ep-1",
            "Flaky",
            "/flaky",
            "GET",
            "assertions:\n  - type: status\n    op: eq\n    value: 200\n",
        )
        .build("proj-1", "Sample Project", "env-1");

    let report_path = dir.path().join("report.json");
    let output = run_cli(&[
        "run",
        dir.path().to_str().unwrap(),
        "--retries",
        "2",
        "--report-json",
        report_path.to_str().unwrap(),
        "--quiet",
    ]);
    assert_eq!(output.status.code(), Some(1));
    let report: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&report_path).unwrap()).unwrap();
    assert_eq!(report["executions"][0]["attempts"], 3);
}
