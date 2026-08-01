"""Beacon MCP server.

Standard MCP (Model Context Protocol) server.

Exposes Beacon's API-testing engine to **any** MCP client:
- Claude Desktop / Claude Code
- Cursor, Windsurf, Cline, Continue.dev, Zed, etc.

It reuses the exact same core engine and JSON store as the FastAPI backend.

Run it two ways (same file):

    # stdio (local — Claude Desktop / Claude Code on this machine)
    python -m app.mcp_server

    # HTTP / SSE (hostable — set the transport + optional host/port)
    BEACON_MCP_TRANSPORT=http BEACON_MCP_PORT=8765 python -m app.mcp_server

Storage follows the same rules as the backend: `config/tests.json` relative to
cwd, or `BEACON_DATA_DIR/tests.json` if that env var is set. Because this runs
as its own process, keep either the web backend OR the MCP server writing the
file at a time to avoid clobbering.
"""
from __future__ import annotations

import os
import copy
import functools
import json
import re
import shlex
import sys
import threading
import uuid
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP


def _pin_data_dir() -> None:
    """Pin BEACON_DATA_DIR to the shared per-user data dir BEFORE importing the
    store.

    External stdio clients (Claude Desktop/Code, Cursor, Windsurf, …) launch
    this server with an arbitrary cwd and no BEACON_DATA_DIR. The store resolves
    its file path once, at import time. If we don't set the env var here — before
    `from .state import store` runs — the store falls back to a cwd-relative
    `config/tests.json` and silently diverges from the file the desktop app
    reads/writes, so endpoints created via MCP never appear in the app (and vice
    versa). Doing it in `main()` is too late: the store is already bound.
    """
    if os.getenv("BEACON_DATA_DIR"):
        return
    if sys.platform.startswith("win"):
        appdata = os.getenv("APPDATA") or os.path.expanduser(r"~\AppData\Roaming")
        base = os.path.join(appdata, "com.beacon.app")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support/com.beacon.app")
    else:
        base = os.path.expanduser("~/.config/com.beacon.app")
    os.environ["BEACON_DATA_DIR"] = base


_pin_data_dir()

from .core.tester import APITester, EndpointTest
from .history.models import RunStart, RunStepStart
from .history.sanitize import sanitize_run_config
from .services.project_importer import ProjectImportError, materialize_items, normalize_project
from .state import store

# FastMCP runs sync tool functions in a threadpool, so parallel tool calls
# execute concurrently and each does a read-modify-write on the shared global
# `store`. Without serialization, interleaved `_reload()`/`save()` calls lose
# each other's updates (a batch of parallel creates/deletes can wipe the config).
# Hold this lock across the whole read-modify-write of every mutating tool.
_STORE_LOCK = threading.RLock()


def _locked(fn):
    """Serialize a tool's access to the shared store. `functools.wraps` keeps the
    original signature/annotations so FastMCP still derives the correct schema."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with _STORE_LOCK:
            return fn(*args, **kwargs)
    return wrapper

_HOST = os.getenv("BEACON_MCP_HOST", "127.0.0.1")
_PORT = int(os.getenv("BEACON_MCP_PORT", "8765"))

mcp = FastMCP("Beacon", host=_HOST, port=_PORT)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _reload() -> None:
    """Sync in-memory state with tests.json on disk before every operation, so
    edits made in the web app / desktop app are reflected here."""
    store.load()


def _prepare_history() -> None:
    """Lazily initialize history in the standalone MCP process."""
    if store.history.workspace_id is None and store.history.available:
        store.history.initialize()
        store.history.mark_interrupted_runs()


def _history_project() -> dict:
    return _active_project() or {
        "id": store.current_project_id or "unknown",
        "name": "Unknown project",
    }


def _active_project() -> Optional[dict]:
    return next((p for p in store.projects if p.get("id") == store.current_project_id), None)


def _find_test(name_or_id: str) -> Optional[EndpointTest]:
    """Resolve an endpoint by id first, then by (case-insensitive) name."""
    tests = store.current_config.tests
    for t in tests:
        if t.id == name_or_id:
            return t
    lowered = name_or_id.strip().lower()
    return next((t for t in tests if t.name.strip().lower() == lowered), None)


def _endpoint_summary(t: EndpointTest, base_url: str = "") -> dict:
    summary = {
        "id": t.id,
        "name": t.name,
        "method": t.method,
        "url": t.url,
        "target_type": getattr(t, "target_type", "api"),
    }
    if base_url:
        summary["resolved_url"] = _resolved_target(base_url, t.url)
    return summary


def _error(code: str, message: str, **details) -> dict:
    """Stable tool error shape that agents can branch on without parsing prose."""
    return {"ok": False, "error": message, "error_code": code, **details}


def _positive_int(value, name: str, *, minimum: int = 1, maximum: int = 100_000):
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        return None, _error("invalid_argument", f"{name} must be an integer.", field=name)
    if normalized < minimum or normalized > maximum:
        return None, _error(
            "invalid_argument", f"{name} must be between {minimum} and {maximum}.", field=name
        )
    return normalized, None


def _non_negative_float(value, name: str, *, maximum: float = 3600.0):
    try:
        normalized = float(value)
    except (TypeError, ValueError):
        return None, _error("invalid_argument", f"{name} must be a number.", field=name)
    if normalized < 0 or normalized > maximum:
        return None, _error(
            "invalid_argument", f"{name} must be between 0 and {maximum:g}.", field=name
        )
    return normalized, None


def _unresolved_variables(test: EndpointTest) -> list[str]:
    serialized = json.dumps(
        {"url": test.url, "headers": test.headers, "payload": test.payload}, default=str
    )
    referenced = set(re.findall(r"\{\{\s*([^{}]+?)\s*\}\}", serialized))
    dynamic_prefixes = (
        "random_email", "random_phone", "random_uuid", "uuid", "timestamp",
        "random_string", "random_number", "random_int",
    )
    return sorted(
        token for token in referenced
        if token not in store.current_config.variables
        and not token.startswith(dynamic_prefixes)
    )


def _resolved_target(base_url: str, url: str) -> str:
    """The URL the tester will actually hit. Mirrors APITester's join logic:
    an absolute endpoint URL is used as-is; a relative one is joined onto
    base_url. (Naive `base_url + url` produced garbled targets like
    `https://api.example.comhttps://httpbin.org/get` for absolute URLs.)"""
    if url.startswith("http"):
        return url
    return base_url.rstrip("/") + "/" + url.lstrip("/")


def _find_node(items, pred):
    """DFS the items tree for the first node matching `pred`. Returns
    (node, parent_list) so callers can move/remove it, or (None, None)."""
    for n in items or []:
        if not isinstance(n, dict):
            continue
        if pred(n):
            return n, items
        if n.get("type") == "folder":
            found, parent = _find_node(n.get("items", []), pred)
            if found is not None:
                return found, parent
    return None, None


def _resolve_node(items, key: str, kind: Optional[str] = None):
    """Resolve a tree node by id (preferred) or case-insensitive name.
    `kind` optionally restricts to 'folder' or 'request'."""
    def ok(n):
        return kind is None or n.get("type", "request") == kind
    node, parent = _find_node(items, lambda n: n.get("id") == key and ok(n))
    if node is not None:
        return node, parent
    kl = key.strip().lower()
    return _find_node(items, lambda n: n.get("name", "").strip().lower() == kl and ok(n))


def _tree_view(items) -> list:
    """A compact, id-bearing view of the folder/endpoint tree for discovery."""
    out = []
    for n in items or []:
        if not isinstance(n, dict):
            continue
        if n.get("type") == "folder":
            out.append({"id": n.get("id"), "name": n.get("name"), "type": "folder",
                        "items": _tree_view(n.get("items", []))})
        else:
            out.append({"id": n.get("id"), "name": n.get("name"), "type": "request",
                        "method": n.get("method"), "url": n.get("url")})
    return out


def _insert_into_folder(items: list, folder_id: str, node: dict) -> bool:
    """Append `node` into the folder with `folder_id` (recursive). Returns True
    if placed."""
    for n in items or []:
        if isinstance(n, dict) and n.get("type") == "folder":
            if n.get("id") == folder_id:
                n.setdefault("items", []).append(node)
                return True
            if _insert_into_folder(n.get("items", []), folder_id, node):
                return True
    return False


# --------------------------------------------------------------------------- #
# Read
# --------------------------------------------------------------------------- #
@mcp.tool()
@_locked
def list_projects() -> list[dict]:
    """List all Beacon projects with their id, name, and active environment."""
    _reload()
    out = []
    for p in store.projects:
        env = next((e for e in p.get("environments", [])
                    if e.get("id") == p.get("current_environment_id")), None)
        out.append({
            "id": p.get("id"),
            "name": p.get("name"),
            "active": p.get("id") == store.current_project_id,
            "base_url": (env or {}).get("base_url", ""),
        })
    return out


@mcp.tool()
@_locked
def list_endpoints() -> list[dict]:
    """List every endpoint in the active project in a compact form.

    For large projects, prefer `search_endpoints` to paginate the result.
    """
    _reload()
    return [_endpoint_summary(test) for test in store.current_config.tests]


@mcp.tool()
@_locked
def search_endpoints(query: Optional[str] = None, offset: int = 0, limit: int = 50) -> dict:
    """Search endpoints in the active project without flooding agent context.

    Returns at most `limit` compact records (default 50), plus total/offset and
    whether more results exist. Match is case-insensitive across name, method,
    URL, and id. Use `get_endpoint` for the editable details of one result.
    """
    _reload()
    offset_value, error = _positive_int(offset, "offset", minimum=0, maximum=1_000_000)
    if error:
        return error
    limit_value, error = _positive_int(limit, "limit", minimum=1, maximum=200)
    if error:
        return error
    tests = store.current_config.tests
    if query:
        needle = query.strip().lower()
        tests = [
            test for test in tests
            if needle in " ".join((test.id, test.name, test.method, test.url)).lower()
        ]
    page = tests[offset_value:offset_value + limit_value]
    return {
        "items": [_endpoint_summary(test) for test in page],
        "total": len(tests),
        "offset": offset_value,
        "limit": limit_value,
        "has_more": offset_value + len(page) < len(tests),
    }


@mcp.tool()
@_locked
def get_endpoint(name_or_id: str) -> dict:
    """Inspect one endpoint's editable definition and preflight diagnostics.

    Literal values of authorization, cookie, and API-key headers are redacted.
    Variable references such as `Bearer {{access_token}}` remain visible.
    """
    _reload()
    test = _find_test(name_or_id)
    if not test:
        return _error("endpoint_not_found", f"Endpoint not found: {name_or_id}")
    sensitive = {"authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "api-key"}
    headers = {
        key: value if "{{" in str(value) or key.lower() not in sensitive else "[REDACTED]"
        for key, value in test.headers.items()
    }
    resolved_url = _resolved_target(store.current_config.base_url, test.url)
    unresolved = _unresolved_variables(test)
    return {
        "endpoint": {
            **_endpoint_summary(test),
            "headers": headers,
            "payload": test.payload,
            "payload_type": test.payload_type,
            "extractors": test.extractors,
            "assertions": test.assertions,
            "run_config": test.run_config,
        },
        "preflight": {
            "resolved_url": resolved_url,
            "valid_http_url": resolved_url.startswith(("http://", "https://")),
            "unresolved_variables": unresolved,
            "ready": resolved_url.startswith(("http://", "https://")) and not unresolved,
        },
    }


@mcp.tool()
@_locked
def get_config() -> dict:
    """Return the active project's base_url, variable names, and endpoint count.
    Variable *values* are omitted — they can hold secrets/tokens."""
    _reload()
    cfg = store.current_config
    return {
        "base_url": cfg.base_url,
        "variables": sorted(cfg.variables.keys()),
        "endpoint_count": len(cfg.tests),
    }


# --------------------------------------------------------------------------- #
# Manage
# --------------------------------------------------------------------------- #
@mcp.tool()
@_locked
def create_endpoint(
    name: str,
    url: str,
    method: str = "GET",
    headers: Optional[dict] = None,
    payload: Optional[Any] = None,
    payload_type: str = "json",
    target_type: str = "api",
    folder_id: Optional[str] = None,
) -> dict:
    """Create an endpoint in the active project. `url` may be relative to the
    project base_url. Optionally place it inside a folder by `folder_id`.
    Values may use {{variable}} templating. Set `target_type="web"` for an
    HTML page load target; web targets should normally use GET and an absolute
    http(s) URL."""
    _reload()
    if not str(name or "").strip():
        return _error("invalid_argument", "name must not be empty.", field="name")
    if not str(url or "").strip():
        return _error("invalid_argument", "url must not be empty.", field="url")
    normalized_target = str(target_type or "api").lower()
    if normalized_target not in {"api", "web"}:
        return _error("invalid_argument", "target_type must be 'api' or 'web'.", field="target_type")
    normalized_payload_type = str(payload_type or "json").lower()
    if normalized_payload_type not in {"json", "form", "multipart", "raw"}:
        return _error(
            "invalid_argument", "payload_type must be json, form, multipart, or raw.",
            field="payload_type",
        )
    proj = _active_project()
    if not proj:
        return _error("project_not_found", "No active project.")
    target_folder = None
    if folder_id:
        target_folder, _ = _resolve_node(proj.get("items", []), folder_id, kind="folder")
        if not target_folder:
            return _error("folder_not_found", f"Folder not found: {folder_id}")
    test = EndpointTest(
        None, name.strip(), url.strip(), method, headers or {},
        {} if payload is None else payload, normalized_payload_type,
        target_type=normalized_target,
    )
    node = {**test.to_dict(), "type": "request"}
    if target_folder is not None:
        target_folder.setdefault("items", []).append(node)
        store.sync_current_config()
    else:
        store.current_config.tests.append(test)
    store.save()
    return {"ok": True, **_endpoint_summary(test), "folder_id": folder_id}


@mcp.tool()
@_locked
def delete_endpoint(name_or_id: str) -> dict:
    """Delete an endpoint from the active project by id or name."""
    _reload()
    test = _find_test(name_or_id)
    if not test:
        return {"error": f"Endpoint not found: {name_or_id}"}
    store.current_config.tests = [t for t in store.current_config.tests if t.id != test.id]
    store.save()
    return {"deleted": _endpoint_summary(test)}


@mcp.tool()
@_locked
def create_project(name: str, base_url: str = "", switch: bool = True) -> dict:
    """Create a new Beacon project. Optionally set a `base_url` (relative
    endpoint URLs join onto it) and, by default, make it the active project so
    subsequent create_endpoint / create_folder calls land inside it."""
    _reload()
    pid = str(uuid.uuid4())
    env_id = str(uuid.uuid4())
    project = {
        "id": pid,
        "name": name or f"Project {len(store.projects) + 1}",
        "environments": [{"id": env_id, "name": "Local", "base_url": base_url, "variables": {}}],
        "current_environment_id": env_id,
        "items": [],
    }
    store.projects.append(project)
    if switch:
        store.current_project_id = pid
    store.sync_current_config()
    store.save()
    return {"id": pid, "name": project["name"], "active": store.current_project_id == pid}


@mcp.tool()
@_locked
def switch_project(name_or_id: str) -> dict:
    """Make a project active (by id or name) so subsequent operations target it."""
    _reload()
    lowered = name_or_id.strip().lower()
    project = next(
        (p for p in store.projects
         if p.get("id") == name_or_id or str(p.get("name", "")).strip().lower() == lowered),
        None,
    )
    if not project:
        return {"error": f"Project not found: {name_or_id}"}
    store.current_project_id = project["id"]
    store.sync_current_config()
    store.save()
    return {"id": project["id"], "name": project.get("name"), "active": True}


@mcp.tool()
@_locked
def create_folder(name: str) -> dict:
    """Create a top-level folder in the active project."""
    _reload()
    proj = _active_project()
    if not proj:
        return {"error": "No active project"}
    folder = {"id": str(uuid.uuid4()), "name": name, "type": "folder", "items": []}
    proj.setdefault("items", []).append(folder)
    store.sync_current_config()
    store.save()
    return {"id": folder["id"], "name": name}


# --------------------------------------------------------------------------- #
# Run
# --------------------------------------------------------------------------- #
@mcp.tool()
def run_endpoint(
    name_or_id: str,
    concurrency: int = 1,
    count: int = 10,
    delay: float = 0.1,
    use_min_delay: bool = False,
) -> dict:
    """Fire an endpoint `count` times (optionally concurrently) and return the
    final stats: attempts, success, rate_limited, errors, latency percentiles,
    status-code mix, throughput, and when the target first rate-limited.

    WARNING: this sends real HTTP requests to the endpoint's target."""
    _reload()
    concurrency_value, error = _positive_int(concurrency, "concurrency", maximum=1_000)
    if error:
        return error
    count_value, error = _positive_int(count, "count", maximum=100_000)
    if error:
        return error
    delay_value, error = _non_negative_float(delay, "delay")
    if error:
        return error
    test = _find_test(name_or_id)
    if not test:
        return _error("endpoint_not_found", f"Endpoint not found: {name_or_id}")

    _prepare_history()
    history_id = str(uuid.uuid4())
    project = _history_project()
    history_payload = {
        "mode": "load",
        "concurrency": concurrency_value,
        "max_requests": count_value,
        "delay": 0.001 if use_min_delay else delay_value,
        "use_min_delay": bool(use_min_delay),
    }
    store.history.start(
        RunStart(
            id=history_id,
            workspace_id=store.history.workspace_id or "local",
            project_id=project.get("id") or "unknown",
            project_name=project.get("name") or "Unknown project",
            origin_device_id=store.history.origin_device_id or "local",
            source_type="endpoint",
            target_id=test.id,
            target_name=test.name,
            mode="load",
            config_snapshot=sanitize_run_config(history_payload, test),
        ),
        [RunStepStart(0, test.id, test.name, test.method, test.url)],
    )
    snapshot: dict = {}

    def on_stats(s: dict) -> None:
        snapshot.clear()
        snapshot.update(s)
        store.history.record_stats(history_id, 0, s)

    def on_response(response: dict) -> None:
        store.history.record_response(history_id, 0, response)

    tester = APITester(
        test,
        store.current_config,
        concurrency=concurrency_value,
        delay=0.001 if use_min_delay else delay_value,
        max_requests=count_value,
        stats_callback=on_stats,
        response_callback=on_response,
        stop_flag={"stop": False},
    )
    outcome = "completed"
    try:
        results = tester.run()
    except Exception:
        outcome = "failed"
        raise
    finally:
        store.history.finish_step(history_id, 0, outcome)
        store.history.finish_run(history_id, outcome)
    return {
        "history_id": history_id,
        "endpoint": test.name,
        "target": _resolved_target(store.current_config.base_url, test.url),
        "config": {
            "concurrency": concurrency_value, "count": count_value,
            "delay": 0.001 if use_min_delay else delay_value,
        },
        "stats": snapshot or results,
    }


@mcp.tool()
@_locked
def send_request(
    name_or_id: str,
    retries: int = 0,
    retry_delay: float = 0.0,
    max_body_chars: int = 20_000,
) -> dict:
    """Send an endpoint ONCE and return the full response for inspection:
    status, reason, time_ms, size_bytes, content_type, headers, body (capped),
    parsed json, `extracted` (names of variables refreshed by extractors on a
    2xx), and `assertions`/`passed` (the endpoint's pass/fail rules evaluated
    against the response). Fires one real HTTP request. `retries` re-sends while
    the request errors or returns a non-2xx (waiting `retry_delay`s between).

    Use this to debug an endpoint or to prime a token (e.g. send 'Login' so
    {{access_token}} is refreshed) before other calls."""
    _reload()
    retries_value, error = _positive_int(retries, "retries", minimum=0, maximum=10)
    if error:
        return error
    retry_delay_value, error = _non_negative_float(retry_delay, "retry_delay", maximum=60)
    if error:
        return error
    body_limit, error = _positive_int(max_body_chars, "max_body_chars", minimum=0, maximum=100_000)
    if error:
        return error
    test = _find_test(name_or_id)
    if not test:
        return _error("endpoint_not_found", f"Endpoint not found: {name_or_id}")
    result = APITester(test, store.current_config).send_once(
        max_body=body_limit, retries=retries_value, retry_delay=retry_delay_value,
    )
    if result.get("extracted"):
        store.save()  # persist tokens refreshed by extractors
    return result


@mcp.tool()
@_locked
def run_scenario(name_or_ids: list, continue_on_error: bool = False,
                 retries: int = 0, retry_delay: float = 0.0) -> dict:
    """Run a sequence of endpoints in order as one flow (e.g. ['Login', 'Get
    Profile']). Each is sent once; variables refreshed by extractors carry into
    later steps, so a login primes {{access_token}} for the calls after it.
    Stops at the first failed step unless continue_on_error. Returns a compact
    per-step summary (status, time_ms, passed, extracted) — not full bodies."""
    _reload()
    if not isinstance(name_or_ids, list) or not name_or_ids:
        return _error("invalid_argument", "name_or_ids must contain at least one endpoint.", field="name_or_ids")
    if len(name_or_ids) > 100:
        return _error("invalid_argument", "A scenario may contain at most 100 steps.", field="name_or_ids")
    retries_value, error = _positive_int(retries, "retries", minimum=0, maximum=10)
    if error:
        return error
    retry_delay_value, error = _non_negative_float(retry_delay, "retry_delay", maximum=60)
    if error:
        return error
    _prepare_history()
    history_id = str(uuid.uuid4())
    resolved = [(_find_test(str(ref)), ref) for ref in (name_or_ids or [])]
    project = _history_project()
    valid_steps = [
        RunStepStart(index, test.id, test.name, test.method, test.url)
        for index, (test, _) in enumerate(resolved)
        if test is not None
    ]
    store.history.start(
        RunStart(
            id=history_id,
            workspace_id=store.history.workspace_id or "local",
            project_id=project.get("id") or "unknown",
            project_name=project.get("name") or "Unknown project",
            origin_device_id=store.history.origin_device_id or "local",
            source_type="scenario",
            target_id=None,
            target_name=f"MCP scenario · {len(name_or_ids or [])} steps",
            mode="scenario",
            config_snapshot={"mode": "scenario"},
        ),
        valid_steps,
    )
    steps = []
    changed = False
    for step_index, (test, ref) in enumerate(resolved):
        if not test:
            steps.append({"ref": ref, "ok": False, "success": False, "error": "Endpoint not found"})
            if not continue_on_error:
                break
            continue
        result = APITester(test, store.current_config).send_once(
            retries=retries_value, retry_delay=retry_delay_value,
        )
        store.history.record_response(history_id, step_index, result)
        if result.get("extracted"):
            changed = True
        # A step succeeds when it got a response, no assertion failed, status < 400.
        success = bool(result.get("ok")) and result.get("passed") is not False and \
            (result.get("status") is None or result.get("status") < 400)
        steps.append({
            "name": test.name, "ok": bool(result.get("ok")), "success": success,
            "status": result.get("status"), "time_ms": result.get("time_ms"),
            "passed": result.get("passed"), "extracted": result.get("extracted") or [],
            "attempts": result.get("attempts"),
            **({"error": result.get("error")} if not result.get("ok") else {}),
        })
        attempts = int(result.get("attempts") or 1)
        store.history.record_stats(history_id, step_index, {
            "attempts": attempts,
            "success": attempts if success else 0,
            "rate_limited": attempts if result.get("status") == 429 else 0,
            "errors": 0 if success else attempts,
        })
        store.history.finish_step(
            history_id, step_index, "completed" if success else "failed"
        )
        if not success and not continue_on_error:
            break
    if changed:
        store.save()
    passed = bool(steps) and all(s.get("success") for s in steps)
    store.history.finish_run(history_id, "completed" if passed else "failed")
    return {"history_id": history_id, "steps": steps, "passed": passed,
            "completed": len(steps), "total": len(name_or_ids or [])}


@mcp.tool()
@_locked
def import_collection(data: dict | list, into_folder: Optional[str] = None) -> dict:
    """Import requests using the same converter as Beacon Desktop.

    Supported formats: Beacon export, Postman v2, OpenAPI 3, Swagger 2,
    Insomnia, HAR, and legacy Beacon config. For YAML/JSON text pass
    `{"content": "...", "filename": "openapi.yaml"}`. `into_folder` may be
    an existing folder id/name; when omitted, a folder named after the source
    is created.
    """
    _reload()
    proj = _active_project()
    if not proj:
        return _error("project_not_found", "No active project.")
    source = data
    if isinstance(data, list):
        source = {"name": "Imported Collection", "base_url": "", "variables": {}, "tests": data}
    elif isinstance(data, dict) and data.get("url") and not any(
        key in data for key in ("items", "tests", "item", "paths", "log", "resources", "content")
    ):
        source = {"name": "Imported Request", "base_url": "", "variables": {}, "tests": [data]}
    try:
        normalized = normalize_project(source)
    except ProjectImportError as error:
        return _error("import_invalid", str(error))

    try:
        imported_items, _ = materialize_items(normalized["project"]["items"])
    except ProjectImportError as error:
        return _error("import_invalid", str(error))
    target_folder = None
    if into_folder:
        target_folder, _ = _resolve_node(proj.get("items", []), into_folder, kind="folder")
        if not target_folder:
            return _error("folder_not_found", f"Folder not found: {into_folder}")
    else:
        target_folder = {
            "id": str(uuid.uuid4()),
            "name": normalized["project"]["name"],
            "type": "folder",
            "items": [],
        }
        proj.setdefault("items", []).append(target_folder)
    target_folder.setdefault("items", []).extend(imported_items)
    store.sync_current_config()
    store.save()
    return {
        "ok": True,
        "format": normalized["format"],
        "format_label": normalized["format_label"],
        "imported": normalized["summary"]["endpoints"],
        "folders": normalized["summary"]["folders"],
        "into_folder": target_folder.get("name"),
        "folder_id": target_folder.get("id"),
        "warnings": normalized["warnings"],
    }


@mcp.tool()
@_locked
def add_endpoint_from_curl(curl: str, name: Optional[str] = None) -> dict:
    """Create an endpoint from a `curl` command string. Parses -X/--request,
    -H/--header, and -d/--data*/--data-raw. Handy when an agent already has a
    curl snippet."""
    _reload()
    tokens = shlex.split(curl.replace("\\\n", " ").strip())
    method: Optional[str] = None
    url: Optional[str] = None
    headers: dict = {}
    data: Optional[str] = None

    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok == "curl":
            i += 1
            continue
        if tok in ("-X", "--request") and i + 1 < len(tokens):
            method = tokens[i + 1]; i += 2; continue
        if tok in ("-H", "--header") and i + 1 < len(tokens):
            h = tokens[i + 1]
            if ":" in h:
                k, v = h.split(":", 1)
                headers[k.strip()] = v.strip()
            i += 2; continue
        if tok in ("-d", "--data", "--data-raw", "--data-binary", "--data-ascii") and i + 1 < len(tokens):
            data = tokens[i + 1]; i += 2; continue
        if tok.startswith("http://") or tok.startswith("https://"):
            url = tok; i += 1; continue
        i += 1

    if not url:
        return {"error": "No URL found in the curl command."}
    if method is None:
        method = "POST" if data else "GET"
    payload: Any = {}
    payload_type = "json"
    if data:
        try:
            payload = json.loads(data)
        except Exception:
            payload = data
            payload_type = "raw"

    test = EndpointTest(None, name or url, url, method, headers, payload, payload_type)
    store.current_config.tests.append(test)
    store.save()
    return _endpoint_summary(test)


# --------------------------------------------------------------------------- #
# Organize (edit / move / rename / delete tree nodes)
# --------------------------------------------------------------------------- #
@mcp.tool()
@_locked
def get_tree() -> dict:
    """Return the active project's full folder/endpoint tree with ids, names and
    nesting. Use this to discover folder ids for `create_endpoint(folder_id=...)`
    and `move_item(into_folder=...)`, or to inspect ordering."""
    _reload()
    proj = _active_project()
    if not proj:
        return {"error": "No active project"}
    return {"project": proj.get("name"), "items": _tree_view(proj.get("items", []))}


@mcp.tool()
@_locked
def update_endpoint(
    name_or_id: str,
    name: Optional[str] = None,
    url: Optional[str] = None,
    method: Optional[str] = None,
    headers: Optional[dict] = None,
    payload: Optional[Any] = None,
    payload_type: Optional[str] = None,
    extractors: Optional[dict] = None,
    target_type: Optional[str] = None,
) -> dict:
    """Update fields of an existing endpoint. Only the arguments you pass are
    changed; the id and the endpoint's place in the folder tree are preserved.
    Values may use {{variable}} templating."""
    _reload()
    test = _find_test(name_or_id)
    if not test:
        return {"error": f"Endpoint not found: {name_or_id}"}
    if name is not None:
        test.name = name
    if url is not None:
        test.url = url
    if method is not None:
        test.method = method.upper()
    if headers is not None:
        test.headers = headers
    if payload is not None:
        test.payload = payload
    if payload_type is not None:
        normalized_payload_type = str(payload_type).lower()
        if normalized_payload_type not in {"json", "form", "multipart", "raw"}:
            return _error(
                "invalid_argument", "payload_type must be json, form, multipart, or raw.",
                field="payload_type",
            )
        test.payload_type = normalized_payload_type
    if extractors is not None:
        test.extractors = extractors
    if target_type is not None:
        normalized = str(target_type).lower()
        if normalized not in {"api", "web"}:
            return _error(
                "invalid_argument", "target_type must be 'api' or 'web'.", field="target_type"
            )
        test.target_type = normalized
    store.save()  # reconcile updates the request node in place, by id
    return _endpoint_summary(test)


@mcp.tool()
@_locked
def duplicate_endpoint(name_or_id: str) -> dict:
    """Duplicate an endpoint (new id, name suffixed '(copy)'). The copy is added
    at the project root; use `move_item` to place it in a folder."""
    _reload()
    test = _find_test(name_or_id)
    if not test:
        return {"error": f"Endpoint not found: {name_or_id}"}
    copy = EndpointTest(
        None,
        f"{test.name} (copy)",
        test.url,
        test.method,
        dict(test.headers),
        copy.deepcopy(test.payload),
        test.payload_type,
        dict(getattr(test, "extractors", {}) or {}),
        dict(test.run_config) if getattr(test, "run_config", None) else None,
        list(getattr(test, "assertions", []) or []),
        getattr(test, "target_type", "api"),
        dict(test.auth) if getattr(test, "auth", None) else None,
    )
    copy.inherited_auth = list(getattr(test, "inherited_auth", []))
    store.current_config.tests.append(copy)
    store.save()
    return _endpoint_summary(copy)


@mcp.tool()
@_locked
def rename_folder(name_or_id: str, new_name: str) -> dict:
    """Rename a folder in the active project."""
    _reload()
    proj = _active_project()
    if not proj:
        return {"error": "No active project"}
    node, _ = _resolve_node(proj.get("items", []), name_or_id, kind="folder")
    if not node:
        return {"error": f"Folder not found: {name_or_id}"}
    old = node.get("name")
    node["name"] = new_name
    store.sync_current_config()
    store.save()
    return {"renamed": old, "to": new_name, "id": node.get("id")}


@mcp.tool()
@_locked
def delete_folder(name_or_id: str, recursive: bool = False) -> dict:
    """Delete a folder. By default only an empty folder is removed; pass
    recursive=true to also delete every endpoint/subfolder inside it."""
    _reload()
    proj = _active_project()
    if not proj:
        return {"error": "No active project"}
    node, parent = _resolve_node(proj.get("items", []), name_or_id, kind="folder")
    if not node:
        return {"error": f"Folder not found: {name_or_id}"}
    child_count = len(node.get("items", []))
    if child_count and not recursive:
        return {"error": f"Folder '{node.get('name')}' is not empty "
                         f"({child_count} items). Pass recursive=true to delete its contents too."}
    parent.remove(node)
    store.sync_current_config()
    store.save()
    return {"deleted_folder": node.get("name"), "removed_items": child_count}


@mcp.tool()
@_locked
def move_item(name_or_id: str, into_folder: Optional[str] = None,
              position: Optional[int] = None) -> dict:
    """Move an endpoint or folder, and/or reorder it.

    - `into_folder`: id/name of the target folder, or omit/null to move to the
      project root.
    - `position`: 0-based index within the target list. Omit to append.

    Reorder within the same container by passing that container as `into_folder`
    (or omit it for root) together with the desired `position`."""
    _reload()
    proj = _active_project()
    if not proj:
        return {"error": "No active project"}
    items = proj.setdefault("items", [])
    node, parent = _resolve_node(items, name_or_id)
    if not node:
        return {"error": f"Item not found: {name_or_id}"}

    if into_folder:
        folder, _ = _resolve_node(items, into_folder, kind="folder")
        if not folder:
            return {"error": f"Target folder not found: {into_folder}"}
        if folder is node:
            return {"error": "Cannot move a folder into itself"}
        if node.get("type") == "folder" and \
                _resolve_node(node.get("items", []), folder.get("id"))[0] is not None:
            return {"error": "Cannot move a folder into its own descendant"}
        target = folder.setdefault("items", [])
    else:
        target = items

    parent.remove(node)
    if position is None or position < 0 or position > len(target):
        target.append(node)
    else:
        target.insert(position, node)
    store.sync_current_config()
    store.save()
    return {"moved": node.get("name"), "into": into_folder or "root",
            "position": target.index(node)}


def main() -> None:
    # BEACON_DATA_DIR is pinned to the shared per-user location by _pin_data_dir()
    # at import time (it MUST run before the store is imported), so the store is
    # already bound to the right file here.
    store.load()
    transport = os.getenv("BEACON_MCP_TRANSPORT", "stdio").lower()
    try:
        if transport in ("http", "streamable-http", "sse"):
            mcp.run(transport="streamable-http" if transport != "sse" else "sse")
        else:
            mcp.run()
    finally:
        # FastMCP closes stdin on an orderly stdio disconnect. PyInstaller's
        # one-file cleanup then probes the already-closed stream and emits a
        # misleading ValueError despite exiting 0. Silence only that post-run
        # frozen cleanup; runtime/tool errors still use stderr normally.
        if getattr(sys, "frozen", False):
            sys.stderr = open(os.devnull, "w", encoding="utf-8")


if __name__ == "__main__":
    main()
