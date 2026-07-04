# Desktop App

Beacon has full desktop support powered by **Tauri**.

## Why Desktop?

- Works with local/private networks
- Direct filesystem access for projects
- Better performance for large collections
- Can run completely offline

## Current Status

Desktop support is **fully implemented** using:

- Tauri v2 (Rust + Webview)
- Same React frontend
- Python backend as sidecar

## Building the Desktop App

### Prerequisites

- Rust (via rustup)
- Node.js + pnpm
- Python + pip

### Build Steps

```bash
cd frontend
npm run desktop:prepare   # PyInstaller-builds backend + mcp_server, copies both sidecars
npm run tauri:build       # or: npm run desktop:build to run both steps together
```

> **Order matters.** `desktop:prepare` must run — and succeed — *before*
> `tauri:build` (or a raw `cargo build`). Tauri v2 treats a missing
> `externalBin` sidecar (`backend-<triple>.exe` / `mcp_server-<triple>.exe`) as
> a **hard build error**, not a warning, since both are now declared in
> `tauri.conf.json`'s `bundle.externalBin`. On a clean checkout or in CI,
> `desktop:prepare` has never run yet, so skipping it fails the build.

The final executable will be in:
`frontend/src-tauri/target/release/`

## Running in Development

```bash
cd frontend
npm run tauri dev
```

This will open a native window with hot reload.

## Architecture

- **Frontend**: React + Vite (bundled into desktop)
- **Backend**: FastAPI (built with PyInstaller as `backend.exe`)
- The desktop app automatically starts the backend sidecar when launched.

Next: [Changelog](/changelog)
