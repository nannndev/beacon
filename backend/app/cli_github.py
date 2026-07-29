"""GitHub Actions output for Beacon CLI runs.

The output is deliberately derived from execution metadata, not response
values. Assertion expected/actual values and transport exception text may
contain credentials, rendered URLs, or response secrets and must not be
written to pull-request annotations.
"""
from __future__ import annotations

import os
from pathlib import Path

from .cli_runner import CliProjectError, CliRunResult, ExecutionResult


def github_summary_path() -> Path:
    raw = os.getenv("GITHUB_STEP_SUMMARY", "").strip()
    if not raw:
        raise CliProjectError(
            "--github requires GitHub Actions (GITHUB_STEP_SUMMARY is not set)"
        )
    return Path(raw).expanduser()


def _markdown(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _annotation_data(value: object) -> str:
    return str(value).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def _annotation_property(value: object) -> str:
    return _annotation_data(value).replace(":", "%3A").replace(",", "%2C")


def safe_failure_reason(execution: ExecutionResult) -> str:
    reasons: list[str] = []
    if execution.status is None:
        reasons.append("request failed before an HTTP response")
    elif not 200 <= execution.status < 300:
        reasons.append(f"HTTP {execution.status}")

    failed_assertions = [item for item in execution.assertions if not item.get("ok")]
    if failed_assertions:
        kinds = sorted({str(item.get("type") or "unknown") for item in failed_assertions})
        reasons.append(
            f"{len(failed_assertions)} assertion(s) failed ({', '.join(kinds)})"
        )
    return "; ".join(reasons) or "request failed"


def github_annotations(result: CliRunResult) -> list[str]:
    output: list[str] = []
    for execution in result.executions:
        if execution.passed:
            continue
        title = _annotation_property(f"Beacon: {execution.endpoint_name}")
        message = _annotation_data(
            f"{execution.method} {execution.endpoint_name}, iteration "
            f"{execution.iteration}: {safe_failure_reason(execution)}"
        )
        output.append(f"::error title={title}::{message}")
    return output


def github_summary_markdown(result: CliRunResult) -> str:
    summary = result.summary
    state = "Passed" if result.passed else "Failed"
    icon = "✅" if result.passed else "❌"
    environment = result.environment_name or "None"
    lines = [
        f"# {icon} Beacon API tests: {state}",
        "",
        "| Project | Environment | Scope | Duration |",
        "| --- | --- | --- | ---: |",
        f"| {_markdown(result.project_name)} | {_markdown(environment)} | "
        f"{_markdown(result.scope)} | {result.duration_ms} ms |",
        "",
        "| Total | Passed | Failed |",
        "| ---: | ---: | ---: |",
        f"| {summary['total']} | {summary['passed']} | {summary['failed']} |",
    ]
    failures = [item for item in result.executions if not item.passed]
    if failures:
        lines.extend([
            "",
            "## Failures",
            "",
            "| Endpoint | Iteration | Status | Reason |",
            "| --- | ---: | ---: | --- |",
        ])
        for execution in failures[:50]:
            status = execution.status if execution.status is not None else "—"
            lines.append(
                f"| {_markdown(execution.method)} {_markdown(execution.endpoint_name)} | "
                f"{execution.iteration} | {status} | "
                f"{_markdown(safe_failure_reason(execution))} |"
            )
        if len(failures) > 50:
            lines.extend(["", f"_Showing 50 of {len(failures)} failures._"])
    lines.extend([
        "",
        "Detailed machine-readable results are available in the Beacon report artifact.",
        "",
    ])
    return "\n".join(lines)


def write_github_summary(result: CliRunResult, path: Path) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(github_summary_markdown(result))
    except OSError as error:
        raise CliProjectError(f"Could not write GitHub Actions summary: {error}") from error
