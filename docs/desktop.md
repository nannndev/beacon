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

## Install a Release

Download the latest build from [GitHub Releases](https://github.com/nannndev/beacon/releases/latest):

- **Windows 10/11 x64:** run the `.exe` NSIS installer.
- **macOS Apple Silicon:** open the `.dmg` and drag Beacon into Applications.
- **Linux x64:** use the portable `.AppImage`, or install the `.deb` on Debian/Ubuntu.

The current macOS build is unsigned and is distributed directly, not through
the Mac App Store. On first launch, right-click **Beacon**, choose **Open**, and
confirm **Open** in the Gatekeeper dialog. Later launches can use the normal
double-click flow.

All packages include the frontend, FastAPI backend, and MCP server. End users
do not need Node.js, Python, Rust, or a hosted Beacon account.

## Building the Desktop App

### Prerequisites

- Rust (via rustup)
- Node.js + pnpm
- Python + pip

On macOS, install Apple's command-line developer tools first:

```bash
xcode-select --install
```

Then install the build dependencies:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-desktop.txt

cd ../frontend
npm install
```

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

### macOS build

Build on the Mac architecture you plan to distribute. An Apple Silicon Mac
produces an arm64 application; an Intel Mac produces an x86_64 application.
PyInstaller sidecars must be built on macOS, so a Windows-built `.exe` cannot
be reused.

```bash
cd frontend
BEACON_PYTHON=../backend/.venv/bin/python npm run desktop:build:mac
```

The distributable files are written to:

- `src-tauri/target/release/bundle/macos/Beacon.app`
- `src-tauri/target/release/bundle/dmg/Beacon_<version>_<arch>.dmg`

The public `.dmg` is currently unsigned. Developer ID signing, hardened
runtime, and Apple notarization remain the path to a smoother first-launch
experience when an organization-owned signing certificate is available.

### Linux build

Install the Tauri Linux prerequisites for your distribution first. On
Debian/Ubuntu, this includes WebKitGTK 4.1, AppIndicator, librsvg, and patchelf.
Then build both supported package formats:

```bash
cd frontend
BEACON_PYTHON=../backend/.venv/bin/python npm run desktop:build:linux
```

The distributable files are written to:

- `src-tauri/target/release/bundle/appimage/*.AppImage`
- `src-tauri/target/release/bundle/deb/*.deb`

## Running in Development

```bash
cd frontend
npm run tauri dev
```

This will open a native window with hot reload.

## Architecture

- **Frontend**: React + Vite (bundled into desktop)
- **Backend**: FastAPI (built with PyInstaller as `backend.exe`)
- **MCP Server**: Also bundled as `mcp_server.exe` sidecar (standard MCP, works with any client)
- The desktop app automatically starts the backend sidecar when launched.
- Open **MCP** in the app for easy registration with Claude or copy config for other clients.

See [MCP Server](/mcp) for full details.

Next: [Changelog](/changelog)
