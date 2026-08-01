"""Headless execution of Git-backed Beacon projects.

This module deliberately has no FastAPI, desktop, or history dependency.  It
loads the same readable project format as the desktop app and executes requests
through the shared core engine, so assertions and extractors behave identically
in a terminal and in Beacon.
"""
from __future__ import annotations

import json
import os
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

from .core.models import EndpointTest, TestConfig
from .core.tester import APITester
from .services.project_file_sync import MANIFEST, ProjectFileSyncService


REPORT_FORMAT = "beacon.cli.report"
REPORT_VERSION = 1
TEMPLATE_PATTERN = re.compile(r"\{\{([^}]+)\}\}")
HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"}
PAYLOAD_TYPES = {"json", "form", "multipart", "raw"}
TARGET_TYPES = {"api", "web"}
ASSERTION_OPERATORS = {
    "status": {"eq", "ne", "lt", "gt", "lte", "gte"},
    "time_ms": {"eq", "ne", "lt", "gt", "lte", "gte"},
    "body_contains": {"eq"},
    "jsonpath": {"eq", "ne", "contains", "exists"},
    "header": {"exists", "eq", "contains"},
}


class CliProjectError(ValueError):
    """The requested CLI run cannot be constructed safely."""


@dataclass
class ValidationDiagnostic:
    severity: str
    code: str
    location: str
    message: str


@dataclass
class ProjectValidationResult:
    diagnostics: list[ValidationDiagnostic] = field(default_factory=list)

    @property
    def errors(self) -> list[ValidationDiagnostic]:
        return [item for item in self.diagnostics if item.severity == "error"]

    @property
    def warnings(self) -> list[ValidationDiagnostic]:
        return [item for item in self.diagnostics if item.severity == "warning"]

    @property
    def valid(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "summary": {"errors": len(self.errors), "warnings": len(self.warnings)},
            "diagnostics": [asdict(item) for item in self.diagnostics],
        }


@dataclass
class ExecutionResult:
    endpoint_id: str
    endpoint_name: str
    method: str
    target: str
    iteration: int
    passed: bool
    status: int | None = None
    time_ms: int | None = None
    error: str | None = None
    assertions: list[dict[str, Any]] = field(default_factory=list)
    extracted: list[str] = field(default_factory=list)
    attempts: int = 1


@dataclass
class CliRunResult:
    project_id: str
    project_name: str
    environment_id: str | None
    environment_name: str | None
    scope: str
    started_at: str
    duration_ms: int
    passed: bool
    stopped_early: bool
    executions: list[ExecutionResult]

    @property
    def summary(self) -> dict[str, int]:
        total = len(self.executions)
        passed = sum(1 for item in self.executions if item.passed)
        return {"total": total, "passed": passed, "failed": total - passed}

    def to_dict(self) -> dict[str, Any]:
        return {
            "format": REPORT_FORMAT,
            "version": REPORT_VERSION,
            "project": {"id": self.project_id, "name": self.project_name},
            "environment": (
                {"id": self.environment_id, "name": self.environment_name}
                if self.environment_id else None
            ),
            "scope": self.scope,
            "started_at": self.started_at,
            "duration_ms": self.duration_ms,
            "passed": self.passed,
            "stopped_early": self.stopped_early,
            "summary": self.summary,
            "executions": [asdict(item) for item in self.executions],
        }


def load_project(project_path: str | Path) -> tuple[dict[str, Any], Path]:
    root = Path(project_path).expanduser().resolve()
    if root.is_file() and root.name == MANIFEST:
        root = root.parent
    if not root.is_dir() or not (root / MANIFEST).is_file():
        raise CliProjectError(f"Beacon project not found at {root}")
    try:
        return ProjectFileSyncService().open_existing(str(root)), root
    except ValueError as error:
        raise CliProjectError(str(error)) from error


def _flatten_requests(items: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for item in items:
        if item.get("type") == "folder":
            result.extend(_flatten_requests(item.get("items") or []))
        elif item.get("type") == "request":
            result.append(item)
    return result


def auth_chains(project: dict[str, Any]) -> dict[str, list]:
    """Map each endpoint id to the auth of everything enclosing it.

    The CLI selects endpoints out of the tree, which loses the folder context an
    endpoint set to `inherit` depends on. Resolving the chain up front keeps CLI
    runs authenticating exactly like the desktop app.
    """
    chains: dict[str, list] = {}
    project_auth = project.get("auth")

    def walk(nodes: Iterable[dict[str, Any]], inherited: list) -> None:
        for item in nodes or []:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "folder":
                walk(item.get("items") or [], [*inherited, item.get("auth")])
            elif item.get("type") == "request":
                chains[str(item.get("id") or "")] = [level for level in inherited if level]

    walk(project.get("items") or [], [project_auth] if project_auth else [])
    return chains


def _find_unique(nodes: Iterable[dict[str, Any]], selector: str, kind: str) -> dict[str, Any]:
    selector_lower = selector.casefold()
    matches: list[dict[str, Any]] = []

    def visit(items: Iterable[dict[str, Any]]) -> None:
        for item in items:
            item_kind = "folder" if item.get("type") == "folder" else "endpoint"
            if item_kind == kind and (
                str(item.get("id") or "") == selector
                or str(item.get("name") or "").casefold() == selector_lower
            ):
                matches.append(item)
            if item.get("type") == "folder":
                visit(item.get("items") or [])

    visit(nodes)
    if not matches:
        raise CliProjectError(f"{kind.title()} not found: {selector}")
    if len(matches) > 1:
        raise CliProjectError(f"{kind.title()} name is ambiguous; use its ID: {selector}")
    return matches[0]


def select_endpoints(
    project: dict[str, Any],
    endpoint_selectors: list[str] | None = None,
    folder_selector: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    items = project.get("items") or []
    if endpoint_selectors and folder_selector:
        raise CliProjectError("Choose endpoint scope or folder scope, not both")
    if endpoint_selectors:
        endpoints = [_find_unique(items, selector, "endpoint") for selector in endpoint_selectors]
        return endpoints, "endpoints:" + ",".join(endpoint_selectors)
    if folder_selector:
        folder = _find_unique(items, folder_selector, "folder")
        endpoints = _flatten_requests(folder.get("items") or [])
        if not endpoints:
            raise CliProjectError(f"Folder has no endpoints: {folder_selector}")
        return endpoints, f"folder:{folder_selector}"
    endpoints = _flatten_requests(items)
    if not endpoints:
        raise CliProjectError("Project has no endpoints")
    return endpoints, "project"


def select_environment(project: dict[str, Any], selector: str | None) -> dict[str, Any] | None:
    environments = project.get("environments") or []
    wanted = selector or project.get("current_environment_id")
    if wanted:
        wanted_lower = str(wanted).casefold()
        matches = [
            env for env in environments
            if str(env.get("id") or "") == str(wanted)
            or str(env.get("name") or "").casefold() == wanted_lower
        ]
        if not matches:
            raise CliProjectError(f"Environment not found: {wanted}")
        if len(matches) > 1:
            raise CliProjectError(f"Environment name is ambiguous; use its ID: {wanted}")
        return matches[0]
    return environments[0] if environments else None


def walk_project_items(
    items: Iterable[dict[str, Any]],
    parents: tuple[str, ...] = (),
) -> Iterable[tuple[dict[str, Any], tuple[str, ...]]]:
    """Yield every folder/request with the names of its parent folders."""
    for item in items:
        yield item, parents
        if item.get("type") == "folder":
            yield from walk_project_items(item.get("items") or [], (*parents, str(item.get("name") or "Folder")))


def list_project_resources(project: dict[str, Any], resource: str) -> list[dict[str, Any]]:
    if resource == "environments":
        environments = project.get("environments") or []
        active_id = str(
            project.get("current_environment_id")
            or ((environments[0] or {}).get("id") if environments else "")
            or ""
        )
        return [
            {
                "id": str(environment.get("id") or ""),
                "name": str(environment.get("name") or "Environment"),
                "base_url": str(environment.get("base_url") or ""),
                "active": str(environment.get("id") or "") == active_id,
            }
            for environment in environments
        ]

    rows: list[dict[str, Any]] = []
    for item, parents in walk_project_items(project.get("items") or []):
        item_type = item.get("type")
        if resource == "endpoints" and item_type == "request":
            rows.append({
                "id": str(item.get("id") or ""),
                "name": str(item.get("name") or "Endpoint"),
                "method": str(item.get("method") or "GET").upper(),
                "target_type": str(item.get("target_type") or "api"),
                "folder": " / ".join(parents),
                "url": str(item.get("url") or ""),
            })
        elif resource == "folders" and item_type == "folder":
            rows.append({
                "id": str(item.get("id") or ""),
                "name": str(item.get("name") or "Folder"),
                "path": " / ".join((*parents, str(item.get("name") or "Folder"))),
                "endpoints": len(_flatten_requests(item.get("items") or [])),
            })
    if resource not in {"endpoints", "folders", "environments"}:
        raise CliProjectError(f"Unsupported list resource: {resource}")
    return rows


def _template_tokens(value: Any) -> set[str]:
    if isinstance(value, str):
        return {match.group(1).strip() for match in TEMPLATE_PATTERN.finditer(value)}
    if isinstance(value, dict):
        return set().union(*(_template_tokens(item) for item in value.values()), set())
    if isinstance(value, list):
        return set().union(*(_template_tokens(item) for item in value), set())
    return set()


def _dynamic_template_error(token: str) -> str | None:
    normalized = token.lower().strip()
    if normalized in {
        "random_email", "random_phone", "random_uuid", "uuid", "timestamp",
        "random_string", "random_number", "random_int",
    }:
        return None
    if normalized.startswith("random_string:"):
        raw_length = normalized.split(":", 1)[1]
        try:
            length = int(raw_length)
        except ValueError:
            return "random_string length must be an integer"
        return None if length >= 1 else "random_string length must be at least 1"
    if normalized.startswith("random_int:"):
        parts = normalized.split(":")
        if len(parts) != 3:
            return "random_int must use random_int:MIN:MAX"
        try:
            minimum, maximum = int(parts[1]), int(parts[2])
        except ValueError:
            return "random_int bounds must be integers"
        return None if minimum <= maximum else "random_int minimum cannot exceed maximum"
    return "unknown template variable"


def _add_diagnostic(
    result: ProjectValidationResult,
    severity: str,
    code: str,
    location: str,
    message: str,
) -> None:
    diagnostic = ValidationDiagnostic(severity, code, location, message)
    if diagnostic not in result.diagnostics:
        result.diagnostics.append(diagnostic)


def validate_project(
    project: dict[str, Any],
    endpoints: list[dict[str, Any]],
    environment: dict[str, Any] | None,
    variables: dict[str, Any],
) -> ProjectValidationResult:
    """Validate a runnable project scope without performing network I/O."""
    result = ProjectValidationResult()
    seen_ids: dict[str, str] = {}
    seen_names: dict[tuple[str, str], str] = {}

    def check_id(resource_id: Any, location: str) -> None:
        normalized = str(resource_id or "").strip()
        if not normalized:
            _add_diagnostic(result, "error", "missing_id", location, "Stable ID is required")
        elif normalized in seen_ids:
            _add_diagnostic(
                result, "error", "duplicate_id", location,
                f"ID {normalized!r} is already used by {seen_ids[normalized]}",
            )
        else:
            seen_ids[normalized] = location

    check_id(project.get("id"), "project")
    for environment_item in project.get("environments") or []:
        environment_location = f"environment:{environment_item.get('name') or 'unnamed'}"
        check_id(environment_item.get("id"), environment_location)
        name_key = ("environment", str(environment_item.get("name") or "").casefold())
        if name_key[1] and name_key in seen_names:
            _add_diagnostic(
                result, "warning", "ambiguous_name", environment_location,
                "Environment name is duplicated; CLI selection must use its ID",
            )
        seen_names[name_key] = environment_location
    for item, parents in walk_project_items(project.get("items") or []):
        label = str(item.get("name") or "unnamed")
        location = "/".join((*parents, label))
        kind = "folder" if item.get("type") == "folder" else "endpoint"
        resource_location = f"{kind}:{location}"
        check_id(item.get("id"), resource_location)
        name_key = (kind, label.casefold())
        if label != "unnamed" and name_key in seen_names:
            _add_diagnostic(
                result, "warning", "ambiguous_name", resource_location,
                f"{kind.title()} name is duplicated; CLI selection must use its ID",
            )
        seen_names[name_key] = resource_location

    if environment:
        base_url = str(environment.get("base_url") or "").strip()
        if base_url and not TEMPLATE_PATTERN.search(base_url) and not re.match(r"^https?://", base_url, re.IGNORECASE):
            _add_diagnostic(
                result, "error", "invalid_base_url", f"environment:{environment.get('name')}",
                "Base URL must start with http:// or https://",
            )

    missing_private = set(missing_private_values(environment, variables))
    available = set(str(key) for key in variables)
    endpoint_ids = {str(endpoint.get("id") or "") for endpoint in endpoints}

    def check_template_token(token: str, location: str, stack: tuple[str, ...] = ()) -> None:
        if token in available:
            if token in missing_private:
                _add_diagnostic(
                    result, "error", "missing_private_variable", location,
                    f"Private variable {token!r} has no local or CI value",
                )
            elif token in variables and (variables[token] is None or str(variables[token]).strip() == ""):
                _add_diagnostic(
                    result, "error", "empty_variable", location,
                    f"Variable {token!r} is used but has no value",
                )
            if token in stack:
                _add_diagnostic(
                    result, "error", "cyclic_variable", location,
                    f"Variable template cycle detected: {' -> '.join((*stack, token))}",
                )
                return
            for dependency in sorted(_template_tokens(variables.get(token))):
                check_template_token(dependency, location, (*stack, token))
            return
        dynamic_error = _dynamic_template_error(token)
        if dynamic_error:
            _add_diagnostic(result, "error", "unknown_variable", location, f"Template {token!r}: {dynamic_error}")

    if environment:
        environment_location = f"environment:{environment.get('name') or 'unnamed'}"
        for token in sorted(_template_tokens(environment.get("base_url"))):
            check_template_token(token, environment_location)

    for endpoint, parents in walk_project_items(project.get("items") or []):
        if endpoint.get("type") != "request" or str(endpoint.get("id") or "") not in endpoint_ids:
            continue
        name = str(endpoint.get("name") or "").strip()
        location = "/".join((*parents, name or str(endpoint.get("id") or "unnamed")))
        prefix = f"endpoint:{location}"
        url = str(endpoint.get("url") or "").strip()
        method = str(endpoint.get("method") or "").upper()
        payload_type = str(endpoint.get("payload_type") or "json").lower()
        target_type = str(endpoint.get("target_type") or "api").lower()

        if not name:
            _add_diagnostic(result, "error", "missing_name", prefix, "Endpoint name is required")
        if not url:
            _add_diagnostic(result, "error", "missing_url", prefix, "Request URL is required")
        elif not re.match(r"^https?://", url, re.IGNORECASE) and not TEMPLATE_PATTERN.search(url):
            if not str((environment or {}).get("base_url") or "").strip():
                _add_diagnostic(
                    result, "error", "missing_base_url", prefix,
                    "Relative request URL requires an environment base URL",
                )
        if method not in HTTP_METHODS:
            _add_diagnostic(result, "error", "invalid_method", prefix, f"Unsupported HTTP method: {method or 'empty'}")
        if payload_type not in PAYLOAD_TYPES:
            _add_diagnostic(result, "error", "invalid_payload_type", prefix, f"Unsupported payload type: {payload_type}")
        if target_type not in TARGET_TYPES:
            _add_diagnostic(result, "error", "invalid_target_type", prefix, f"Unsupported target type: {target_type}")
        if not isinstance(endpoint.get("headers", {}), dict):
            _add_diagnostic(result, "error", "invalid_headers", prefix, "Headers must be a key-value mapping")

        extractors = endpoint.get("extractors") or {}
        if not isinstance(extractors, dict):
            _add_diagnostic(result, "error", "invalid_extractors", prefix, "Extractors must be a variable-to-source mapping")
            extractors = {}
        else:
            for variable_name, source in extractors.items():
                extractor_location = f"{prefix}.extractor:{variable_name or 'unnamed'}"
                normalized_source = str(source or "")
                if not str(variable_name).strip():
                    _add_diagnostic(result, "error", "missing_extractor_name", extractor_location, "Extractor variable name is required")
                if not normalized_source.startswith("body.") and "cookie" not in normalized_source.lower():
                    _add_diagnostic(
                        result, "error", "invalid_extractor_source", extractor_location,
                        "Extractor source must be body.PATH or a cookie source",
                    )
                elif normalized_source == "body.":
                    _add_diagnostic(result, "error", "invalid_extractor_source", extractor_location, "Extractor body path cannot be empty")

        assertions = endpoint.get("assertions") or []
        if not isinstance(assertions, list):
            _add_diagnostic(result, "error", "invalid_assertions", prefix, "Assertions must be a list")
            assertions = []
        for index, assertion in enumerate(assertions, 1):
            assertion_location = f"{prefix}.assertion:{index}"
            if not isinstance(assertion, dict):
                _add_diagnostic(result, "error", "invalid_assertion", assertion_location, "Assertion must be a mapping")
                continue
            assertion_type = str(assertion.get("type") or "")
            operators = ASSERTION_OPERATORS.get(assertion_type)
            operator = str(assertion.get("op") or ("eq" if assertion_type == "body_contains" else ""))
            if operators is None:
                _add_diagnostic(result, "error", "invalid_assertion_type", assertion_location, f"Unsupported assertion type: {assertion_type or 'empty'}")
                continue
            if operator not in operators:
                _add_diagnostic(result, "error", "invalid_assertion_operator", assertion_location, f"Operator {operator or 'empty'} is not valid for {assertion_type}")
            if assertion_type == "header" and not str(assertion.get("name") or "").strip():
                _add_diagnostic(result, "error", "missing_header_name", assertion_location, "Header assertion requires a header name")
            if assertion_type == "jsonpath" and not str(assertion.get("path") or "").strip():
                _add_diagnostic(result, "error", "missing_json_path", assertion_location, "JSON assertion requires a path")
            if operator != "exists" and assertion.get("value") is None:
                _add_diagnostic(result, "error", "missing_assertion_value", assertion_location, "Assertion expected value is required")

        template_input = {
            "url": endpoint.get("url"),
            "headers": endpoint.get("headers"),
            "payload": endpoint.get("payload"),
        }
        for token in sorted(_template_tokens(template_input)):
            check_template_token(token, prefix)
        available.update(str(key) for key in extractors)

        run_config = endpoint.get("run_config")
        if run_config is not None and not isinstance(run_config, dict):
            _add_diagnostic(result, "error", "invalid_run_config", prefix, "Run configuration must be a mapping")
        elif isinstance(run_config, dict):
            for key, minimum in (("concurrency", 1), ("max_requests", 1), ("delay", 0)):
                if key not in run_config:
                    continue
                try:
                    numeric = float(run_config[key])
                except (TypeError, ValueError):
                    _add_diagnostic(result, "error", "invalid_run_config", prefix, f"{key} must be numeric")
                    continue
                if numeric < minimum:
                    _add_diagnostic(result, "error", "invalid_run_config", prefix, f"{key} must be at least {minimum}")

    if not endpoints:
        _add_diagnostic(result, "warning", "empty_scope", "project", "Selected scope contains no endpoints")
    return result


def parse_env_file(path: str | Path) -> dict[str, str]:
    result: dict[str, str] = {}
    try:
        lines = Path(path).expanduser().read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise CliProjectError(f"Could not read environment file: {error}") from error
    for number, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise CliProjectError(f"Invalid environment file line {number}: expected KEY=VALUE")
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            raise CliProjectError(f"Invalid environment file line {number}: empty key")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        result[key] = value
    return result


def parse_env_vars(values: Iterable[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for raw in values:
        if "=" not in raw:
            raise CliProjectError(f"Invalid --env-var value: {raw!r}; expected KEY=VALUE")
        key, value = raw.split("=", 1)
        if not key.strip():
            raise CliProjectError("--env-var key cannot be empty")
        result[key.strip()] = value
    return result


def shell_variable_name(key: str) -> str:
    """Return the BEACON_VAR_* suffix used for a Beacon project variable."""
    return re.sub(r"[^A-Za-z0-9]+", "_", key).strip("_").upper()


def resolve_variables(
    environment: dict[str, Any] | None,
    env_file_values: dict[str, str] | None = None,
    cli_values: dict[str, str] | None = None,
) -> dict[str, Any]:
    variables = dict((environment or {}).get("variables") or {})
    variables.update(env_file_values or {})
    for key in list(variables):
        prefixed = os.getenv(f"BEACON_VAR_{shell_variable_name(str(key))}")
        if prefixed is not None:
            variables[key] = prefixed
    variables.update(cli_values or {})
    return variables


def missing_private_values(environment: dict[str, Any] | None, variables: dict[str, Any]) -> list[str]:
    if environment is None:
        return []
    probe = {"environments": [{**environment, "variables": variables}]}
    return [item["key"] for item in ProjectFileSyncService.missing_private_values(probe)]


def run_project(
    project: dict[str, Any],
    endpoints: list[dict[str, Any]],
    environment: dict[str, Any] | None,
    variables: dict[str, Any],
    *,
    scope: str,
    iterations: int = 1,
    retries: int = 0,
    retry_delay_ms: int = 0,
    bail: bool = False,
    on_execution=None,
) -> CliRunResult:
    if iterations < 1:
        raise CliProjectError("Iterations must be at least 1")
    if retries < 0 or retry_delay_ms < 0:
        raise CliProjectError("Retries and retry delay cannot be negative")

    config = TestConfig(
        base_url=str((environment or {}).get("base_url") or ""),
        variables=variables,
    )
    started = time.time()
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started))
    executions: list[ExecutionResult] = []
    stopped_early = False

    inherited_auth = auth_chains(project)
    for iteration in range(1, iterations + 1):
        for endpoint_data in endpoints:
            endpoint = EndpointTest.from_dict(endpoint_data)
            endpoint.inherited_auth = inherited_auth.get(str(endpoint.id), [])
            tester = APITester(endpoint, config)
            response = tester.send_once(
                retries=retries,
                retry_delay=retry_delay_ms / 1000.0,
            )
            status = response.get("status")
            http_ok = isinstance(status, int) and 200 <= status < 300
            assertions = response.get("assertions") or []
            assertions_ok = all(bool(item.get("ok")) for item in assertions)
            passed = bool(response.get("ok")) and http_ok and assertions_ok
            error = response.get("error")
            if not error and not http_ok:
                error = f"HTTP {status}" if status is not None else "No HTTP response"
            if not error and not assertions_ok:
                failures = [item.get("message") for item in assertions if not item.get("ok")]
                error = "; ".join(str(item) for item in failures if item) or "Assertion failed"
            execution = ExecutionResult(
                endpoint_id=endpoint.id,
                endpoint_name=endpoint.name,
                method=endpoint.method,
                # Keep rendered URLs (which may contain secret query values)
                # out of machine-readable reports. The project template is
                # enough to identify the request without leaking credentials.
                target=endpoint.url,
                iteration=iteration,
                passed=passed,
                status=status if isinstance(status, int) else None,
                time_ms=response.get("time_ms"),
                error=str(error) if error else None,
                assertions=assertions,
                extracted=list(response.get("extracted") or []),
                attempts=int(response.get("attempts") or 1),
            )
            executions.append(execution)
            if on_execution:
                on_execution(execution)
            if bail and not passed:
                stopped_early = True
                break
        if stopped_early:
            break

    duration_ms = round((time.time() - started) * 1000)
    return CliRunResult(
        project_id=str(project.get("id") or ""),
        project_name=str(project.get("name") or "Project"),
        environment_id=str(environment.get("id")) if environment and environment.get("id") else None,
        environment_name=str(environment.get("name")) if environment else None,
        scope=scope,
        started_at=started_at,
        duration_ms=duration_ms,
        passed=bool(executions) and all(item.passed for item in executions),
        stopped_early=stopped_early,
        executions=executions,
    )


def write_json_report(result: CliRunResult, path: str | Path) -> None:
    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result.to_dict(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_junit_report(result: CliRunResult, path: str | Path) -> None:
    summary = result.summary
    suite = ET.Element(
        "testsuite",
        name=f"Beacon: {result.project_name}",
        tests=str(summary["total"]),
        failures=str(summary["failed"]),
        errors="0",
        time=f"{result.duration_ms / 1000:.3f}",
    )
    for execution in result.executions:
        case = ET.SubElement(
            suite,
            "testcase",
            classname=result.project_name,
            name=f"{execution.endpoint_name} [iteration {execution.iteration}]",
            time=f"{(execution.time_ms or 0) / 1000:.3f}",
        )
        if not execution.passed:
            failure = ET.SubElement(case, "failure", message=execution.error or "Request failed")
            failure.text = execution.error or "Request failed"
        properties = ET.SubElement(case, "properties")
        ET.SubElement(properties, "property", name="method", value=execution.method)
        ET.SubElement(properties, "property", name="target", value=execution.target)
        if execution.status is not None:
            ET.SubElement(properties, "property", name="status", value=str(execution.status))
    tree = ET.ElementTree(suite)
    ET.indent(tree, space="  ")
    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    tree.write(target, encoding="utf-8", xml_declaration=True)
