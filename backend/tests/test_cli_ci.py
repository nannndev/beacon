from pathlib import Path

import pytest

from app.cli import main
from app.cli_ci import (
    create_github_workflow_plan,
    discover_github_secrets,
    find_repository_root,
    write_github_workflow,
)
from app.cli_runner import CliProjectError, load_project, select_environment
from app.services.project_file_sync import ProjectFileSyncService


def linked_project(repo: Path) -> Path:
    (repo / ".git").mkdir(parents=True)
    root = repo / "api-tests"
    project = {
        "id": "project-ci",
        "name": "Retail API",
        "current_environment_id": "env-ci",
        "environments": [{
            "id": "env-ci",
            "name": "CI",
            "base_url": "https://api.example.test",
            "variables": {
                "api-token": "do-not-leak",
                "tenant": "public-demo",
            },
        }],
        "items": [{
            "type": "request",
            "id": "health",
            "name": "Health",
            "url": "/health",
            "method": "GET",
            "headers": {"Authorization": "Bearer {{api-token}}"},
            "payload": {},
            "payload_type": "json",
            "assertions": [{"type": "status", "op": "eq", "value": 200}],
        }],
    }
    ProjectFileSyncService().link(project, str(root))
    return root


def test_plan_detects_repo_project_path_and_secret_names(tmp_path):
    root = linked_project(tmp_path / "repo")
    project, project_root = load_project(root)
    environment = select_environment(project, "CI")

    plan = create_github_workflow_plan(
        project_root, project, environment, cli_version="0.4.8",
    )

    assert plan.repository_root == (tmp_path / "repo").resolve()
    assert plan.project_path == "api-tests"
    assert plan.secret_names == ("BEACON_VAR_API_TOKEN",)
    assert "do-not-leak" not in plan.content
    assert "${{ secrets.BEACON_VAR_API_TOKEN }}" in plan.content
    assert "download/v0.4.8/beacon-linux-x64" in plan.content
    assert '--bail --quiet --github' in plan.content
    assert 'BEACON_PROJECT: "api-tests"' in plan.content


def test_workflow_write_is_atomic_idempotent_and_guarded(tmp_path):
    root = linked_project(tmp_path / "repo")
    project, project_root = load_project(root)
    plan = create_github_workflow_plan(
        project_root, project, select_environment(project, None), cli_version="latest",
    )

    created = write_github_workflow(plan)
    unchanged = write_github_workflow(plan)
    plan.destination.write_text("custom workflow\n", encoding="utf-8")

    with pytest.raises(CliProjectError, match="--force"):
        write_github_workflow(plan)
    assert plan.destination.read_text() == "custom workflow\n"

    updated = write_github_workflow(plan, force=True)
    assert created.state == "created"
    assert unchanged.state == "unchanged"
    assert updated.state == "updated"
    assert "releases/latest/download" in plan.destination.read_text()


def test_cli_dry_run_does_not_write_and_create_reports_secrets(tmp_path, capsys):
    root = linked_project(tmp_path / "repo")

    assert main(["ci", "init", "github", str(root), "--dry-run"]) == 0
    captured = capsys.readouterr()
    assert "name: Beacon API tests" in captured.out
    assert "do-not-leak" not in captured.out
    assert "Preview only" in captured.err
    assert not (tmp_path / "repo" / ".github").exists()

    assert main(["ci", "init", "github", str(root)]) == 0
    output = capsys.readouterr().out
    assert "BEACON_VAR_API_TOKEN" in output
    assert (tmp_path / "repo" / ".github/workflows/beacon.yml").is_file()


def test_repo_and_secret_collision_errors_are_explicit(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)

    with pytest.raises(CliProjectError, match="inside"):
        find_repository_root(outside, repo)
    with pytest.raises(CliProjectError, match="both map"):
        discover_github_secrets({"variables": {"api-token": "a", "api_token": "b"}})


@pytest.mark.parametrize("version", ["", "main", "0.4", "0.4.8\nmalicious"])
def test_cli_version_is_restricted_to_release_tags(tmp_path, version):
    root = linked_project(tmp_path / version.replace("/", "_").replace("\n", "_") / "repo")
    project, project_root = load_project(root)
    with pytest.raises(CliProjectError, match="semantic version"):
        create_github_workflow_plan(
            project_root, project, select_environment(project, None), cli_version=version,
        )
