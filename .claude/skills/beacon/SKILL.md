---
name: beacon-api-tester
description: Drive Beacon — the API endpoint tester / load + rate-limit tool — from an agent. Use when asked to list/create/organize API endpoints, run or load-test an endpoint, import a Postman/curl collection, or inspect rate-limit behavior against a target. Prefers the Beacon MCP server; falls back to the REST API.
---

# Driving Beacon

Beacon defines API endpoints (URL, method, headers, payload with `{{variable}}`
templating) and fires them repeatedly / concurrently to watch `attempts`,
`success`, `rate_limited`, `errors`, and latency. Use it only for **authorized**
testing.

## Prefer the MCP server

If the Beacon MCP server is connected, use its tools directly — they reuse the
engine and the same `tests.json` store:

- `list_projects`, `list_endpoints`, `get_config` — inspect what exists.
- `create_endpoint(name, url, method, headers, payload, folder_id?)` — add one.
  `url` may be relative to the project `base_url`. Values may use
  `{{variable}}` (static config vars or generators like `{{random_email}}`,
  `{{uuid}}`, `{{random_int:1:100}}`).
- `create_folder(name)`, `delete_endpoint(name_or_id)` — organize.
- `import_collection(data, into_folder?)` — auto-detects Postman v2.1, a Beacon
  export, a raw list of requests, or a single request. Not Postman-only.
- `add_endpoint_from_curl(curl, name?)` — build an endpoint from a curl string.
- `run_endpoint(name_or_id, concurrency, count, delay, use_min_delay?)` —
  **fires real HTTP** and returns final stats (counts, latency p50/p95/p99,
  status-code mix, rps, first-rate-limited-at). Confirm the target is authorized
  before running with high `count`/`concurrency`.

### Starting the MCP server

```bash
cd backend
python -m app.mcp_server                       # stdio (local)
BEACON_MCP_TRANSPORT=http python -m app.mcp_server   # HTTP/SSE (hostable)
```

Register with Claude Code:

```bash
claude mcp add beacon -- python -m app.mcp_server   # run from backend/
```

## REST fallback (no MCP)

The FastAPI backend (default `http://localhost:8000`) exposes the same surface:

- `GET /projects`, `GET /tests`, `GET /config`
- `POST /tests`, `PUT /tests/{id}`, `DELETE /tests/{id}`, `POST /tests/{id}/duplicate`
- `PUT /projects/{id}` with `{ "items": [...] }` to reorder/move/rename the tree
- `POST /projects/import` for Postman / Beacon-JSON import
- `POST /run` `{ test_id, concurrency, max_requests, delay, use_min_delay }` →
  `{ run_id }`; poll `GET /status/{run_id}`; stop with `POST /stop/{run_id}`

## Safety

- `run_endpoint` / `POST /run` send real traffic. Get explicit authorization for
  the target, and start with small `count`/`concurrency`.
- `tests.json` can contain real tokens — never echo variable *values* back to
  the user or into logs.
