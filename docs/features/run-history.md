# Run History

Beacon saves privacy-safe metrics for test executions so results can be
inspected after the Live Monitor closes and compared across changes.

## What Is Saved

Run History captures endpoint, folder, Run All, scenario, and MCP
`run_endpoint` / `run_scenario` executions. **Single Send** and MCP
`send_request` are intentionally excluded because they are debugging and
inspection actions rather than test runs.

Each saved run contains:

- Project, endpoint, and URL-template snapshots
- Test mode and allowlisted execution settings
- Attempts, success, rate-limit, and error totals
- Throughput and latency summaries (P50, P95, and P99)
- Up to 300 chart samples and 200 structured outcome events
- Ordered steps for folders, Run All, and scenarios

One user action creates one visible history entry. A multi-endpoint run is
represented as one parent with ordered steps.

## Browse and Compare

Open **Run History** from the sidebar. The desktop layout uses a split list and
detail workspace; smaller screens move from list to detail. Filter by project,
mode, status, pinned state, date, or search text.

Select one run to inspect it. Select exactly two comparison checkboxes to use
the first as the baseline and the second as the candidate. Beacon understands
metric direction: lower latency/errors/rate limits and higher success/RPS are
shown as improvements. Raw values and signed changes are always displayed next
to color, and runs of different modes are clearly identified.

Latency and throughput charts can be expanded to fill the window.

## Retention and Pinning

Beacon retains the latest 100 unpinned runs per project. Pinned runs are exempt
from automatic retention. Project deletion does not silently remove its
historical run snapshots.

Run deletion is permanent and requires confirmation in the UI. Exports use the
sanitized `beacon.run-history` JSON format.

## Privacy

Run History never stores:

- Resolved URLs or variable values
- Request payloads or response bodies
- Request or response headers, including authorization, cookies, and API keys
- Extracted tokens
- Full exception objects or stack traces

Error events store only a normalized category such as timeout, TLS, connection,
or request error. Export applies a second allowlist projection.

## Local Database and Recovery

Desktop data is stored at `<BEACON_DATA_DIR>/history.db`. Web development falls
back to `config/history.db` relative to the backend working directory. SQLite
uses WAL mode, foreign keys, and a five-second busy timeout.

Runs left active by an app interruption are marked **interrupted** at the next
startup. A history database failure never blocks endpoint editing, Single Send,
or live test execution. If the database is unavailable, History shows a
recovery screen while the rest of Beacon continues working.

**Reset History Database** requires typing the exact confirmation
`RESET HISTORY`. Beacon preserves the unavailable database as a timestamped
backup before initializing a fresh schema; project JSON is never touched.

Version 1 is local-only. Stable workspace/device IDs and revision fields are
included for a future, separately designed team-sync system; no history data is
uploaded today.
