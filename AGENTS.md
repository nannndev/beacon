# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) and AI agents when working with code in this repository.

## What this is

A dynamic API endpoint tester / load + rate-limit testing tool with an embedded AI Gateway and autonomous AI Copilot. The user defines endpoints (URL, method, headers, payload) and fires them repeatedly and/or concurrently, watching live stats (`attempts`, `success`, `rate_limited`, `errors`) and logs. Payloads/headers/URLs support `{{variable}}` templating with both static config variables and fresh-per-request generators.

## Current implementation

Beacon's application is an ultra-fast, native Rust + React/Tauri desktop stack:

- `crates/beacon-core/` — core request execution engine, templating, assertions, extractors, metrics.
- `crates/beacon-gateway/` — unified AI Gateway (Rusqlite, AES-256-GCM cipher, 21 API key + 8 OAuth providers, auto-fallback chains, format translation).
- `crates/beacon-agent/` — Beacon AI Copilot persona, SSE streaming, 11 agent tools.
- `crates/beacon-server/` — Axum + Tokio backend daemon on port 8000 (REST, WebSockets, background run coordinator).
- `crates/beacon-mcp/` — native stdio JSON-RPC 2.0 MCP server for external agents.
- `crates/beacon-cli/` — standalone headless CLI.
- `frontend/` — React/Vite/shadcn/Tailwind frontend on port 5173, bundled via Tauri v2.

The Python backend has been completely replaced by the Rust workspace. Do not reintroduce Python backend code.

## Running

### Rust backend (Axum)
```bash
cargo run -p beacon-server --release
# Or debug mode:
cargo run -p beacon-server
```
Runs by default on port `8000`. Port can be customized via `PORT=8000` or `--port 8000`.

### React frontend
```bash
cd frontend
pnpm install
pnpm run dev      # http://localhost:5173
pnpm run build    # tsc typecheck + vite build
```
The frontend connects to the backend at `http://localhost:8000` (see [frontend/src/App.tsx](frontend/src/App.tsx)).

### Packaging desktop app (Tauri v2)
```bash
cd frontend
pnpm run desktop:build
```
`scripts/prepare-desktop.cjs` compiles native Rust release binaries (`backend`, `mcp_server`, `beacon_cli`) using Cargo and stages them into `frontend/src-tauri/` automatically.

### Running tests
```bash
cargo test --workspace
```
Runs unit tests and API parity integration tests across all crates.

## Config persistence

The backend persists state to `config/tests.json` and `config/gateway.db` (with encryption key in `config/gateway.key`). Config remains the source of truth and mutations are atomic.

## Core engine architecture (`crates/beacon-core/`)

- **`models.rs`** — `EndpointTest` and `TestConfig`, JSON serialization/deserialization.
- **`templating.rs`** — recursive static-variable and fresh-per-request generator resolution.
- **`transport.rs`** — construction and dispatch of HTTP requests for JSON, form, multipart, raw, and web targets.
- **`assertions.rs`** — response assertion evaluation (dot-path JSON, regex, headers, status).
- **`extractors.rs`** — response body/cookie extraction into runtime variables.
- **`metrics.rs`** — thread-safe run counters, latency samples (`p50`, `p75`, `p90`, `p95`, `p99`), and snapshots.
- **`tester.rs`** — `APITester` orchestration, single request execution, and concurrent batch load testing.

### Templating
`{{...}}` tokens are resolved in two passes inside every string (and recursively through dicts/lists):
1. **Static** — `config.variables` keys are literal string-replaced first.
2. **Dynamic generators** — regex-matched and regenerated **fresh per request**: `random_email`, `random_phone` (Indonesian `+62812…` format), `random_uuid`/`uuid`, `timestamp`, `random_string` / `random_string:<len>`, `random_number`/`random_int` / `random_int:<min>:<max>`. Unknown tokens are left intact as `{{token}}`.

### Extractors (token refresh)
After a successful (2xx) response, `extractors` (e.g. `{"access_token": "body.access_token"}`) pull values out of the JSON body (dot-path) or `Set-Cookie` header and **write them back into `config.variables`**, so chained runs (login → use token) stay fresh.

## Security note
`config/tests.json`, `config/gateway.db`, and `config/gateway.key` can hold **live tokens, passwords, and API keys**. Treat them as secrets — do not commit real credentials to version control.
