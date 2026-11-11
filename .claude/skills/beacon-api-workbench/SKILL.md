---
name: beacon-api-workbench
description: Drive the Beacon API workbench (github.com/nannndev/beacon) from an agent to discover, create, import, send, chain, load-test, and document API or web endpoints. Supports Beacon/Postman/OpenAPI/Swagger/Insomnia/HAR imports, response assertions/extractors, capturing live responses as documented examples, and authorized rate-limit testing. Prefer the Beacon MCP server; fall back to REST.
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
- `beacon_list_endpoints(filter?)` - id, name, method, URL, assertion/extractor summary.
- `beacon_get_endpoint(id)` - full definition by id or exact name.
- `beacon_list_variables()` - project, environment and global variables.

**Create / edit**
- `beacon_create_endpoint(name, url, method?, headers?, payload?, payload_type?, auth?, extractors?, assertions?)`.
  `url` may be relative to the project base URL and may use `{{variables}}`.
  Always pass a descriptive `name` (see **Naming endpoints**).
- `beacon_update_endpoint(id, ...)` - partial update; only the fields you pass change.
- `beacon_delete_endpoint(id)`.
- `beacon_set_variable(name, value)`.

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
2. Use `beacon_list_endpoints(filter)`, then `beacon_get_endpoint` on the selected result.
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
- `POST /send` `{ test_id }` for one request with assertions and extractors
- `POST /run` `{ test_id, mode, concurrency, max_requests, delay, use_min_delay, ... }`
  (modes: load, ramp, spike, soak, rate_probe, capacity, fuzz, benchmark) ->
  `{ run_id }`; poll `GET /status/{run_id}`; stop with `POST /stop/{run_id}`

## Safety

- `beacon_run_load_test` / `POST /run` send real traffic. Get explicit authorization for
  the target, and start with small `count`/`concurrency`.
- `tests.json` can contain real tokens — never echo variable *values* back to
  the user or into logs.
