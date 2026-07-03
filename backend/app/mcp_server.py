"""Beacon MCP server.

Exposes Beacon's API-testing engine to MCP-capable agents (Claude Desktop,
Claude Code, etc.) as tools. It reuses the exact same core engine and JSON
store as the FastAPI backend — no duplicated request logic.

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
import shlex
import uuid
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP

from .core.tester import APITester, EndpointTest
from .state import store

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
def list_endpoints() -> list[dict]:
    """List every endpoint in the active project (flattened across folders)."""
    _reload()
    return [_endpoint_summary(t) for t in store.current_config.tests]


@mcp.tool()
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

    snapshot: dict = {}

    def on_stats(s: dict) -> None:
        snapshot.clear()
        snapshot.update(s)

    tester = APITester(
        test,
        store.current_config,
        concurrency=max(1, int(concurrency)),
        delay=0.001 if use_min_delay else float(delay),
        max_requests=int(count),
        stats_callback=on_stats,
        stop_flag={"stop": False},
    )
    results = tester.run()
    return {
        "endpoint": test.name,
        "target": f"{store.current_config.base_url}{test.url}",
        "config": {"concurrency": concurrency, "count": count, "delay": delay},
        "stats": snapshot or results,
    }


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


def main() -> None:
    store.load()
    transport = os.getenv("BEACON_MCP_TRANSPORT", "stdio").lower()
    if transport in ("http", "streamable-http", "sse"):
        mcp.run(transport="streamable-http" if transport != "sse" else "sse")
    else:
        mcp.run()


if __name__ == "__main__":
    main()
