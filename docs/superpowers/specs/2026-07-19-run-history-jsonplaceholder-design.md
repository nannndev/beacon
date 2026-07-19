# Run History, Comparison, and JSONPlaceholder Sample Project Design

**Status:** Approved  
**Date:** 2026-07-19  
**Target:** Current FastAPI + React/Tauri application

## Summary

Beacon will add a local-first run history backed by SQLite, a two-run comparison workspace, and a comprehensive JSONPlaceholder sample project. The history design is ready for a future team-sync service but remains local-only in this release. Existing project, endpoint, and environment configuration remains JSON-based.

The product goals are:

1. Give new users a useful, organized API workspace immediately.
2. Preserve completed test runs so performance and outcome changes can be investigated later.
3. Make baseline-versus-candidate comparison fast and understandable.
4. Avoid storing request or response secrets.
5. Establish stable identifiers and repository boundaries that can support cloud synchronization later.

## Scope

### Included

- A 47-request JSONPlaceholder sample catalog with full CRUD coverage, filters, nested routes, variables, realistic payloads, and basic assertions.
- A safe **Add Sample Project** action for existing users.
- Automatic history capture for Test Mode runs, Run All, folder runs, and scenarios.
- SQLite persistence, pagination, filtering, pinning, labels, deletion, sanitized export, and retention.
- A dedicated split-view History workspace.
- Comparison of exactly two runs, including configuration differences, metric deltas, and aligned time-series.
- Schema migration, interrupted-run recovery, and failure isolation.

### Excluded

- Single Send request history.
- Raw response bodies, request payloads, resolved URLs, headers, cookies, or credentials in history.
- Cloud synchronization, accounts, invitations, team workspaces, roles, permissions, and conflict resolution.
- Cross-device history.
- Scheduled runs and CI runners.
- Automated regression notifications.
- Legacy Flask UI and route parity.

## Product Behavior

### Fresh Workspace

A fresh workspace receives a `Default Project` backed by JSONPlaceholder. "Fresh" means no persisted project collection exists after configuration load; an existing workspace is never treated as fresh merely because its current project is empty.

- Environment name: `JSONPlaceholder`
- Base URL: `https://jsonplaceholder.typicode.com`
- Catalog marker: `jsonplaceholder-v1`
- Conservative default run configuration: one worker, 10 requests, and 2 requests per second

The project description identifies it as a safe sample API. The public sample must not encourage aggressive load against a third-party service.

### Existing Workspace

Existing projects are never overwritten or merged automatically. A new **Add Sample Project** action appears in the project menu and onboarding surfaces. It creates a separate `JSONPlaceholder API` project.

The project receives an optional internal `template_id: "jsonplaceholder-v1"`. The operation is idempotent by this marker. Repeating the action returns the existing sample project rather than creating duplicates. User-edited endpoints are not overwritten. A future catalog revision must use an explicit upgrade flow rather than silently rewriting the project.

Fresh-workspace creation and the UI action call the same deterministic catalog factory. The explicit route is:

`POST /projects/samples/jsonplaceholder`

It returns `{ "project_id": "uuid", "created": true }` for a new sample or the existing ID with `created: false`. Project list responses expose `template_id` so the frontend can disable or relabel the action without matching project names. Portable project export omits this internal marker; importing an exported sample creates a normal user-owned project.

### JSONPlaceholder Catalog

Every resource uses the same predictable hierarchy:

```text
Resource
├─ Read
│  ├─ List
│  ├─ Get by ID
│  └─ Filter
├─ Write
│  ├─ Create
│  ├─ Replace
│  ├─ Update
│  └─ Delete
└─ Relations
   └─ Available nested routes
```

The six resources each contribute seven requests: two basic reads, one filter, and four writes. Five nested routes bring the total to 47.

| Resource | List | Detail | Filter | Create | Replace | Patch | Delete | Relations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Posts | `GET /posts` | `GET /posts/{{post_id}}` | `GET /posts?userId={{user_id}}` | `POST /posts` | `PUT /posts/{{post_id}}` | `PATCH /posts/{{post_id}}` | `DELETE /posts/{{post_id}}` | `GET /posts/{{post_id}}/comments` |
| Comments | `GET /comments` | `GET /comments/{{comment_id}}` | `GET /comments?postId={{post_id}}` | `POST /comments` | `PUT /comments/{{comment_id}}` | `PATCH /comments/{{comment_id}}` | `DELETE /comments/{{comment_id}}` | — |
| Albums | `GET /albums` | `GET /albums/{{album_id}}` | `GET /albums?userId={{user_id}}` | `POST /albums` | `PUT /albums/{{album_id}}` | `PATCH /albums/{{album_id}}` | `DELETE /albums/{{album_id}}` | `GET /albums/{{album_id}}/photos` |
| Photos | `GET /photos` | `GET /photos/{{photo_id}}` | `GET /photos?albumId={{album_id}}` | `POST /photos` | `PUT /photos/{{photo_id}}` | `PATCH /photos/{{photo_id}}` | `DELETE /photos/{{photo_id}}` | — |
| Todos | `GET /todos` | `GET /todos/{{todo_id}}` | `GET /todos?userId={{user_id}}&completed={{completed}}` | `POST /todos` | `PUT /todos/{{todo_id}}` | `PATCH /todos/{{todo_id}}` | `DELETE /todos/{{todo_id}}` | — |
| Users | `GET /users` | `GET /users/{{user_id}}` | `GET /users?username={{username}}` | `POST /users` | `PUT /users/{{user_id}}` | `PATCH /users/{{user_id}}` | `DELETE /users/{{user_id}}` | `GET /users/{{user_id}}/albums`, `/todos`, `/posts` |

The environment defines stable demo variables:

```json
{
  "post_id": 1,
  "comment_id": 1,
  "album_id": 1,
  "photo_id": 1,
  "todo_id": 1,
  "user_id": 1,
  "username": "Bret",
  "completed": false
}
```

Write requests contain realistic resource-specific JSON and `Content-Type: application/json; charset=UTF-8`. Seeded assertions expect `201` for create and `200` for the supported read, replace, patch, and delete examples; they also require response time below 5,000 ms, JSON content type where returned, and a representative response field. DELETE assertions account for JSONPlaceholder's empty object response.

The catalog is built by a deterministic backend factory. Endpoint and folder IDs are stable UUIDv5 values derived from the catalog marker and logical path. Stable IDs make idempotency reliable and prepare the sample for future sync without coupling behavior to display names.

## Run Capture Policy

One user-triggered execution creates one user-visible history run. A single-endpoint Test Mode run has one step. Run All, folder, and scenario executions have ordered endpoint steps under one parent run. History is created automatically for:

- Load, Ramp, Spike, Soak, Rate Probe, Fuzz, and Benchmark modes.
- Run All.
- Folder runs.
- Scenario runs.

Single Send is intentionally excluded because request inspection and performance history have different volume, privacy, and user-intent characteristics.

The same policy applies across UI, REST, and the bundled MCP server. MCP `run_endpoint` and `run_scenario` create history; MCP `send_request` is the Single Send equivalent and does not. WAL mode and short per-operation connections allow the desktop backend and MCP process to share the local database safely.

A run is created with status `running` before orchestration begins. The orchestration layer registers its ordered steps, and each runner reports into the same recorder. Metrics and samples stay in bounded memory buffers while execution is active. The backend writes step results and the final aggregate summary, samples, and events in short transactions when the run completes, stops, or fails. This avoids a SQLite write on every request and keeps load generation independent of persistence performance.

If history persistence fails, the test continues and its live result remains available. The UI shows a non-blocking message that the completed run was not saved.

## SQLite Architecture

### Location and Runtime Settings

The database is stored at `<BEACON_DATA_DIR>/history.db`. Web development uses the same resolved application data strategy as the current backend configuration.

SQLite settings:

- WAL journal mode.
- Foreign keys enabled.
- A bounded busy timeout.
- One connection per repository operation.
- Short explicit transactions.
- No long-lived transaction during a test run.

The first release uses Python's standard-library `sqlite3`; no database server or new runtime service is required.

### Repository Boundary

Route and runner code depend on a `RunHistoryRepository` interface, not direct SQL. The SQLite implementation owns migrations, queries, retention, and transaction boundaries. This allows a future sync-aware repository or remote adapter without changing React components or runner callbacks.

The repository exposes operations equivalent to:

- `start_run(metadata)`
- `finalize_run(run_id, outcome, metrics, samples, events)`
- `mark_interrupted_runs(device_id)`
- `list_runs(filters, cursor, limit)`
- `get_run(run_id)`
- `compare_runs(baseline_id, candidate_id)`
- `update_run(run_id, label, pinned)`
- `delete_run(run_id)`
- `export_run(run_id)`
- `enforce_retention(project_id)`

### Schema

#### `runs`

- `id TEXT PRIMARY KEY` — UUID.
- `workspace_id TEXT NOT NULL` — stable local workspace UUID.
- `project_id TEXT NOT NULL`.
- `project_name TEXT NOT NULL` — display snapshot retained if the project is later deleted.
- `origin_device_id TEXT NOT NULL`.
- `source_type TEXT NOT NULL` — endpoint, folder, run_all, or scenario.
- `target_id TEXT` and `target_name TEXT NOT NULL`.
- `mode TEXT NOT NULL`.
- `status TEXT NOT NULL` — running, completed, stopped, failed, interrupted.
- `label TEXT`.
- `is_pinned INTEGER NOT NULL DEFAULT 0`.
- `started_at TEXT NOT NULL` and `completed_at TEXT` in UTC ISO-8601.
- `duration_ms INTEGER`.
- `config_snapshot_json TEXT NOT NULL` — sanitized execution parameters only.
- `schema_version INTEGER NOT NULL`.
- `revision INTEGER NOT NULL DEFAULT 1`.
- `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`, and `deleted_at TEXT`.

Indexes cover `(project_id, started_at DESC)`, `(project_id, is_pinned, started_at DESC)`, `(mode, started_at DESC)`, status, and workspace/revision fields.

#### `run_steps`

One ordered row per endpoint participating in the user-visible run. A single-endpoint run has one step. Each row contains sequence, endpoint ID/name snapshot, method, URL template, step status, attempts, outcomes, and summarized timing. Scenario ordering is preserved. No step stores headers, payloads, resolved variables, or response bodies.

#### `run_metrics`

One row per run containing attempts, success, rate limited, errors, average and peak RPS, and min/average/P50/P95/P99/max latency.

#### `run_samples`

At most 300 ordered samples per run. Each sample contains sequence, elapsed time, cumulative outcomes, instantaneous RPS, and latency values available at that point. Buffers downsample deterministically when the cap is reached.

#### `run_events`

At most 200 structured events per run. Events may contain elapsed time, outcome category, status code, latency, and a capped sanitized error category/message. They never contain request or response headers, bodies, cookies, or resolved variables.

#### `history_meta`

Stores the stable local `workspace_id`, `origin_device_id`, database creation time, and catalog/schema metadata. These identifiers are generated once and survive application upgrades. They are not account or remote-workspace credentials.

#### `schema_migrations`

Tracks ordered migration versions and applied timestamps. Migrations run in transactions. Before a version-changing migration, Beacon checkpoints WAL state and creates a recoverable backup through SQLite's backup API. A failed migration rolls back and leaves history unavailable without affecting project JSON or test execution.

## Sync-Ready Fields

This release does not perform network synchronization. Stable UUIDs, `workspace_id`, `origin_device_id`, `revision`, timestamps, and the reserved `deleted_at` field are included so a later remote service can add incremental sync and conflict handling without replacing local identifiers. Version 1 performs confirmed local hard deletion; tombstone behavior is activated only when a sync protocol exists.

Future cloud architecture may use PostgreSQL remotely while SQLite remains the offline cache. Authentication, authorization, encryption policy, invites, roles, conflict resolution, and audit logs require a separate approved design.

## REST API

All history routes are scoped to the current local workspace. Version 1 has no account or remote-user context.

### List

`GET /history`

Supports project, mode, status, source type, pinned-only, date range, free-text search, cursor, and limit. Default limit is 30; maximum is 100. Results contain list summaries rather than samples/events.

### Detail

`GET /history/{run_id}`

Returns metadata, sanitized configuration, metrics, samples, and events.

### Compare

`POST /history/compare`

```json
{
  "baseline_id": "uuid",
  "candidate_id": "uuid"
}
```

Returns both summaries, configuration differences, signed and semantic deltas, and series aligned by elapsed time. Comparisons across different modes are allowed but clearly marked. The first run is always the baseline.

### Update and Delete

`PATCH /history/{run_id}` updates only label and pin state. `DELETE /history/{run_id}` performs a confirmed local hard delete with cascading removal of steps, metrics, samples, and events. The reserved `deleted_at` field is not used until a future sync design defines tombstone lifecycle rules.

### Export

`GET /history/{run_id}/export` returns a portable, explicitly sanitized JSON envelope with format and schema version fields. Importing history is not included in this release.

### Health and Recovery

`GET /history/health` returns availability, a safe error code, and whether a recoverable backup exists; it never returns raw database errors or paths. `POST /history/rebuild` requires the exact confirmation text `RESET HISTORY`, preserves the unavailable database as a timestamped backup, initializes a fresh schema, and never touches project JSON.

## Retention and Recovery

- Retain the latest 100 unpinned runs per project.
- Pinned runs are excluded from automatic deletion.
- Enforce retention only after a run finalizes successfully.
- On startup, runs left in `running` by the same device are marked `interrupted`.
- A database error never prevents endpoint configuration, Single Send, or a live test run.
- Corrupt databases are not reset automatically. History becomes unavailable and the UI offers diagnostic export and an explicit confirmed reset/rebuild action.
- Project deletion does not silently delete history. Associated runs remain filterable as an archived/deleted project snapshot until the user deletes them or the startup retention sweep removes excess unpinned runs.

## Privacy and Sanitization

History stores endpoint identity and URL templates, not resolved URLs. It stores method, test-mode parameters, outcome counts, timing data, and structured event categories.

It must not store:

- Authorization, Cookie, Set-Cookie, API-key, or other request/response headers.
- Request payloads or response bodies.
- Resolved variable values.
- Extracted tokens.
- Full exception objects or stack traces that may include request data.

Sanitization occurs before repository calls. The repository accepts typed sanitized records rather than arbitrary runner dictionaries. Export performs a second allowlist projection as defense in depth.

## Frontend Information Architecture

### Entry Points

- A new **History** item in the main sidebar.
- A **View in History** action after a persisted run finishes.
- A project-menu and onboarding **Add Sample Project** action.

### Split Workspace

Desktop uses the approved Split Workspace layout:

- Left pane: search, filters, pagination, run summaries, pin controls, and comparison selection.
- Right pane: selected run header, metric cards, time-series chart, outcome distribution, sanitized events, configuration snapshot, and actions.
- Selecting exactly two runs enables comparison mode.

The first selected run is the baseline and the second is the candidate. Users can swap them. Metric semantics determine color: lower latency/errors/rate limits are positive; higher success/throughput are positive. Raw values and signed deltas remain visible so color is never the sole signal.

Charts can switch among latency, throughput, and outcomes. Comparison overlays both runs and labels the baseline/candidate explicitly. Config differences show mode parameters and target identity, but never hidden values.

Tablet and mobile use list-to-detail navigation instead of compressing both panes. Comparison remains available through a persistent selection bar.

### States and Accessibility

- Empty state explains which run types are saved and offers a test-run action.
- Loading uses stable skeletons without shifting pane layout.
- Unavailable history explains that tests still work and provides recovery guidance.
- Keyboard navigation covers run selection, pinning, filters, and comparison.
- All charts have textual metric summaries and do not rely solely on color.
- Destructive actions require confirmation and return focus predictably.

## Testing Strategy

### Backend Unit Tests

- Fresh schema creation and ordered migrations.
- Migration rollback and backup behavior.
- Start/finalize transitions for completed, stopped, failed, and interrupted runs.
- Single-endpoint and multi-step Run All, folder, and scenario aggregation.
- Retention with pinned-run protection.
- Bounded deterministic samples and events.
- Percentile and RPS aggregation.
- Semantic comparison deltas and config differences.
- Sanitization allowlists and secret fixtures.
- Cursor pagination and all filters.
- Sample catalog count, stable IDs, payloads, assertions, variables, and idempotency.

### API Tests

- List summary versus detail payload boundaries.
- Compare validation and missing-run errors.
- Allowed PATCH fields only.
- Confirmed deletion behavior.
- Sanitized export envelope.
- History failure does not fail a run.
- Add Sample Project does not duplicate or overwrite projects.

### Frontend Tests

- History loading, empty, populated, and unavailable states.
- Search, filters, pagination, pinning, labels, deletion, and export.
- Single selection and exactly-two-run comparison.
- Baseline swap and semantic delta presentation.
- Config-difference display.
- Desktop split layout and mobile list-to-detail behavior.
- Add Sample Project success, existing-sample response, and error states.

### Integration Acceptance

- A fresh workspace contains exactly 47 organized sample requests.
- Every seeded request resolves with its default environment and has relevant assertions.
- A completed Test Mode run appears in History without a page refresh.
- Run All, folder, and scenario executions appear as one parent run with ordered step results.
- Single Send does not create a history record.
- Two runs can be compared with accurate deltas and aligned charts.
- Stopping or crashing a run produces stopped or interrupted history as appropriate.
- The database contains no seeded secret markers used by the privacy test fixture.
- Simulated SQLite failure leaves live test execution operational.

## Rollout

The implementation is delivered in two internal phases within one feature release:

1. JSONPlaceholder catalog factory, fresh-workspace seed, Add Sample Project API/UI, and catalog tests.
2. SQLite repository, history capture, REST API, Split Workspace UI, comparison, retention, recovery, and integration tests.

The phases remain independently testable, but the release is considered complete only when both acceptance groups pass.

## Reference

- [JSONPlaceholder Guide](https://jsonplaceholder.typicode.com/guide/)
- [JSONPlaceholder resources and routes](https://jsonplaceholder.typicode.com/)
