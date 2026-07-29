from pathlib import Path

import pytest

from app.cli import main
from app.cli_github import github_annotations, github_summary_markdown, write_github_summary
from app.cli_runner import CliRunResult, ExecutionResult
from app.services.project_file_sync import ProjectFileSyncService


def failed_result() -> CliRunResult:
    return CliRunResult(
        project_id="project-1",
        project_name="Retail | API",
        environment_id="env-ci",
        environment_name="CI",
        scope="project",
        started_at="2026-07-29T00:00:00Z",
        duration_ms=123,
        passed=False,
        stopped_early=False,
        executions=[ExecutionResult(
            endpoint_id="login",
            endpoint_name="Login: admin, primary",
            method="POST",
            target="/login?token={{api_token}}",
            iteration=1,
            passed=False,
            status=401,
            time_ms=123,
            error="received super-secret-token",
            assertions=[{
                "type": "jsonpath",
                "ok": False,
                "expected": "super-secret-token",
                "actual": "another-secret",
                "message": "received another-secret",
            }],
        )],
    )


def linked_project(root: Path) -> Path:
    project = {
        "id": "project-1",
        "name": "CI project",
        "current_environment_id": "env-ci",
        "environments": [{
            "id": "env-ci", "name": "CI", "base_url": "https://api.example.test",
            "variables": {},
        }],
        "items": [{
            "type": "request", "id": "health", "name": "Health", "url": "/health",
            "method": "GET", "payload": {}, "payload_type": "json",
            "assertions": [{"type": "status", "op": "eq", "value": 200}],
        }],
    }
    ProjectFileSyncService().link(project, str(root))
    return root


def test_github_output_is_useful_escaped_and_secret_safe():
    result = failed_result()

    summary = github_summary_markdown(result)
    annotations = github_annotations(result)

    assert "Retail \\| API" in summary
    assert "HTTP 401" in summary
    assert "1 assertion(s) failed (jsonpath)" in summary
    assert "super-secret-token" not in summary
    assert "another-secret" not in summary
    assert annotations == [
        "::error title=Beacon%3A Login%3A admin%2C primary::"
        "POST Login: admin, primary, iteration 1: HTTP 401; 1 assertion(s) failed (jsonpath)"
    ]
    assert "super-secret-token" not in annotations[0]


def test_summary_appends_to_github_step_summary(tmp_path):
    target = tmp_path / "summary.md"
    target.write_text("Existing step\n", encoding="utf-8")

    write_github_summary(failed_result(), target)

    content = target.read_text(encoding="utf-8")
    assert content.startswith("Existing step\n# ❌ Beacon API tests: Failed")


def test_github_flag_writes_summary_and_annotations(tmp_path, monkeypatch, capsys):
    root = linked_project(tmp_path / "project")
    summary_path = tmp_path / "step-summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary_path))
    monkeypatch.setattr(
        "app.cli_runner.APITester.send_once",
        lambda self, **kwargs: {
            "ok": True,
            "status": 200,
            "time_ms": 9,
            "assertions": [{
                "type": "status", "ok": False, "expected": "secret-expected",
                "actual": "secret-actual", "message": "secret-expected vs secret-actual",
            }],
        },
    )

    code = main(["run", str(root), "--github", "--no-color"])
    output = capsys.readouterr().out

    assert code == 1
    assert "::error title=Beacon%3A Health::GET Health, iteration 1:" in output
    assert "secret-expected" not in output
    assert "secret-actual" not in output
    assert "1 assertion(s) failed (status)" in summary_path.read_text(encoding="utf-8")


def test_github_flag_fails_before_network_when_summary_path_is_missing(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    monkeypatch.setattr(
        "app.cli_runner.APITester.send_once",
        lambda *args, **kwargs: pytest.fail("request must not be sent"),
    )

    code = main(["run", str(tmp_path / "missing"), "--github"])

    assert code == 2
    assert "GITHUB_STEP_SUMMARY is not set" in capsys.readouterr().err
