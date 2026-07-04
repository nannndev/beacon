# Building Desktop from Source

See the main [Desktop](/desktop) page for overview.

## Full Build Steps (Windows example)

```bash
# 1. Install Rust
# https://rustup.rs/

# 2. Install Python dependencies + PyInstaller
cd backend
pip install -r requirements.txt
pip install pyinstaller

# 3. Build backend + mcp_server sidecars and stage them for Tauri
cd ../frontend
npm run desktop:prepare

# 4. Build the Tauri app
npm run tauri:build
```

> **Order matters.** Always run `desktop:prepare` before `tauri:build` (or a
> raw `cargo build`) — including on a clean checkout / in CI. `desktop:prepare`
> PyInstaller-builds both `backend` and `mcp_server` and copies them to
> `src-tauri/<name>-<triple>.exe`. Tauri v2's `bundle.externalBin` lists both
> sidecars, so if either binary is missing when `cargo build` runs, the build
> **fails hard** rather than just warning.

## Output Location

The final executable will be located at:

```
frontend/src-tauri/target/release/
```

## Development

```bash
cd frontend
npm run tauri dev
```

This opens a native window with hot reload.
