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

**Inspect**
- `list_projects`, `list_endpoints`, `get_config` — quick overview.
- `get_tree()` — full folder/endpoint tree with **ids** and nesting. Call this
  to discover `folder_id`s for `create_endpoint`/`move_item`.

**Create**
- `create_endpoint(name, url, method, headers, payload, folder_id?)` — add one.
  `url` may be relative to the project `base_url`. Values may use
  `{{variable}}` (static config vars or generators like `{{random_email}}`,
  `{{uuid}}`, `{{random_int:1:100}}`).
- `create_folder(name)` — new top-level folder.
- `add_endpoint_from_curl(curl, name?)` — build an endpoint from a curl string.
- `import_collection(data, into_folder?)` — auto-detects Postman v2.1, a Beacon
  export, a raw list of requests, or a single request. Not Postman-only.

**Edit / organize**
- `update_endpoint(name_or_id, name?, url?, method?, headers?, payload?, payload_type?, extractors?)`
  — change only the fields you pass; id and tree position preserved.
- `duplicate_endpoint(name_or_id)` — copy (new id, name +" (copy)").
- `move_item(name_or_id, into_folder?, position?)` — move an endpoint OR folder
  into a folder (or root if omitted) and/or **reorder** it (`position` is a
  0-based index; reorder in place by passing the same container).
- `rename_folder(name_or_id, new_name)`.
- `delete_endpoint(name_or_id)`; `delete_folder(name_or_id, recursive?)` —
  folder delete refuses a non-empty folder unless `recursive=true`.

**Send / inspect**
- `send_request(name_or_id)` — fire the endpoint **once** and get the full
  response: status, reason, time_ms, size_bytes, content_type, headers, body
  (capped), parsed json, and `extracted` (names of variables the extractors
  refreshed on a 2xx). Use it to debug a response or to prime a token (send
  "Login" so `{{access_token}}` is fresh) before other calls.

**Run**
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

### Register the MCP server

Use the **MCP** panel in the Beacon desktop app (best for bundled binary, no Python needed).

Or manually:

```bash
claude mcp add beacon -- python -m app.mcp_server   # Claude Code
```

For Cursor, Windsurf, Cline, Continue, etc. → use the config snippet from the Beacon **MCP** panel (it gives the correct path to the standalone binary).

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
