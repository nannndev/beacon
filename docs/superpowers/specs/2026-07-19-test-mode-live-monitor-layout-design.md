# Test Mode and Live Monitor Layout Design

**Date:** 2026-07-19
**Status:** Approved direction; awaiting written-spec review
**Scope:** Current FastAPI + React frontend

## Goal

Improve the dashboard's horizontal balance and make live test behavior easier to understand. The Test Mode controls should use the available width symmetrically, while Live Monitor should present latency, throughput, and outcomes as one coherent operational view.

## Constraints

- Preserve the current Beacon dark visual language and existing shadcn primitives.
- Preserve all current modes, form behavior, run behavior, response inspection, logs, and export behavior.
- Do not change the REST/WebSocket contracts or either shared Python testing engine.
- Avoid a charting dependency; use lightweight React and SVG so the desktop bundle stays small.
- Keep controls usable with keyboard navigation and at narrow widths.

## Test Mode Layout

### Fluid parameter grid

`ModeParamsForm` will replace fixed-width, left-aligned flex rows with a fluid grid. Each parameter cell consumes an equal share of the available row:

- Five controls: five equal columns at wide desktop widths.
- Four controls: four equal columns.
- Two or three controls: two or three equal columns rather than leaving unused space on the right.
- Narrow screens: two columns, then one column only when the available width can no longer fit readable inputs.

The shared numeric-field primitive will become width-agnostic. Mode-specific width overrides such as `w-24` and `w-28` will be removed. Labels, input height, padding, and number typography remain consistent across modes.

### Toggle cells

Checkbox controls such as **No delay** will render as complete grid cells with the same height, border, background, and label rhythm as numeric inputs. This keeps the Load row visually symmetrical. Disabled Rate and Delay inputs retain visible disabled styling when No delay is active.

Fuzz field management and explanatory Scenario content remain specialized layouts beneath their primary parameter grids; they are not forced into numeric-field styling.

### Footer

The Target, Override, and estimated duration group stays on the left. Run All, Run, and Stop remain aligned on the right. The footer wraps in two logical groups rather than allowing individual controls to scatter across lines.

## Live Monitor Information Architecture

### Progress and primary metrics

The existing progress indicator remains at the top. Once data exists, the summary becomes six equal metric cells:

1. Attempts
2. Success rate, with the successful request count as secondary text
3. Current RPS
4. Average latency
5. P95 latency
6. Errors, with rate-limited responses as secondary warning text when present

This replaces the current split between four large stat cards and a second six-item metric row, reducing duplication and vertical noise.

### Operations chart

The primary chart combines two time-aligned series:

- Latency as a cyan SVG line.
- Throughput as subdued emerald bars behind the line.
- P95 latency as an amber dashed reference line.

The chart includes a compact legend, current time window, and accessible text summaries. SVG paths are presentation-only; metric values remain available as text outside the SVG.

The frontend will keep a bounded history of statistic snapshots for the active run. Instantaneous throughput is derived from the change in attempts divided by the change in elapsed time between snapshots. Invalid or zero-time deltas are ignored. Latency history and P95 are derived from the available response-time samples. History resets when a new run starts and is capped to prevent unbounded memory growth.

### Expandable chart

The chart header includes an **Expand chart** icon button:

- Default: the chart and outcome panel use a compact two-column layout suitable for their position below the endpoint list.
- Expanded: the chart spans the full Live Monitor width and grows to 336 px high; the outcome panel moves below it so no chart width is lost.
- Pressing the button again restores the compact layout.
- Expansion is local UI state and resets only when the component remounts; it does not affect run state.
- The button exposes an accessible label, visible focus state, tooltip, and `aria-expanded` value.
- The expansion is in-place, not a modal or browser fullscreen view, so responses and logs remain immediately reachable.

### Outcome panel

The right-side panel shows the status-code distribution using horizontal bars and exact counts. It also surfaces:

- Latest response status and latency.
- Slowest observed response attempt and latency when response data is available.
- A clear empty state before the first response.

In the expanded chart state or on narrow screens, the outcome panel moves below the chart and uses the full width.

### Responses and logs

The Responses and Logs tabs retain their current behavior and layout. This change does not alter response selection, follow-latest behavior, log filtering, export, or JSON inspection.

## Component Boundaries

- `ModeParamsForm.tsx`: responsive grid and shared field/toggle presentation.
- `ExecutionControls.tsx`: stable footer grouping and wrapping behavior.
- `LiveMonitor.tsx`: information hierarchy, expansion state, and composition.
- A focused chart utility/component module: bounded series creation, instantaneous RPS derivation, percentile calculation, and SVG point generation.

Pure calculations will be separated from React rendering so they can be tested without browser mocks.

## Responsive Behavior

- Wide desktop: parameter controls occupy one balanced row; chart and outcome panel use a roughly 3:1 split.
- Medium desktop/tablet: parameter controls use two columns and the chart/outcome pair stacks vertically.
- Narrow viewport: parameter controls become two columns, footer groups stack, and chart/outcome panel stack vertically.
- Expanded chart: always uses the full content width; its height is 260 px below the medium breakpoint to avoid trapping the page below the fold.

## Error and Empty States

- Missing or insufficient chart samples show a quiet “Waiting for live samples” state rather than a misleading flat line.
- P95 is omitted until at least five latency samples exist.
- Unknown status codes use the existing neutral color mapping.
- Derived throughput never displays `Infinity`, `NaN`, or negative values.

## Verification

- Unit tests for percentile calculation, snapshot-to-RPS derivation, bounded history, and insufficient-data behavior.
- TypeScript compilation and Vite production build.
- Visual verification at the wide desktop size represented in the provided screenshot and at narrow responsive widths.
- Interaction verification for Expand/Collapse, No delay disabled states, Run/Stop controls, response selection, and log tabs.
- Regression check that no backend or shared core-engine file changes are required.

## Out of Scope

- New backend metrics or WebSocket event formats.
- Persisting chart history across app restarts.
- Chart zoom, pan, brush selection, or data export beyond the existing run export.
- Redesigning the endpoint table, response viewer, logs, or overall application navigation.
