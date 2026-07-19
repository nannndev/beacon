# SQLite Run History and Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist all non-Single-Send executions in a privacy-safe local SQLite database and provide a split-view workspace for filtering, inspecting, exporting, and comparing two runs.

**Architecture:** A typed `HistoryService` buffers active-run samples and delegates durable operations to `SqliteRunHistoryRepository`. FastAPI owns orchestration and persistence; React consumes summary/detail/compare APIs. Stable workspace/device/run UUIDs and revision fields make the local model ready for a separately designed future sync layer.

**Tech Stack:** Python 3 `sqlite3`, FastAPI, existing threaded runner, React 18, TypeScript, Vitest, Testing Library, lightweight SVG charts.

## Global Constraints

- Store the database at `<BEACON_DATA_DIR>/history.db`, or `config/history.db` in web development.
- Enable WAL, foreign keys, and a 5,000 ms busy timeout.
- Keep at most 100 unpinned runs per project; pinned runs are exempt.
- Keep at most 300 samples and 200 structured events per run.
- Never store resolved URLs, request/response headers, cookies, payloads, bodies, variables, extracted tokens, or stack traces.
- History failure must never fail endpoint configuration, Single Send, or a live test run.
- One user action produces one user-visible run; Run All/folder/scenario endpoints are ordered steps.
- Single Send never creates history.
- Version 1 uses confirmed hard deletion and no network sync.
- Do not add a charting dependency or modify the legacy Flask UI/routes.

---

## File Structure

- `backend/app/history/models.py` — typed sanitized run, step, metric, sample, event records.
- `backend/app/history/sqlite_repository.py` — schema, migrations, CRUD, filters, retention.
- `backend/app/history/service.py` — availability isolation, active buffers, aggregation, finalization.
- `backend/app/history/sanitize.py` — allowlist projections and normalized error categories.
- `backend/app/history/compare.py` — percentile and semantic comparison functions.
- `backend/app/routers/history.py` — history REST routes and internal group orchestration routes.
- `backend/app/state.py` — injected history service and path resolution.
- `backend/app/main.py` — lifecycle initialization and router registration.
- `backend/app/routers/runs.py` — single run/scenario recording and history IDs.
- `backend/app/services/runner.py` — recorder callbacks alongside live broadcast.
- `backend/app/mcp_server.py` — record MCP endpoint/scenario runs while excluding `send_request`.
- `backend/tests/test_history_repository.py` — migrations, CRUD, filters, retention, recovery.
- `backend/tests/test_history_service.py` — buffers, privacy, aggregation, failure isolation.
- `backend/tests/test_history_compare.py` — percentiles, delta semantics, series alignment.
- `backend/tests/test_history_routes.py` — route contract tests against an injected temporary service.
- `frontend/src/types/history.ts` — API contracts.
- `frontend/src/lib/historyMetrics.ts` — presentation semantics and series helpers.
- `frontend/src/lib/historyMetrics.test.ts` — pure comparison tests.
- `frontend/src/pages/HistoryPage.tsx` — data/state coordinator.
- `frontend/src/components/history/HistoryList.tsx` — search/filter/run list pane.
- `frontend/src/components/history/HistoryDetail.tsx` — selected-run detail pane.
- `frontend/src/components/history/HistoryCompare.tsx` — baseline/candidate comparison.
- `frontend/src/components/history/HistoryChart.tsx` — accessible lightweight SVG chart.
- `frontend/src/components/history/HistoryPage.test.tsx` — UI state and selection tests.
- `frontend/src/hooks/useAppView.ts` — workspace/history URL state.
- `frontend/src/hooks/useRun.ts` — history group coordination and last history ID.
- `frontend/src/components/Sidebar.tsx` — History navigation.
- `frontend/src/components/LiveMonitor.tsx` — View in History action.
- `frontend/src/App.tsx` — view switching and history deep-link.

---

### Task 1: SQLite Schema and Repository

**Files:**
- Create: `backend/app/history/__init__.py`
- Create: `backend/app/history/models.py`
- Create: `backend/app/history/sqlite_repository.py`
- Create: `backend/tests/test_history_repository.py`

**Interfaces:**
- Produces: `SqliteRunHistoryRepository(path: str)`
- Produces: `initialize()`, `create_run()`, `add_step()`, `finalize_step()`, `finalize_run()`, `list_runs()`, `get_run()`, `update_run()`, `delete_run()`, `mark_interrupted()`, `enforce_retention()`
- Produces immutable dataclasses: `RunStart`, `RunStepStart`, `RunMetrics`, `RunSample`, `RunEvent`

- [ ] **Step 1: Write failing repository tests**

```python
class HistoryRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "history.db")
        self.repo = SqliteRunHistoryRepository(self.path)
        self.repo.initialize()

    def test_schema_settings_and_round_trip(self):
        self.assertEqual(self.repo.pragma("journal_mode").lower(), "wal")
        run = RunStart(id="r1", workspace_id="w1", project_id="p1", project_name="Demo",
                       origin_device_id="d1", source_type="endpoint",
                       target_id="e1", target_name="List posts", mode="load",
                       config_snapshot={"concurrency": 1})
        self.repo.create_run(run, [RunStepStart(0, "e1", "List posts", "GET", "/posts")])
        self.repo.finalize_run("r1", "completed", RunMetrics(attempts=10, success=10))
        detail = self.repo.get_run("r1")
        self.assertEqual(detail["metrics"]["attempts"], 10)
        self.assertEqual(detail["steps"][0]["url_template"], "/posts")

    def test_retention_keeps_100_unpinned_plus_pins(self):
        seed_runs(self.repo, project_id="p1", unpinned=105, pinned=2)
        self.repo.enforce_retention("p1")
        rows = self.repo.list_runs({"project_id": "p1"}, None, 200)["items"]
        self.assertEqual(len(rows), 102)
        self.assertEqual(sum(row["is_pinned"] for row in rows), 2)
```

- [ ] **Step 2: Run repository tests to verify RED**

Run: `python -m unittest backend.tests.test_history_repository -v`  
Expected: FAIL because the history package is absent.

- [ ] **Step 3: Implement schema version 1 and repository transactions**

Create tables `history_meta`, `schema_migrations`, `runs`, `run_steps`, `run_metrics`, `run_samples`, and `run_events` exactly as defined in the approved spec. Connection setup must execute:

```python
connection.execute("PRAGMA foreign_keys = ON")
connection.execute("PRAGMA journal_mode = WAL")
connection.execute("PRAGMA busy_timeout = 5000")
```

Use `(started_at, id)` as the opaque cursor boundary and `ORDER BY started_at DESC, id DESC`. Use explicit allowlists for filter columns. Cascading foreign keys remove children on confirmed hard delete. `history_meta` generates stable workspace/device UUIDs once.

- [ ] **Step 4: Run repository tests to verify GREEN**

Run: `python -m unittest backend.tests.test_history_repository -v`  
Expected: schema, CRUD, pagination, and retention tests pass.

- [ ] **Step 5: Commit repository**

```powershell
git add backend/app/history backend/tests/test_history_repository.py
git commit -m "feat: add SQLite run history repository"
```

---

### Task 2: Sanitization, Aggregation, and Comparison

**Files:**
- Create: `backend/app/history/sanitize.py`
- Create: `backend/app/history/compare.py`
- Create: `backend/app/history/service.py`
- Create: `backend/tests/test_history_service.py`
- Create: `backend/tests/test_history_compare.py`

**Interfaces:**
- Produces: `sanitize_run_config(payload: dict, endpoint: EndpointTest) -> dict`
- Produces: `sanitize_response_event(response: dict, elapsed_ms: int) -> RunEvent`
- Produces: `percentile(values: list[float], quantile: float) -> float | None`
- Produces: `compare_details(baseline: dict, candidate: dict) -> dict`
- Produces: `HistoryService.start()`, `record_stats()`, `record_response()`, `finish_step()`, `finish_run()`

- [ ] **Step 1: Write failing privacy and comparison tests**

```python
def test_sanitizer_drops_every_secret_surface(self):
    endpoint = endpoint_fixture(headers={"Authorization": "Bearer SECRET"},
                                payload={"password": "SECRET"})
    clean = sanitize_run_config({"mode": "load", "concurrency": 2,
                                 "headers": endpoint.headers, "payload": endpoint.payload}, endpoint)
    serialized = json.dumps(clean)
    assert "SECRET" not in serialized
    assert clean == {"mode": "load", "concurrency": 2,
                     "method": endpoint.method, "url_template": endpoint.url}

def test_compare_uses_metric_direction_semantics(self):
    result = compare_details(detail(p95=400, errors=5, success=95, rps=20),
                             detail(p95=300, errors=2, success=98, rps=25))
    assert result["deltas"]["p95_ms"]["change"] == -100
    assert result["deltas"]["p95_ms"]["improved"] is True
    assert result["deltas"]["rps"]["improved"] is True
```

- [ ] **Step 2: Run service/compare tests to verify RED**

Run: `python -m unittest backend.tests.test_history_service backend.tests.test_history_compare -v`  
Expected: FAIL because sanitize, compare, and service modules are absent.

- [ ] **Step 3: Implement typed allowlists and bounded recorder buffers**

Only accept these run-config keys: mode, concurrency, delay, max_requests, use_min_delay, ramp_start, ramp_end, ramp_step_duration, baseline_workers, peak_workers, baseline_requests, peak_requests, recovery_requests, duration_s, rps, start_rps, step_rps, step_requests, max_rps, fuzz field names (not values), n_samples, and warmup. Add method and URL template from the endpoint definition.

`HistoryService` catches repository exceptions, sets `available=False` plus a safe error code, and never raises into the runner. Downsample samples deterministically when the buffer exceeds 300; cap structured events at 200. Calculate percentiles from retained latency samples and aggregate step metrics into the parent run.

Align compare series on elapsed milliseconds. Do not extrapolate beyond the shorter run. Return `{value, change, percent_change, improved}` for each metric, using lower-is-better for latency/errors/rate limits and higher-is-better for success/RPS.

- [ ] **Step 4: Verify all service and comparison tests**

Run: `python -m unittest backend.tests.test_history_service backend.tests.test_history_compare -v`  
Expected: privacy fixtures, bounds, aggregation, failure isolation, and deltas pass.

- [ ] **Step 5: Commit service layer**

```powershell
git add backend/app/history backend/tests/test_history_service.py backend/tests/test_history_compare.py
git commit -m "feat: record and compare sanitized runs"
```

---

### Task 3: Backend Lifecycle and Runner Capture

**Files:**
- Modify: `backend/app/state.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/routers/runs.py`
- Modify: `backend/app/services/runner.py`
- Modify: `backend/app/mcp_server.py`
- Create: `backend/tests/test_history_runner_integration.py`

**Interfaces:**
- Store produces: `store.history: HistoryService`
- `/run` returns: `{run_id, mode, history_id}`
- `/scenario` returns existing fields plus `history_id`
- Optional `/run` inputs: `history_id`, `history_step_index`

- [ ] **Step 1: Write failing runner integration tests**

```python
def test_single_run_finalizes_one_history_step(self):
    fake_history = RecordingHistoryService()
    target_store = store_fixture(history=fake_history, endpoint=fake_endpoint())
    with patch_run_dependencies(target_store, fake_tester_result()):
        response = asyncio.run(start_run({"test_id": "e1", "mode": "load", "max_requests": 2}))
        wait_for_threads()
    self.assertEqual(response["history_id"], response["run_id"])
    self.assertEqual(fake_history.finished[0].status, "completed")

def test_single_send_never_records_history(self):
    fake_history = RecordingHistoryService()
    with patch_run_dependencies(store_fixture(history=fake_history), fake_send_result()):
        send_single({"test_id": "e1"})
    self.assertEqual(fake_history.started, [])

def test_mcp_run_is_recorded_but_mcp_send_is_not(self):
    run_result = run_endpoint("List posts", count=2)
    send_result = send_request("List posts")
    self.assertIn("history_id", run_result)
    self.assertNotIn("history_id", send_result)
```

- [ ] **Step 2: Run integration tests to verify RED**

Run: `python -m unittest backend.tests.test_history_runner_integration -v`  
Expected: FAIL because Store has no history service and run responses lack `history_id`.

- [ ] **Step 3: Initialize history safely and record runner callbacks**

Resolve the DB path in `state.py`. During FastAPI lifespan, call `history.initialize()` and `history.mark_interrupted_runs()` inside failure isolation. In `/run`, create or attach the history parent before starting the thread. Compose callbacks so live WebSocket dispatch and history recording both run:

```python
def on_stats(stats):
    history.record_stats(history_id, step_index, stats)
    runner.dispatch(runner.broadcast_stats(run_id, stats))

def on_response(response):
    history.record_response(history_id, step_index, response)
    runner.dispatch(runner.broadcast_response(run_id, response))
```

Finalize the step/run in `finally`, mapping stopped, failed, and completed correctly. Wrap `/scenario` as one parent with ordered steps and aggregate step outcomes. Keep `/send` unchanged. Apply the same recorder to MCP `run_endpoint` and `run_scenario`, returning `history_id`; keep MCP `send_request` excluded.

- [ ] **Step 4: Run backend integration and existing tests**

Run: `python -m unittest discover -s backend/tests -v`  
Expected: all tests pass, including proof that repository failures do not fail a run.

- [ ] **Step 5: Commit lifecycle integration**

```powershell
git add backend/app/state.py backend/app/main.py backend/app/routers/runs.py backend/app/services/runner.py backend/app/mcp_server.py backend/tests
git commit -m "feat: capture run lifecycle in history"
```

---

### Task 4: History REST and Multi-Endpoint Group API

**Files:**
- Create: `backend/app/routers/history.py`
- Modify: `backend/app/routers/__init__.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_history_routes.py`

**Interfaces:**
- Produces approved list/detail/compare/PATCH/DELETE/export routes.
- Produces internal `POST /history/groups` and `POST /history/{id}/finish` for frontend Run All/folder orchestration.
- Produces `GET /history/health` and confirmed `POST /history/rebuild` for unavailable/corrupt storage recovery.

- [ ] **Step 1: Write failing route contract tests**

```python
def test_list_applies_limit_and_filters(self):
    response = list_history(project_id="p1", mode="load", status="completed",
                            pinned=False, search="posts", cursor=None, limit=30)
    self.assertEqual(response["items"][0]["project_id"], "p1")

def test_compare_requires_distinct_existing_runs(self):
    with self.assertRaises(HTTPException) as error:
        compare_history({"baseline_id": "r1", "candidate_id": "r1"})
    self.assertEqual(error.exception.status_code, 400)

def test_export_is_allowlisted(self):
    exported = export_history("r1")
    self.assertEqual(exported["format"], "beacon.run-history")
    self.assertNotIn("headers", json.dumps(exported).lower())

def test_rebuild_requires_exact_confirmation(self):
    with self.assertRaises(HTTPException) as error:
        rebuild_history({"confirm": "yes"})
    self.assertEqual(error.exception.status_code, 400)
```

- [ ] **Step 2: Run route tests to verify RED**

Run: `python -m unittest backend.tests.test_history_routes -v`  
Expected: FAIL because the history router does not exist.

- [ ] **Step 3: Implement validation and route projections**

Clamp list limits to 1–100, validate enum filters, return 404 for missing IDs, and accept only `label` and `is_pinned` in PATCH. Group creation accepts sanitized source metadata plus ordered endpoint IDs, returns a server UUID, and registers all steps. Group finish accepts only `stopped` or `failed`; normal completion is derived when all registered steps finalize. Health returns only availability, safe error code, and backup presence. Rebuild requires body `{ "confirm": "RESET HISTORY" }`, moves the corrupt DB to a timestamped backup, and initializes a fresh schema; it never touches project JSON.

Register the router in `main.py` and add `/history` to the Vite proxy list.

- [ ] **Step 4: Verify backend route and repository suites**

Run: `python -m unittest discover -s backend/tests -v`  
Expected: all backend tests pass.

- [ ] **Step 5: Commit API routes**

```powershell
git add backend/app/routers backend/app/main.py backend/tests frontend/vite.config.ts
git commit -m "feat: expose run history API"
```

---

### Task 5: Frontend Contracts and Presentation Semantics

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/types/history.ts`
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/historyMetrics.ts`
- Create: `frontend/src/lib/historyMetrics.test.ts`

**Interfaces:**
- Produces: `HistorySummary`, `HistoryDetail`, `HistoryFilters`, `HistoryCompareResult`.
- Produces API methods: list, detail, compare, update, delete, export, createGroup, finishGroup.
- Produces API methods: `historyHealth()` and `rebuildHistory(confirm)`.
- Produces: `metricTone(metric, change)`, `formatMetricDelta()`, `buildSvgPoints()`.

- [ ] **Step 1: Add Testing Library and write failing semantic tests**

Configure Vitest with jsdom and setup `@testing-library/jest-dom/vitest`. Test:

```ts
describe('metricTone', () => {
  it('understands lower and higher is better metrics', () => {
    expect(metricTone('p95_ms', -80)).toBe('positive')
    expect(metricTone('errors', 3)).toBe('negative')
    expect(metricTone('success', 3)).toBe('positive')
    expect(metricTone('rps', -2)).toBe('negative')
  })
})
```

- [ ] **Step 2: Run semantic tests to verify RED**

Run: `corepack pnpm@8.15.9 --dir frontend test -- src/lib/historyMetrics.test.ts`  
Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement typed contracts and pure helpers**

Define all API response fields from the backend projection, not raw database rows. Build SVG points only from finite values; return an empty array for fewer than two valid points. Use an explicit lower-is-better set `p50_ms`, `p95_ms`, `p99_ms`, `errors`, `rate_limited` and higher-is-better set `success`, `average_rps`, `peak_rps`.

- [ ] **Step 4: Run tests and TypeScript build**

Run: `corepack pnpm@8.15.9 --dir frontend test`  
Run: `corepack pnpm@8.15.9 --dir frontend build`  
Expected: both exit 0.

- [ ] **Step 5: Commit frontend data layer**

```powershell
git add frontend/package.json frontend/pnpm-lock.yaml frontend/vite.config.ts frontend/src/test frontend/src/types frontend/src/lib
git commit -m "feat: add history frontend contracts"
```

---

### Task 6: Split History Workspace UI

**Files:**
- Create: `frontend/src/pages/HistoryPage.tsx`
- Create: `frontend/src/components/history/HistoryList.tsx`
- Create: `frontend/src/components/history/HistoryDetail.tsx`
- Create: `frontend/src/components/history/HistoryCompare.tsx`
- Create: `frontend/src/components/history/HistoryChart.tsx`
- Create: `frontend/src/components/history/HistoryPage.test.tsx`

**Interfaces:**
- `HistoryPage({ projectId, onBack, initialRunId?, client? })`
- List emits selected IDs, filters, pagination, pin/update/delete actions.
- Detail/Compare consume typed projections only.

- [ ] **Step 1: Write failing workspace behavior tests**

```tsx
it('selects one run for detail and exactly two for comparison', async () => {
  render(<HistoryPage projectId="p1" client={fakeHistoryClient(twoRuns)} onBack={() => {}} />)
  await userEvent.click(await screen.findByText('Load · GET /posts'))
  expect(screen.getByRole('heading', { name: /GET \/posts/i })).toBeInTheDocument()
  await userEvent.click(screen.getByLabelText('Compare Load · GET /posts'))
  await userEvent.click(screen.getByLabelText('Compare Spike · POST /posts'))
  expect(await screen.findByText('Baseline')).toBeInTheDocument()
  expect(screen.getByText('Candidate')).toBeInTheDocument()
})

it('renders unavailable history without blocking workspace navigation', async () => {
  render(<HistoryPage projectId="p1" client={failingHistoryClient()} onBack={() => {}} />)
  expect(await screen.findByText(/tests still work/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /back to workspace/i })).toBeEnabled()
})
```

- [ ] **Step 2: Run component tests to verify RED**

Run: `corepack pnpm@8.15.9 --dir frontend test -- src/components/history/HistoryPage.test.tsx`  
Expected: FAIL because history components do not exist.

- [ ] **Step 3: Implement approved Split Workspace**

Use a 38/62 desktop split, project/mode/status/date/pinned/search filters, cursor pagination, stable loading skeletons, empty and unavailable states, and a two-selection comparison bar. Keep chart paths presentation-only and render textual metric summaries. On widths below the medium breakpoint, render list → detail navigation with a persistent compare selection bar.

Provide label, pin, export, and confirmed delete actions. Baseline/candidate labels and raw values must accompany semantic colors. Add tabs for latency, throughput, and outcomes; do not add a chart library. The unavailable state loads `/history/health`, explains that tests still work, and offers **Reset History Database** only after the user types `RESET HISTORY`; a successful rebuild reloads the empty state.

- [ ] **Step 4: Verify UI tests and production build**

Run: `corepack pnpm@8.15.9 --dir frontend test`  
Run: `corepack pnpm@8.15.9 --dir frontend build`  
Expected: all tests and build pass.

- [ ] **Step 5: Commit history workspace**

```powershell
git add frontend/src/pages/HistoryPage.tsx frontend/src/components/history
git commit -m "feat: add split run history workspace"
```

---

### Task 7: Navigation, Run All Grouping, and Deep Links

**Files:**
- Create: `frontend/src/hooks/useAppView.ts`
- Create: `frontend/src/hooks/useAppView.test.ts`
- Modify: `frontend/src/hooks/useRun.ts`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/components/LiveMonitor.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- `useRun` additionally produces `lastHistoryId`.
- `startAll(items, context)` accepts `{sourceType: 'run_all'|'folder', targetId?, targetName}`.
- Sidebar consumes `activeView` and `onOpenHistory`.
- LiveMonitor consumes optional `onViewHistory`.

- [ ] **Step 1: Write failing navigation/group payload tests**

```ts
it('maps history URLs and preserves a requested run id', () => {
  expect(parseAppView('/history', '?run=r1')).toEqual({ view: 'history', runId: 'r1' })
  expect(parseAppView('/', '')).toEqual({ view: 'workspace', runId: null })
})

it('adds server history group metadata to each queued endpoint', () => {
  expect(withHistoryStep({ test_id: 'e2' }, 'h1', 1)).toEqual({
    test_id: 'e2', history_id: 'h1', history_step_index: 1,
  })
})
```

- [ ] **Step 2: Run hook tests to verify RED**

Run: `corepack pnpm@8.15.9 --dir frontend test -- src/hooks/useAppView.test.ts`  
Expected: FAIL because navigation/group helpers are absent.

- [ ] **Step 3: Implement route state and history-aware runs**

Use `window.history.pushState` and `popstate` without adding React Router. `startAll` creates a server history group before the first endpoint, sends `history_id` and zero-based step indexes with each `/run`, and finalizes failed/stopped groups when a queue aborts. Single `/run` stores the returned history ID. Scenario responses expose their history ID.

Add a History navigation item in expanded/collapsed Sidebar. Render `HistoryPage` instead of the workspace when active. The Live Monitor **View in History** button deep-links to `/history?run=<id>` after persistence succeeds.

- [ ] **Step 4: Verify hooks, components, and build**

Run: `corepack pnpm@8.15.9 --dir frontend test`  
Run: `corepack pnpm@8.15.9 --dir frontend build`  
Expected: all tests and build pass.

- [ ] **Step 5: Commit integration**

```powershell
git add frontend/src/hooks frontend/src/components/Sidebar.tsx frontend/src/components/LiveMonitor.tsx frontend/src/App.tsx frontend/src/lib/api.ts
git commit -m "feat: connect runs to history workspace"
```

---

### Task 8: Recovery, Documentation, and Full Acceptance Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/features/monitoring.md`
- Create: `docs/features/run-history.md`
- Modify: `docs/index.md`

**Interfaces:**
- Consumes all prior history interfaces.
- Produces recovery copy, user docs, and release gate evidence.

- [ ] **Step 1: Add recovery integration tests**

Add tests that leave a run `running`, reinitialize the service, and assert `interrupted`; inject a repository that raises on every operation and assert `/run` still reaches `finished`. Add a secret canary across endpoint headers, payload, response, and error text, then scan every text column in the temporary SQLite DB and assert the canary is absent.

- [ ] **Step 2: Document run history and privacy behavior**

Document saved run types, exclusion of Single Send, 100-run retention, pinning, comparison semantics, export, recovery, the local DB path, and the exact list of data never stored. Link the new page from monitoring docs and the documentation index.

- [ ] **Step 3: Run the complete backend gate**

Run: `python -m unittest discover -s backend/tests -v`  
Expected: all catalog/history suites pass with no failures.

- [ ] **Step 4: Run the complete frontend gate**

Run: `corepack pnpm@8.15.9 --dir frontend test`  
Run: `corepack pnpm@8.15.9 --dir frontend build`  
Expected: all tests pass and production build exits 0.

- [ ] **Step 5: Run desktop regression checks**

Run: `corepack pnpm@8.15.9 test:desktop-release`  
Run: `$env:TAURI_CONFIG='{"bundle":{"externalBin":[]}}'; cargo check --release --manifest-path frontend/src-tauri/Cargo.toml`  
Expected: DevTools release checks pass and Tauri release compilation exits 0.

- [ ] **Step 6: Manual browser acceptance**

Using a temporary `BEACON_DATA_DIR`, verify: 47 sample requests; single run appears immediately; Single Send does not; Run All is one parent with ordered steps; two runs compare; pin survives retention; export contains no secrets; desktop and 390 px mobile widths have no horizontal overflow.

- [ ] **Step 7: Commit recovery and docs**

```powershell
git add backend/tests README.md docs
git commit -m "docs: add run history and recovery guide"
```
