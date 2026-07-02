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

# 1. Build the Python backend as sidecar
cd ../backend
python build_backend.py

# 2. Copy the binary (Windows example)
copy dist\backend.exe ..\frontend\src-tauri\backend.exe

# 3. Build the desktop app
cd ../frontend
npm run desktop:build
```

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
