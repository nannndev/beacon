---
name: beacon-api-tester
description: Drive Beacon from an agent to discover, create, import, inspect, send, chain, load-test, and organize API or web endpoints. Supports Beacon/Postman/OpenAPI/Swagger/Insomnia/HAR imports, response assertions/extractors, and authorized rate-limit testing. Prefer the Beacon MCP server; fall back to REST.
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
- `list_projects`, `list_endpoints`, `get_config` — quick overview. Use
  `list_endpoints` only when the project is known to be small.
- `search_endpoints(query?, offset?, limit?)` — preferred discovery for larger
  projects. It returns compact results plus `total` and `has_more`; paginate
  instead of filling the context window with every endpoint.
- `get_endpoint(name_or_id)` — inspect one editable definition plus preflight:
  resolved URL, missing variables, and `ready`. Sensitive literal auth/cookie/
  API-key headers are redacted; `{{variable}}` references remain visible.
- `get_tree()` — full folder/endpoint tree with **ids** and nesting. Call this
  to discover `folder_id`s for `create_endpoint`/`move_item`.

**Create**
- `create_endpoint(name, url, method, headers, payload, target_type?, folder_id?)`
  — add an API request or a `web` HTML document load target.
  `url` may be relative to the project `base_url`. Values may use
  `{{variable}}` (static config vars or generators like `{{random_email}}`,
  `{{uuid}}`, `{{random_int:1:100}}`).
- `create_folder(name)` — new top-level folder.
- `add_endpoint_from_curl(curl, name?)` — build an endpoint from a curl string.
- `import_collection(data, into_folder?)` — uses Beacon's production importer
  for Beacon exports, Postman v2, OpenAPI 3, Swagger 2, Insomnia, HAR, legacy
  config, raw request lists, and single requests. For JSON/YAML text use
  `{"content":"...", "filename":"openapi.yaml"}`. `into_folder` must resolve
  to an existing folder id/name; omit it to create a source-named folder.

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
- `send_request(name_or_id, retries?, retry_delay?, max_body_chars?)` — fire the endpoint **once** and get the full
  response: status, reason, time_ms, size_bytes, content_type, headers, body
  (capped), parsed json, and `extracted` (names of variables the extractors
  refreshed on a 2xx). The MCP body defaults to 20,000 characters to protect
  agent context (`max_body_chars` may be 0–100,000). Use it to debug a response or to prime a token (send
  "Login" so `{{access_token}}` is fresh) before other calls.

**Run**
- `run_endpoint(name_or_id, concurrency, count, delay, use_min_delay?)` —
  **fires real HTTP** and returns final stats (counts, latency p50/p95/p99,
  status-code mix, rps, first-rate-limited-at). Confirm the target is authorized
  before running with high `count`/`concurrency`.
- `run_scenario(name_or_ids, continue_on_error?, retries?, retry_delay?)` — run
  a list of endpoints **in order** as one flow. Variables refreshed by extractors
  carry into later steps, so ['Login','Get Profile'] primes `{{access_token}}`
  before the profile call. Stops at the first failed step unless
  `continue_on_error`. Returns a compact per-step summary.

Notes:
- `send_request`/`run_endpoint` also honor per-endpoint **assertions**
  (status/time_ms/body_contains/jsonpath/header → `passed`) and `send_request`
  supports `retries`.
- Body types (`payload_type`): `json`, `form` (x-www-form-urlencoded),
  `multipart` (file upload), `raw` (text/XML/GraphQL — set Content-Type header).
- Tool failures keep a readable `error` and expose a stable `error_code` such
  as `invalid_argument`, `endpoint_not_found`, `folder_not_found`, or
  `import_invalid`. Fix the reported field/resource and retry; do not guess.

## Recommended agent workflow

1. Call `list_projects`; switch explicitly when the intended project is not active.
2. Use `search_endpoints`, then `get_endpoint` on the selected result.
3. If preflight says `ready=false`, resolve the listed variable/base URL problem
   before sending traffic.
4. Use `send_request` once to inspect the real response, assertions, and
   extractors. For a login flow, send Login first and confirm `extracted`.
5. Use `run_scenario` for ordered dependent requests.
6. Use `run_endpoint` only after the single request is correct. Start with
   `count=1`, `concurrency=1`; increase gradually and only with authorization.
7. Report the exact target, request count, concurrency, success/error/rate-limit
   totals, and latency percentiles. Never report secret variable values.

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
codex mcp add beacon -- python -m app.mcp_server    # Codex
claude mcp add beacon -- python -m app.mcp_server   # Claude Code
```

For Cursor, Windsurf, Cline, Continue, etc. → use the config snippet from the Beacon **MCP** panel (it gives the correct path to the standalone binary).

## REST fallback (no MCP)

The FastAPI backend (default `http://localhost:8000`) exposes the same surface:

- `GET /projects`, `GET /tests`, `GET /config`
- `POST /tests`, `PUT /tests/{id}`, `DELETE /tests/{id}`, `POST /tests/{id}/duplicate`
- `PUT /projects/{id}` with `{ "items": [...] }` to reorder/move/rename the tree
- `POST /projects/import/preview` then `POST /projects/import` for Beacon,
  Postman, OpenAPI/Swagger, Insomnia, HAR, JSON, or YAML import
- `POST /run` `{ test_id, concurrency, max_requests, delay, use_min_delay }` →
  `{ run_id }`; poll `GET /status/{run_id}`; stop with `POST /stop/{run_id}`

## Safety

- `run_endpoint` / `POST /run` send real traffic. Get explicit authorization for
  the target, and start with small `count`/`concurrency`.
- `tests.json` can contain real tokens — never echo variable *values* back to
  the user or into logs.
