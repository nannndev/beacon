# Test Mode and Live Monitor Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a horizontally balanced Test Mode form and an expandable operations chart that combines live latency, throughput, and response outcomes.

**Architecture:** Keep backend contracts unchanged. Move chart math into a pure TypeScript module, render the monitor with lightweight SVG, and make form layout responsive through explicit Tailwind grid classes. Existing response/log behavior remains inside `LiveMonitor`.

**Tech Stack:** React 18, TypeScript 5.5, Tailwind CSS, shadcn primitives, Node 22 built-in test runner, Vite 5.

## Global Constraints

- Preserve the current Beacon dark visual language and existing shadcn primitives.
- Do not change the REST/WebSocket contracts or either shared Python testing engine.
- Do not add a charting dependency.
- Expanded chart height is 336 px on desktop and 260 px below the medium breakpoint.
- P95 is hidden until at least five latency samples exist.
- Preserve response selection, follow-latest, log filtering, export, and JSON inspection.

---

### Task 1: Chart metric calculations

**Files:**
- Create: `frontend/src/components/liveMonitorMetrics.ts`
- Create: `frontend/src/components/liveMonitorMetrics.test.ts`

**Interfaces:**
- Produces: `percentile(values, percentile)`, `deriveInstantRps(previous, current)`, `appendBounded(history, point, limit)`, `ChartPoint`, and `StatsSnapshot`.
- Consumes: numeric attempts, elapsed seconds, and latest latency from Live Monitor stats.

- [ ] **Step 1: Write failing tests**

Cover sorted and unsorted P95 values, fewer-than-five samples, zero elapsed delta, normal instantaneous RPS, negative values, and bounded history:

```ts
assert.equal(percentile([10, 20, 30, 40, 50], 0.95), 50)
assert.equal(percentile([10, 20, 30, 40], 0.95, 5), null)
assert.equal(deriveInstantRps({ attempts: 10, elapsed_s: 5 }, { attempts: 16, elapsed_s: 7 }), 3)
assert.equal(deriveInstantRps({ attempts: 10, elapsed_s: 5 }, { attempts: 11, elapsed_s: 5 }), null)
assert.deepEqual(appendBounded([1, 2, 3], 4, 3), [2, 3, 4])
```

- [ ] **Step 2: Verify tests fail**

Run: `node --experimental-strip-types --test src/components/liveMonitorMetrics.test.ts` from `frontend`.
Expected: FAIL because `liveMonitorMetrics.ts` does not exist.

- [ ] **Step 3: Implement pure calculations**

Use finite-number guards, nearest-rank percentile selection, non-negative deltas, one-decimal RPS rounding, and immutable history slicing. Return `null` for unavailable derived values.

- [ ] **Step 4: Verify tests pass**

Run the same Node test command.
Expected: all metric tests pass.

### Task 2: Symmetric Test Mode parameter grid

**Files:**
- Modify: `frontend/src/components/ModeParamsForm.tsx`
- Modify: `frontend/src/components/ExecutionControls.tsx`

**Interfaces:**
- Consumes: existing `ModeParams` values and callbacks without signature changes.
- Produces: equal-width responsive parameter cells and two stable footer groups.

- [ ] **Step 1: Add the responsive field shell**

Change numeric fields from fixed `w-24`/`w-28` wrappers to `min-w-0 w-full`. Add a shared grid shell with `grid grid-cols-2 gap-2 lg:grid-cols-N`, where N matches the primary control count for each mode. Render toggle controls as bordered field cells with the same vertical rhythm.

- [ ] **Step 2: Apply the shell to every mode**

Load uses five desktop columns; Ramp and Rate Probe use four; Soak, Fuzz, and Spike parameter groups use three; Benchmark uses two. Keep Fuzz field rows and Scenario explanatory content outside numeric grids.

- [ ] **Step 3: Stabilize the footer groups**

Wrap Target/Override/Estimate in one flex group and Run All/Run/Stop in a second `ml-auto` group. Allow only the groups to wrap on narrow widths.

- [ ] **Step 4: Compile the frontend**

Run: `npm run build` from `frontend`.
Expected: TypeScript and Vite complete with exit code 0.

### Task 3: Operations overview and expandable chart

**Files:**
- Create: `frontend/src/components/OperationsChart.tsx`
- Modify: `frontend/src/components/LiveMonitor.tsx`

**Interfaces:**
- `OperationsChart` consumes `{ points: ChartPoint[]; p95: number | null; expanded: boolean; onToggleExpanded(): void }`.
- `LiveMonitor` owns bounded chart history and passes existing `stats`/`responses` data to the chart and outcome panel.

- [ ] **Step 1: Build the SVG chart component**

Render emerald throughput bars, a cyan latency polyline, and an amber dashed P95 line in one responsive SVG. Use a 600×160 viewBox, preserve readable axes labels as external text, and render “Waiting for live samples” for fewer than two points. Set container heights to `h-[168px] md:h-[184px]` collapsed and `h-[260px] md:h-[336px]` expanded.

- [ ] **Step 2: Add accessible expansion control**

Use an icon-only shadcn Button with Expand/Minimize icons, `title`, `aria-label`, and `aria-expanded`. Expansion changes the parent layout from desktop `3:1` columns to one full-width column and places outcomes below.

- [ ] **Step 3: Replace duplicate summary rows**

Render six equal cells: Attempts, Success rate/count, Current RPS, Avg latency, P95 latency, and Errors/rate-limited. Show em dash for unavailable P95.

- [ ] **Step 4: Add bounded live history**

On each advancing stats snapshot, derive instantaneous RPS from the previous snapshot and append `{ attempt, elapsed, latency, rps }` to a maximum 180-point history. Reset history and previous snapshot when status transitions into `running` for a new run.

- [ ] **Step 5: Add outcome details**

Reuse status-code colors in horizontal distribution rows. Show latest response status/latency and the slowest response attempt/latency. Provide an empty state before responses arrive.

- [ ] **Step 6: Preserve response and log panels**

Leave Tabs, response following, JSON editor, log filters, exports, and callbacks unchanged below the new monitoring summary.

### Task 4: Regression verification

**Files:**
- Existing test: `frontend/src/hooks/runPayload.test.ts`
- Test: `frontend/src/components/liveMonitorMetrics.test.ts`

- [ ] **Step 1: Run all focused Node tests**

Run:

```powershell
node --experimental-strip-types --test src/hooks/runPayload.test.ts src/components/liveMonitorMetrics.test.ts
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run production build**

Run: `npm run build` from `frontend`.
Expected: TypeScript and Vite exit 0.

- [ ] **Step 3: Inspect diff and scope**

Run: `git diff --check` and `git status --short`.
Expected: no whitespace errors; `.superpowers/` remains untracked and is not staged; no backend or core tester file changed.

### Task 5: Commit and publish

**Files:**
- Stage only the design, plan, frontend implementation, and frontend tests.
- Exclude: `.superpowers/` mockup session files.

- [ ] **Step 1: Stage explicit paths**

```powershell
git add -- docs/superpowers/specs/2026-07-19-test-mode-live-monitor-layout-design.md docs/superpowers/plans/2026-07-19-test-mode-live-monitor-layout.md frontend/src/components/ModeParamsForm.tsx frontend/src/components/ExecutionControls.tsx frontend/src/components/LiveMonitor.tsx frontend/src/components/OperationsChart.tsx frontend/src/components/liveMonitorMetrics.ts frontend/src/components/liveMonitorMetrics.test.ts frontend/src/hooks/useRun.ts frontend/src/hooks/runPayload.ts frontend/src/hooks/runPayload.test.ts
```

- [ ] **Step 2: Commit intended changes**

Run: `git commit -m "feat: improve test controls and live monitoring"`.
Expected: one implementation commit on `codex/test-mode-live-monitor` (the design commit is already its parent).

- [ ] **Step 3: Push branch**

Run: `git push -u origin codex/test-mode-live-monitor`.
Expected: branch tracks `origin/codex/test-mode-live-monitor`.

- [ ] **Step 4: Open draft PR**

Create a draft PR targeting the remote default branch with a body covering the Run All payload fix, symmetric Test Mode controls, operations chart, expandable state, and verification evidence.
