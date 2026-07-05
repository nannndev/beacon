# Single-send + Response Inspector — Design

Date: 2026-07-05
Branch: feat/desktop-mcp-bundling

## Goal
Fire ONE request and see the full response (status, time, headers, body). Foundation
for assertions and a Postman-like "normal" mode. Balances Beacon as both an API
client and a load tester.

## Decisions (locked)
- Single-send is **synchronous** and returns the full response (separate from `/run`).
- Extractors **run** on 2xx (updates variables), same as a load run — makes auth setup easy.
- Ships with an **MCP tool** (`send_request`) in parallel with the UI.
- Includes **click-to-extract**: click a field in the response body → auto-create the
  extractor path → saved to the endpoint's `extractors`.

## Engine (`core/tester.py`) — ⚠️ DUPLICATED, edit both `core/` and `backend/app/core/`
- Refactor the payload_type branching out of `_send_one` into `_do_request(session, url,
  headers, payload, timeout)` so load-run and single-send share one request builder.
- Add `APITester.send_once(max_body=262144)`:
  - reuse `_build_request()` (templating) + `_do_request(timeout=30)`.
  - capture status, reason, time_ms, headers, content_type, body (capped to max_body,
    `truncated` flag + real `size_bytes`), parsed `json` when content-type is JSON.
  - on 2xx, run `_extract_from_response`; return `extracted` = names of changed vars
    (NEVER values — secret rule).
  - exceptions → `{ok: false, error, time_ms}` (never raise to the route).
- Extend `_extract_from_response` dot-path to also index lists (`body.items.0.id`).

## Backend — `POST /send`
- Body `{ test_id }`; resolve from `current_config`; `APITester(test, config).send_once()`.
- Persist extractor updates (`store.save()`); return the structured response.
- Shape: `{ ok, status, reason, time_ms, size_bytes, truncated, content_type, headers,
  body, json, target, extracted }`.

## MCP — `send_request(name_or_id)`
- Same `send_once`; `@_locked` (extractors mutate + save). Returns the structured response.

## Frontend
- `api.sendOnce(testId)` → `POST /send`.
- **Send** button in `EndpointEditor` (next to Save).
- `ResponseInspector.tsx`: status badge (2xx/4xx/5xx color), time, size; tabs
  Body (pretty JSON + raw toggle) / Headers / Extracted.
- Click-to-extract: pretty-JSON tree tracks each node's path; a "Save as variable"
  action computes `body.<path>` → `api.updateTest` appends to `extractors` → toast.

## Errors
- Network/timeout → `ok:false` + message (inspector error state), not a 500.
- Non-JSON → raw body only, `json:null`.
- Oversized → `truncated:true` + `size_bytes`.

## Testing
- Engine + MCP verified against httpbin (status/body/timing/truncation/extractor, incl.
  array-index extract). Frontend manual: Send login → see token → click-to-extract →
  Send again uses the token. Keep both `tester.py` files in sync.

## Out of scope (later slices)
Extra content-types (raw/XML/GraphQL/binary), assertions, scenarios/chaining, realtime charts.
