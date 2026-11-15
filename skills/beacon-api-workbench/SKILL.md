---
name: beacon-api-workbench
description: Drive the Beacon API workbench (github.com/nannndev/beacon) from an agent to discover, create, import, organize into folders, send, chain, load-test, and document API or web endpoints. Supports Beacon/Postman/OpenAPI/Swagger/Insomnia/HAR and curl imports, folder trees, response assertions/extractors, capturing live responses as documented examples, and authorized rate-limit testing. Prefer the Beacon MCP server; fall back to REST.
---

# Driving Beacon

Beacon defines API endpoints (URL, method, headers, payload with `{{variable}}`
templating) and fires them repeatedly / concurrently to watch `attempts`,
`success`, `rate_limited`, `errors`, and latency. Use it only for **authorized**
testing.

## Prefer the MCP server

If the Beacon MCP server is connected, use its tools directly. They are the same
tools the in-app Beacon AI uses and share the same `tests.json` store, so edits
show up in the desktop app immediately.

**Projects**
- `beacon_list_projects`, `beacon_switch_project(project)`, `beacon_create_project(name, base_url?)`.

**Inspect**
- `beacon_get_config()` - active project, base URL, environment, variable *names* (never values) and endpoint count.
- `beacon_list_endpoints(filter?)` - id, name, method, URL, assertion/extractor summary.
- `beacon_search_endpoints(query?, offset?, limit?)` - paginated compact search; use it
  instead of `list` on large projects so results don't flood your context.
- `beacon_get_endpoint(id)` - full definition by id or exact name.
- `beacon_list_variables()` - project, environment and global variables.

**Create / edit**
- `beacon_create_endpoint(name, url, method?, headers?, payload?, payload_type?, auth?, extractors?, assertions?)`.
  `url` may be relative to the project base URL and may use `{{variables}}`.
  Always pass a descriptive `name` (see **Naming endpoints**).
  Pass `folder` (name, id, or `Parent/Child` path) to place it in a folder; missing
  folders are created.
- `beacon_add_endpoint_from_curl(curl, name?, folder?)` - create from a `curl` command
  (`-X`, `-H`, `-d`/`--data-raw`, `-u` as Basic auth, `--url`, line continuations).
- `beacon_update_endpoint(id, ...)` - partial update; only the fields you pass change.
- `beacon_duplicate_endpoint(id)` - copy with a fresh id at the project root.
- `beacon_delete_endpoint(id)`.
- `beacon_set_variable(name, value)`.

**Import**
- `beacon_import_collection(data, into_folder?)` - Beacon export, Postman v2, OpenAPI 3,
  Swagger 2 (JSON or YAML), Insomnia or HAR. Pass parsed JSON, or
  `{content, filename}` for raw JSON/YAML text. Without `into_folder` a folder named
  after the source is created.

**Organize (folders)**
- `beacon_get_collection()` - the folder tree in display order. Call it before organizing.
- `beacon_organize_collection(operations)` - ordered steps applied atomically (one
  failure saves nothing; endpoints are never lost):
  `{op:"create_folder", name, parent?}`, `{op:"rename_folder", folder, name}`,
  `{op:"delete_folder", folder, delete_contents?}` (contents move up by default),
  `{op:"move", items:[...], to, index?}` (`to: null` is the top level),
  `{op:"reorder", parent?, order:[...]}`. Reference folders and items by id, name or
  `Parent/Child` path. Send every step in one call.

**Send / document**
- `beacon_probe_endpoint(endpoint_id? | url, method?, headers?, payload?, assertions?)` -
  fire once and get status, headers, body, latency, assertion results and
  `extracted` variable names.
- `beacon_capture_baseline(id, generate_assertions?)` - fire the saved endpoint once
  and store the live response as its documented example / mock baseline, adding
  status, latency, content-type and JSON-shape assertions.
- `beacon_set_example_response(id, body, status?, headers?, enabled?)` - write the
  expected response by hand. Use this when the API is not reachable yet: read the
  handler, serializer or DTO source the user points you to, derive field names,
  types and status code, and tell the user which file you read. Examples feed the
  HTML, OpenAPI and Postman exports and the mock server.

**Run**
- `beacon_run_collection(endpoint_ids?, stop_on_failure?)` - ordered run with
  variable chaining; `['Login','Get Profile']` primes `{{access_token}}`.
- `beacon_run_endpoint(id, concurrency?, max_requests?, delay_ms?)` - load-run one saved
  endpoint; same stats as `beacon_run_load_test`.
- `beacon_run_load_test(endpoint_id? | url, concurrency?, max_requests?, delay_ms?, mode?)` -
  **fires real HTTP** and returns counts, status mix, RPS and latency percentiles.
  Confirm the target is authorized before raising `max_requests` or `concurrency`.

Notes:
- Assertion types: `status`, `time_ms`, `body_contains`, `jsonpath` (`path`), `header` (`name`); ops `eq ne lt gt lte gte contains exists`.
- Body types (`payload_type`): `json`, `form`, `multipart`, `raw`.
- Tool failures return `{ "error": "..." }`; fix the reported field and retry, do not guess.

## Naming endpoints

Every endpoint you create, import, or are asked to tidy gets a short,
human-readable name that says **what it does**, not how it is called. The
method and URL are already shown next to the name, so never repeat them.

- Use verb + resource in Title case: `Login`, `List sessions`,
  `Get session`, `Delete session`, `Delete all sessions`,
  `Verify two-factor code`, `Resend OTP`, `Update profile`.
- Map methods to verbs: GET collection → `List …`, GET one → `Get …`,
  POST → `Create …` (or the action: `Login`, `Logout`, `Verify …`, `Resend …`),
  PUT/PATCH → `Update …`, DELETE → `Delete …`.
- Path parameters become a qualifier, not braces: `GET branch-qr/{branch}` →
  `Get branch QR code`; `GET menu-fonts/{font}/{style}` → `Get menu font style`.
- Prefer the OpenAPI `summary` when it is meaningful; otherwise derive the name
  from the path and the folder. Drop prefixes shared by the whole folder
  (`k-motion/`, `api/v1/`).
- Keep names unique inside a folder and under ~40 characters.
- Bad: `POST login`, `GET me`, `POST /api/v1/otp/verify`, `New Endpoint`,
  `Login (copy)`. Good: `Login`, `Get current user`, `Verify OTP`.

Imports fall back to `METHOD path` names. After importing, list the new
endpoints and rename the generic ones with `beacon_update_endpoint(id, name=...)`.

## Organizing into folders

Group endpoints into one folder per module or resource (`Auth`, `Users`,
`Orders`), nested when the API is (`Admin/Discount`). When creating several
endpoints for one module, pass `folder` on each create. To tidy an existing
project: `beacon_get_collection`, propose the tree in one table, then apply every
move in a single `beacon_organize_collection` call. Never fake folders with name
prefixes like `Discount / Add Discount`.
When the user asks to clean up names in an existing project, list them, propose
the renames in one table, and apply them after the user agrees. Renaming
changes no request behaviour.

## Recommended agent workflow

1. Call `beacon_list_projects`; switch explicitly when the intended project is not active.
   Every create/update/delete/set_variable call lands in the ACTIVE project. If
   the user asks for a different API family than the active project (active is
   "G-SPOT", user wants "Google APIs"), create or switch to the right project
   first, or ask one short question with two options ("new project 'Google APIs'
   or add to G-SPOT?"). Never put a new API's variables into an unrelated project.
2. Use `beacon_search_endpoints(query)` (or `beacon_list_endpoints` on small projects), then
   `beacon_get_endpoint` on the selected result. Use `beacon_get_collection` when the
   folder structure matters.
3. Check `beacon_list_variables` so `{{base_url}}` and tokens resolve before sending traffic.
4. Use `beacon_probe_endpoint` once to inspect the real response, assertions, and
   extractors. For a login flow, probe Login first and confirm `extracted`.
   Use `beacon_capture_baseline(id)` to document the response example and
   generate assertions in one step, or `beacon_set_example_response` from source code.
5. Use `beacon_run_collection` for ordered dependent requests.
6. Use `beacon_run_load_test` only after the single request is correct. Start with
   `max_requests=1`, `concurrency=1`; increase gradually and only with authorization.
7. Report the exact target, request count, concurrency, success/error/rate-limit
   totals, and latency percentiles. Never report secret variable values.

### Starting the MCP server

```bash
cargo run -p beacon-mcp            # stdio; set BEACON_DATA_DIR to point at the app's data folder
```

### Register the MCP server

Use the **MCP** panel in the Beacon desktop app (best for bundled binary, no Python needed).

Or manually:

```bash
codex mcp add beacon -- /path/to/mcp_server     # Codex
claude mcp add beacon -- /path/to/mcp_server    # Claude Code
```

For Cursor, Windsurf, Cline, Continue, etc. → use the config snippet from the Beacon **MCP** panel (it gives the correct path to the standalone binary).

## REST fallback (no MCP)

The Rust backend (default `http://localhost:8000`) exposes the same surface:

- `GET /projects`, `GET /tests`, `GET /config`
- `POST /tests`, `PUT /tests/{id}`, `DELETE /tests/{id}`, `POST /tests/{id}/duplicate`
- `PUT /projects/{id}` with `{ "items": [...] }` to reorder/move/rename the tree
- `POST /projects/import/preview` then `POST /projects/import` for a collection or spec
- `POST /send` `{ test_id }` for one request with assertions and extractors
- `POST /run` `{ test_id, mode, concurrency, max_requests, delay, use_min_delay, ... }`
  (modes: load, ramp, spike, soak, rate_probe, capacity, fuzz, benchmark) ->
  `{ run_id, history_id }`; poll `GET /status/{run_id}`; stop with `POST /stop/{run_id}`
- `POST /scenario` `{ test_ids, ... }` for an ordered multi-step journey
- `GET /history?limit=` and `GET /history/{id}` for saved run results

## Safety

- `beacon_run_load_test` / `POST /run` send real traffic. Get explicit authorization for
  the target, and start with small `count`/`concurrency`.
- `tests.json` can contain real tokens — never echo variable *values* back to
  the user or into logs.
