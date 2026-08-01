import json
from pathlib import Path

import pytest

from app.cli import main
from app.cli_runner import (
    CliProjectError,
    load_project,
    list_project_resources,
    parse_env_file,
    resolve_variables,
    run_project,
    shell_variable_name,
    select_endpoints,
    select_environment,
    validate_project,
    write_junit_report,
)
from app.services.project_file_sync import ProjectFileSyncService


def project_source(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    project = {
        "id": "project-1",
        "name": "CLI Sample",
        "current_environment_id": "env-1",
        "environments": [{
            "id": "env-1",
            "name": "CI",
            "base_url": "https://api.example.test",
            "variables": {"api_token": "local-secret", "tenant": "acme"},
        }],
        "items": [{
            "type": "folder",
            "id": "folder-auth",
            "name": "Auth",
            "items": [{
                "type": "request",
                "id": "endpoint-login",
                "name": "Login",
                "url": "/login",
                "method": "POST",
                "headers": {"Authorization": "Bearer {{api_token}}"},
                "payload": {"tenant": "{{tenant}}"},
                "payload_type": "json",
                "assertions": [{"type": "status", "op": "eq", "value": 200}],
                "extractors": {"access_token": "body.access_token"},
            }],
        }],
    }
    ProjectFileSyncService().link(project, str(root))
    return root


def test_loads_git_backed_project_and_selects_scopes(tmp_path):
    project, root = load_project(project_source(tmp_path))
    environment = select_environment(project, "CI")
    endpoints, scope = select_endpoints(project, folder_selector="Auth")

    assert root.name == "project"
    assert environment["base_url"] == "https://api.example.test"
    assert [endpoint["name"] for endpoint in endpoints] == ["Login"]
    assert scope == "folder:Auth"


def test_rejects_unknown_or_ambiguous_scope(tmp_path):
    project, _ = load_project(project_source(tmp_path))
    with pytest.raises(CliProjectError, match="Endpoint not found"):
        select_endpoints(project, endpoint_selectors=["Missing"])


def test_env_precedence_and_dotenv_parser(tmp_path, monkeypatch):
    env_path = tmp_path / ".env"
    env_path.write_text("tenant=from-file\nexport api_token='from file'\n", encoding="utf-8")
    monkeypatch.setenv("BEACON_VAR_API_TOKEN", "from-process")
    environment = {"variables": {"tenant": "saved", "api_token": "saved"}}

    variables = resolve_variables(
        environment,
        parse_env_file(env_path),
        {"tenant": "from-cli"},
    )

    assert variables == {"tenant": "from-cli", "api_token": "from-process"}
    assert shell_variable_name("api-token.value") == "API_TOKEN_VALUE"


def test_runner_preserves_order_and_fails_assertions(monkeypatch):
    responses = iter([
        {
            "ok": True,
            "status": 200,
            "time_ms": 12,
            "target": "https://api.example.test/one",
            "assertions": [{"ok": True, "message": "status code eq 200"}],
            "extracted": ["token"],
        },
        {
            "ok": True,
            "status": 200,
            "time_ms": 14,
            "target": "https://api.example.test/two",
            "assertions": [{"ok": False, "message": "JSON path body.id exists"}],
        },
    ])
    monkeypatch.setattr("app.cli_runner.APITester.send_once", lambda self, **kwargs: next(responses))
    endpoints = [
        {"id": "e1", "name": "One", "url": "/one", "method": "GET", "type": "request"},
        {"id": "e2", "name": "Two", "url": "/two", "method": "GET", "type": "request"},
    ]
    result = run_project(
        {"id": "p1", "name": "Project"},
        endpoints,
        {"id": "env", "name": "CI", "base_url": "https://api.example.test"},
        {},
        scope="project",
    )

    assert result.passed is False
    assert result.summary == {"total": 2, "passed": 1, "failed": 1}
    assert result.executions[0].extracted == ["token"]
    assert result.executions[0].target == "/one"
    assert result.executions[1].error == "JSON path body.id exists"


def test_cli_writes_json_and_junit_reports(tmp_path, monkeypatch, capsys):
    root = project_source(tmp_path)
    report_json = tmp_path / "reports" / "result.json"
    report_xml = tmp_path / "reports" / "result.xml"
    monkeypatch.setattr(
        "app.cli_runner.APITester.send_once",
        lambda self, **kwargs: {
            "ok": True,
            "status": 200,
            "time_ms": 9,
            "target": "https://api.example.test/login",
            "assertions": [{"ok": True, "message": "status code eq 200"}],
        },
    )

    code = main([
        "run", str(root), "--env", "CI",
        "--report-json", str(report_json),
        "--report-junit", str(report_xml),
        "--no-color",
    ])

    assert code == 0
    assert json.loads(report_json.read_text())["format"] == "beacon.cli.report"
    assert report_xml.read_text().startswith("<?xml")
    assert "PASSED: 1 passed" in capsys.readouterr().out


def test_junit_failure_contains_reason(tmp_path):
    from app.cli_runner import CliRunResult, ExecutionResult

    result = CliRunResult(
        project_id="p1", project_name="Project", environment_id=None,
        environment_name=None, scope="project", started_at="now", duration_ms=10,
        passed=False, stopped_early=False,
        executions=[ExecutionResult(
            endpoint_id="e1", endpoint_name="Broken", method="GET", target="https://example.test",
            iteration=1, passed=False, status=500, time_ms=10, error="HTTP 500",
        )],
    )
    target = tmp_path / "junit.xml"
    write_junit_report(result, target)
    assert "HTTP 500" in target.read_text()


def test_lists_project_resources_with_paths_and_stable_ids(tmp_path):
    project, _ = load_project(project_source(tmp_path))

    endpoints = list_project_resources(project, "endpoints")
    folders = list_project_resources(project, "folders")
    environments = list_project_resources(project, "environments")

    assert endpoints == [{
        "id": "endpoint-login", "name": "Login", "method": "POST",
        "target_type": "api", "folder": "Auth", "url": "/login",
    }]
    assert folders[0]["path"] == "Auth"
    assert folders[0]["endpoints"] == 1
    assert environments[0]["active"] is True


def test_validation_reports_semantic_errors_without_network(tmp_path, monkeypatch):
    project, _ = load_project(project_source(tmp_path))
    endpoints, _ = select_endpoints(project)
    environment = select_environment(project, "CI")
    endpoint = endpoints[0]
    endpoint["url"] = "{{missing_url}}/login"
    endpoint["extractors"] = {"token": "body."}
    endpoint["assertions"] = [{"type": "header", "op": "contains", "value": "json"}]
    monkeypatch.setattr(
        "app.cli_runner.APITester.send_once",
        lambda *args, **kwargs: pytest.fail("validation must not send a request"),
    )

    result = validate_project(project, endpoints, environment, resolve_variables(environment))

    assert result.valid is False
    assert {item.code for item in result.errors} >= {
        "unknown_variable", "invalid_extractor_source", "missing_header_name",
    }


def test_validate_and_list_commands_support_json_output(tmp_path, monkeypatch, capsys):
    root = project_source(tmp_path)
    monkeypatch.setattr(
        "app.cli_runner.APITester.send_once",
        lambda *args, **kwargs: pytest.fail("discovery commands must not send a request"),
    )

    assert main(["validate", str(root), "--env", "CI", "--json"]) == 0
    validation = json.loads(capsys.readouterr().out)
    assert validation["valid"] is True
    assert validation["summary"] == {"errors": 0, "warnings": 0}

    assert main(["list", "endpoints", str(root), "--json"]) == 0
    listing = json.loads(capsys.readouterr().out)
    assert listing["resource"] == "endpoints"
    assert listing["items"][0]["folder"] == "Auth"


def test_validation_rejects_missing_private_value(tmp_path):
    project, _ = load_project(project_source(tmp_path))
    endpoints, _ = select_endpoints(project)
    environment = select_environment(project, "CI")
    environment["variables"]["api_token"] = ""

    result = validate_project(project, endpoints, environment, resolve_variables(environment))

    assert any(item.code == "missing_private_variable" for item in result.errors)


def test_json_mode_keeps_load_errors_machine_readable(tmp_path, capsys):
    missing = tmp_path / "missing-project"

    assert main(["validate", str(missing), "--json"]) == 2
    payload = json.loads(capsys.readouterr().out)

    assert payload["valid"] is False
    assert payload["diagnostics"][0]["code"] == "cli_error"


def test_cli_resolves_folder_auth_for_inheriting_endpoints(tmp_path, monkeypatch):
    """A CLI run must authenticate the same way the desktop app does: selecting
    endpoints out of the tree loses folder context, so the chain is resolved
    explicitly before execution."""
    project = {
        "id": "project-auth",
        "name": "Auth Project",
        "auth": {"type": "bearer", "token": "{{project_token}}"},
        "current_environment_id": "env-1",
        "environments": [{
            "id": "env-1",
            "name": "CI",
            "base_url": "https://api.example.test",
            "variables": {"project_token": "P", "team_token": "T"},
        }],
        "items": [{
            "type": "folder",
            "id": "folder-secure",
            "name": "Secure",
            "auth": {"type": "bearer", "token": "{{team_token}}"},
            "items": [{
                "type": "request", "id": "endpoint-inherit", "name": "Inherits",
                "url": "/secure", "method": "GET", "auth": {"type": "inherit"},
            }],
        }, {
            "type": "request", "id": "endpoint-root", "name": "Root",
            "url": "/root", "method": "GET", "auth": {"type": "inherit"},
        }],
    }

    sent = []

    def capture(self, **kwargs):
        sent.append(self._build_request()[1].get("Authorization"))
        return {"ok": True, "status": 200, "time_ms": 1, "target": "t", "assertions": []}

    monkeypatch.setattr("app.cli_runner.APITester.send_once", capture)
    endpoints, _ = select_endpoints(project)
    run_project(project, endpoints, project["environments"][0],
                resolve_variables(project["environments"][0]), scope="project")

    # The folder endpoint takes the team token; the root one falls back to the
    # project token. Neither may go out unauthenticated.
    assert sent == ["Bearer T", "Bearer P"]


def test_cli_round_trips_folder_auth_through_yaml(tmp_path):
    project = {
        "id": "project-yaml",
        "name": "YAML Auth",
        "current_environment_id": "env-1",
        "environments": [{"id": "env-1", "name": "CI", "base_url": "https://api.example.test",
                          "variables": {}}],
        "items": [{
            "type": "folder", "id": "folder-1", "name": "Secure",
            "auth": {"type": "bearer", "token": "{{team_token}}"},
            "items": [{"type": "request", "id": "endpoint-1", "name": "Inside",
                       "url": "/x", "method": "GET", "auth": {"type": "inherit"}}],
        }],
    }
    ProjectFileSyncService().link(project, str(tmp_path / "project"))
    reloaded, _ = load_project(tmp_path / "project")

    folder = reloaded["items"][0]
    assert folder["auth"] == {"type": "bearer", "token": "{{team_token}}"}
    assert folder["items"][0]["auth"] == {"type": "inherit"}
