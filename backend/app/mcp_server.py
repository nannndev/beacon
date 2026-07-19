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
import json
import functools
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


def _endpoint_summary(t: EndpointTest) -> dict:
    return {"id": t.id, "name": t.name, "method": t.method, "url": t.url}


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
    """List every endpoint in the active project (flattened across folders)."""
    _reload()
    return [_endpoint_summary(t) for t in store.current_config.tests]


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
    payload: Optional[dict] = None,
    payload_type: str = "json",
    folder_id: Optional[str] = None,
) -> dict:
    """Create an endpoint in the active project. `url` may be relative to the
    project base_url. Optionally place it inside a folder by `folder_id`.
    Values may use {{variable}} templating."""
    _reload()
    test = EndpointTest(None, name, url, method, headers or {}, payload or {}, payload_type)
    proj = _active_project()
    node = {**test.to_dict(), "type": "request"}
    if folder_id and proj and _insert_into_folder(proj.get("items", []), folder_id, node):
        store.sync_current_config()
    else:
        store.current_config.tests.append(test)
    store.save()
    return _endpoint_summary(test)


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
    test = _find_test(name_or_id)
    if not test:
        return {"error": f"Endpoint not found: {name_or_id}"}

    _prepare_history()
    history_id = str(uuid.uuid4())
    project = _history_project()
    history_payload = {
        "mode": "load",
        "concurrency": max(1, int(concurrency)),
        "max_requests": int(count),
        "delay": 0.001 if use_min_delay else float(delay),
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
        concurrency=max(1, int(concurrency)),
        delay=0.001 if use_min_delay else float(delay),
        max_requests=int(count),
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
        "config": {"concurrency": concurrency, "count": count, "delay": delay},
        "stats": snapshot or results,
    }


@mcp.tool()
@_locked
def send_request(name_or_id: str, retries: int = 0, retry_delay: float = 0.0) -> dict:
    """Send an endpoint ONCE and return the full response for inspection:
    status, reason, time_ms, size_bytes, content_type, headers, body (capped),
    parsed json, `extracted` (names of variables refreshed by extractors on a
    2xx), and `assertions`/`passed` (the endpoint's pass/fail rules evaluated
    against the response). Fires one real HTTP request. `retries` re-sends while
    the request errors or returns a non-2xx (waiting `retry_delay`s between).

    Use this to debug an endpoint or to prime a token (e.g. send 'Login' so
    {{access_token}} is refreshed) before other calls."""
    _reload()
    test = _find_test(name_or_id)
    if not test:
        return {"error": f"Endpoint not found: {name_or_id}"}
    result = APITester(test, store.current_config).send_once(
        retries=max(0, int(retries)), retry_delay=float(retry_delay))
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
            retries=max(0, int(retries)), retry_delay=float(retry_delay))
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


# --------------------------------------------------------------------------- #
# Flexible import
# --------------------------------------------------------------------------- #
def _detect_and_normalize(data: Any) -> list[dict]:
    """Turn many shapes into a flat list of endpoint dicts. Deliberately NOT
    Postman-only:
      - Postman collection v2.1  ({info, item: [...]})
      - Beacon project export     ({items: [...]} or {tests: [...]})
      - a raw list of request dicts
      - a single request dict
    """
    # Postman v2.1
    if isinstance(data, dict) and "item" in data and "info" in data:
        out: list[dict] = []

        def walk(nodes: list) -> None:
            for node in nodes or []:
                if "item" in node:  # folder
                    walk(node.get("item", []))
                elif "request" in node:
                    req = node["request"]
                    raw_url = req.get("url", "")
                    url = raw_url.get("raw", "") if isinstance(raw_url, dict) else raw_url
                    headers = {h["key"]: h.get("value", "")
                               for h in req.get("header", []) if h.get("key")}
                    body = req.get("body", {}).get("raw", "")
                    try:
                        payload = json.loads(body) if body else {}
                    except Exception:
                        payload = {}
                    out.append({
                        "name": node.get("name", url),
                        "url": url,
                        "method": req.get("method", "GET"),
                        "headers": headers,
                        "payload": payload,
                    })
        walk(data.get("item", []))
        return out

    # Beacon project / items tree / tests
    if isinstance(data, dict) and ("items" in data or "tests" in data):
        flat = store._flatten_items(data.get("items", [])) if data.get("items") else data.get("tests", [])
        return [dict(t) for t in flat]

    # raw list or single dict
    if isinstance(data, list):
        return [dict(t) for t in data]
    if isinstance(data, dict) and data.get("url"):
        return [dict(data)]
    return []


@mcp.tool()
@_locked
def import_collection(data: dict | list, into_folder: Optional[str] = None) -> dict:
    """Import endpoints from many formats (auto-detected): a Postman v2.1
    collection, a Beacon project/items export, a raw list of request objects,
    or a single request object. Adds them to the active project."""
    _reload()
    endpoints = _detect_and_normalize(data)
    if not endpoints:
        return {"error": "Could not recognize any endpoints in the provided data."}

    proj = _active_project()
    folder_name = into_folder or "Imported"
    folder = {"id": str(uuid.uuid4()), "name": folder_name, "type": "folder", "items": []}
    for ep in endpoints:
        node = {
            "id": str(uuid.uuid4()),
            "name": ep.get("name") or ep.get("url", "request"),
            "url": ep.get("url", ""),
            "method": (ep.get("method") or "GET").upper(),
            "headers": ep.get("headers", {}),
            "payload": ep.get("payload", {}),
            "payload_type": ep.get("payload_type", "json"),
            "extractors": ep.get("extractors", {}),
            "run_config": ep.get("run_config"),
            "type": "request",
        }
        folder["items"].append(node)

    if proj is not None:
        proj.setdefault("items", []).append(folder)
        store.sync_current_config()
        store.save()
    return {"imported": len(endpoints), "folder": folder_name}


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
    payload: dict = {}
    if data:
        try:
            payload = json.loads(data)
        except Exception:
            payload = {"raw": data}

    test = EndpointTest(None, name or url, url, method, headers, payload)
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
    payload: Optional[dict] = None,
    payload_type: Optional[str] = None,
    extractors: Optional[dict] = None,
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
        test.payload_type = payload_type
    if extractors is not None:
        test.extractors = extractors
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
        dict(test.payload),
        test.payload_type,
        dict(getattr(test, "extractors", {}) or {}),
        dict(test.run_config) if getattr(test, "run_config", None) else None,
    )
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
    if transport in ("http", "streamable-http", "sse"):
        mcp.run(transport="streamable-http" if transport != "sse" else "sse")
    else:
        mcp.run()


if __name__ == "__main__":
    main()
