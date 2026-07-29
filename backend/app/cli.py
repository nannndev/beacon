"""Beacon command-line interface."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .cli_ci import create_github_workflow_plan, write_github_workflow
from .cli_github import github_annotations, github_summary_path, write_github_summary
from .cli_runner import (
    CliProjectError,
    ExecutionResult,
    ProjectValidationResult,
    list_project_resources,
    load_project,
    parse_env_file,
    parse_env_vars,
    resolve_variables,
    run_project,
    select_endpoints,
    select_environment,
    validate_project,
    write_json_report,
    write_junit_report,
)


VERSION = os.getenv("BEACON_APP_VERSION", "0.4.8")


class Console:
    def __init__(self, *, color: bool, quiet: bool):
        self.color = color
        self.quiet = quiet

    def _paint(self, value: str, code: str) -> str:
        return f"\033[{code}m{value}\033[0m" if self.color else value

    def info(self, message: str) -> None:
        if not self.quiet:
            print(message)

    def execution(self, item: ExecutionResult) -> None:
        if self.quiet:
            return
        state = self._paint("PASS", "32;1") if item.passed else self._paint("FAIL", "31;1")
        status = str(item.status) if item.status is not None else "ERR"
        timing = f"{item.time_ms}ms" if item.time_ms is not None else "-"
        print(f"{state}  {item.method:<7} {item.endpoint_name}  {status}  {timing}")
        if item.error:
            print(f"      {self._paint(item.error, '31')}")
        for assertion in item.assertions:
            marker = self._paint("ok", "32") if assertion.get("ok") else self._paint("failed", "31")
            print(f"      assertion {marker}: {assertion.get('message', 'Assertion')}")
        if item.extracted:
            print(f"      extracted: {', '.join(item.extracted)}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="beacon",
        description="Run Git-backed Beacon API tests without opening the desktop app.",
    )
    parser.add_argument("--version", action="version", version=f"Beacon CLI {VERSION}")
    subparsers = parser.add_subparsers(dest="command", required=True)
    run = subparsers.add_parser("run", help="Run a Beacon project, folder, or endpoint")
    run.add_argument("project", nargs="?", default=".", help="Project folder or beacon.yaml path")
    scope = run.add_mutually_exclusive_group()
    scope.add_argument("--endpoint", action="append", metavar="NAME_OR_ID", help="Run one endpoint; repeat to run several")
    scope.add_argument("--folder", metavar="NAME_OR_ID", help="Run every endpoint below one folder")
    run.add_argument("--env", metavar="NAME_OR_ID", help="Environment to use")
    run.add_argument("--env-file", metavar="PATH", help="Read KEY=VALUE overrides from a local file")
    run.add_argument("--env-var", action="append", default=[], metavar="KEY=VALUE", help="Override one variable; repeat as needed")
    run.add_argument("--iterations", type=int, default=1, metavar="N", help="Repeat the selected scope (default: 1)")
    run.add_argument("--retries", type=int, default=0, metavar="N", help="Retry failed HTTP requests (default: 0)")
    run.add_argument("--retry-delay", type=int, default=0, metavar="MS", help="Delay between retries in milliseconds")
    run.add_argument("--bail", action="store_true", help="Stop after the first failed request")
    run.add_argument("--report-json", metavar="PATH", help="Write a machine-readable JSON report")
    run.add_argument("--report-junit", metavar="PATH", help="Write a JUnit XML report")
    run.add_argument("--quiet", action="store_true", help="Print only the final summary and errors")
    run.add_argument("--no-color", action="store_true", help="Disable ANSI terminal colors")
    run.add_argument("--github", action="store_true", help="Write a GitHub Actions summary and failure annotations")

    validate = subparsers.add_parser("validate", help="Validate a Beacon project without sending requests")
    validate.add_argument("project", nargs="?", default=".", help="Project folder or beacon.yaml path")
    validate.add_argument("--env", metavar="NAME_OR_ID", help="Environment used for variable validation")
    validate.add_argument("--env-file", metavar="PATH", help="Read KEY=VALUE overrides from a local file")
    validate.add_argument("--env-var", action="append", default=[], metavar="KEY=VALUE", help="Override one variable; repeat as needed")
    validate.add_argument("--strict", action="store_true", help="Treat warnings as validation failures")
    validate.add_argument("--json", action="store_true", help="Print machine-readable JSON diagnostics")

    list_parser = subparsers.add_parser("list", help="List project endpoints, folders, or environments")
    list_parser.add_argument("resource", choices=("endpoints", "folders", "environments"))
    list_parser.add_argument("project", nargs="?", default=".", help="Project folder or beacon.yaml path")
    list_parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")

    ci = subparsers.add_parser("ci", help="Generate CI configuration for a Beacon project")
    ci_commands = ci.add_subparsers(dest="ci_command", required=True)
    ci_init = ci_commands.add_parser("init", help="Initialize a CI provider")
    ci_providers = ci_init.add_subparsers(dest="ci_provider", required=True)
    github = ci_providers.add_parser("github", help="Generate a GitHub Actions workflow")
    github.add_argument("project", nargs="?", default=".", help="Project folder or beacon.yaml path")
    github.add_argument("--env", metavar="NAME_OR_ID", help="Environment used by the generated workflow")
    github.add_argument("--repo-root", metavar="PATH", help="Git repository root when it cannot be detected")
    github.add_argument("--cli-version", default=VERSION, metavar="VERSION", help=f"Beacon CLI release to install (default: {VERSION})")
    github.add_argument("--dry-run", action="store_true", help="Print the workflow without writing it")
    github.add_argument("--force", action="store_true", help="Replace a different existing Beacon workflow")
    return parser


def _load_variables(args: argparse.Namespace, environment: dict | None) -> dict:
    file_values = parse_env_file(args.env_file) if getattr(args, "env_file", None) else {}
    cli_values = parse_env_vars(getattr(args, "env_var", []))
    return resolve_variables(environment, file_values, cli_values)


def _validation_message(result: ProjectValidationResult) -> str:
    lines = [
        f"[{item.code}] {item.location}: {item.message}"
        for item in result.errors
    ]
    return "Project validation failed:\n  " + "\n  ".join(lines)


def _run(args: argparse.Namespace) -> int:
    github_path = github_summary_path() if args.github else None
    color = bool(sys.stdout.isatty() and not args.no_color and "NO_COLOR" not in os.environ)
    # GitHub annotations deliberately replace verbose per-request output so raw
    # assertion/transport messages cannot leak response secrets into CI logs.
    console = Console(color=color, quiet=bool(args.quiet or args.github))
    project, root = load_project(args.project)
    endpoints, scope = select_endpoints(project, args.endpoint, args.folder)
    environment = select_environment(project, args.env)
    variables = _load_variables(args, environment)
    validation = validate_project(project, endpoints, environment, variables)
    if not validation.valid:
        raise CliProjectError(_validation_message(validation))

    env_label = environment.get("name") if environment else "none"
    console.info(f"Beacon CLI {VERSION}")
    console.info(f"Project: {project.get('name')} ({root})")
    console.info(f"Scope: {scope} | Environment: {env_label} | Iterations: {args.iterations}")
    console.info("")
    result = run_project(
        project,
        endpoints,
        environment,
        variables,
        scope=scope,
        iterations=args.iterations,
        retries=args.retries,
        retry_delay_ms=args.retry_delay,
        bail=args.bail,
        on_execution=console.execution,
    )
    if args.report_json:
        write_json_report(result, args.report_json)
    if args.report_junit:
        write_junit_report(result, args.report_junit)
    if github_path is not None:
        write_github_summary(result, github_path)
        for annotation in github_annotations(result):
            print(annotation)

    summary = result.summary
    print("")
    print(
        f"{'PASSED' if result.passed else 'FAILED'}: "
        f"{summary['passed']} passed, {summary['failed']} failed, "
        f"{summary['total']} total in {result.duration_ms}ms"
    )
    if args.report_json:
        print(f"JSON report: {Path(args.report_json).expanduser()}")
    if args.report_junit:
        print(f"JUnit report: {Path(args.report_junit).expanduser()}")
    if github_path is not None:
        print(f"GitHub summary: {github_path}")
    return 0 if result.passed else 1


def _validate(args: argparse.Namespace) -> int:
    project, root = load_project(args.project)
    endpoints, _ = select_endpoints(project)
    environment = select_environment(project, args.env)
    variables = _load_variables(args, environment)
    result = validate_project(project, endpoints, environment, variables)
    failed = not result.valid or (args.strict and bool(result.warnings))
    if args.json:
        output = {"project": str(root), **result.to_dict(), "strict": bool(args.strict)}
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 2 if failed else 0

    for item in result.diagnostics:
        marker = "ERROR" if item.severity == "error" else "WARN "
        print(f"{marker}  [{item.code}] {item.location}: {item.message}")
    if not result.diagnostics:
        print("No validation issues found.")
    print(f"\n{'INVALID' if failed else 'VALID'}: {len(result.errors)} errors, {len(result.warnings)} warnings")
    return 2 if failed else 0


def _list(args: argparse.Namespace) -> int:
    project, root = load_project(args.project)
    rows = list_project_resources(project, args.resource)
    if args.json:
        print(json.dumps({
            "project": {"id": project.get("id"), "name": project.get("name"), "path": str(root)},
            "resource": args.resource,
            "count": len(rows),
            "items": rows,
        }, indent=2, ensure_ascii=False))
        return 0

    if not rows:
        print(f"No {args.resource} found.")
        return 0
    if args.resource == "endpoints":
        print(f"{'METHOD':<8} {'NAME':<28} {'FOLDER':<24} ID")
        for row in rows:
            print(f"{row['method']:<8} {row['name'][:27]:<28} {row['folder'][:23]:<24} {row['id']}")
    elif args.resource == "folders":
        print(f"{'PATH':<44} {'ENDPOINTS':<10} ID")
        for row in rows:
            print(f"{row['path'][:43]:<44} {row['endpoints']:<10} {row['id']}")
    else:
        print(f"{'ACTIVE':<8} {'NAME':<28} {'BASE URL':<44} ID")
        for row in rows:
            print(f"{('*' if row['active'] else ''):<8} {row['name'][:27]:<28} {row['base_url'][:43]:<44} {row['id']}")
    return 0


def _ci_init_github(args: argparse.Namespace) -> int:
    project, project_root = load_project(args.project)
    environment = select_environment(project, args.env)
    plan = create_github_workflow_plan(
        project_root,
        project,
        environment,
        cli_version=args.cli_version,
        repository_root=args.repo_root,
    )
    if args.dry_run:
        print(plan.content, end="")
        print(f"Preview only; no file written. Destination: {plan.destination}", file=sys.stderr)
        return 0

    result = write_github_workflow(plan, force=args.force)
    action = {"created": "Created", "updated": "Updated", "unchanged": "Already up to date"}[result.state]
    print(f"{action}: {result.path}")
    print(f"Project path in workflow: {plan.project_path}")
    if plan.secret_names:
        print("\nAdd these repository secrets in GitHub before the workflow runs:")
        for name in plan.secret_names:
            print(f"  - {name}")
    else:
        print("\nNo private environment variables were detected for this environment.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            return _run(args)
        if args.command == "validate":
            return _validate(args)
        if args.command == "list":
            return _list(args)
        if args.command == "ci" and args.ci_command == "init" and args.ci_provider == "github":
            return _ci_init_github(args)
    except KeyboardInterrupt:
        print("\nRun interrupted.", file=sys.stderr)
        return 130
    except CliProjectError as error:
        if getattr(args, "json", False):
            payload = {
                "valid": False,
                "summary": {"errors": 1, "warnings": 0},
                "diagnostics": [{
                    "severity": "error",
                    "code": "cli_error",
                    "location": str(getattr(args, "project", ".")),
                    "message": str(error),
                }],
            } if args.command == "validate" else {
                "error": {"code": "cli_error", "message": str(error)},
            }
            print(json.dumps(payload, indent=2, ensure_ascii=False))
            return 2
        print(f"Beacon CLI error: {error}", file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
