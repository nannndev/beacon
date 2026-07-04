# Desktop MCP Bundling & Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Beacon MCP server as a bundled standalone binary in the desktop installer, with a Settings panel to register/unregister it with Claude Desktop and Claude Code (and copy a config snippet for any other MCP client).

**Architecture:** Add a second PyInstaller binary (`mcp_server`) alongside the existing `backend` sidecar. Tauri stages it to a stable per-user path on startup. New Rust commands do merge-safe registration into `claude_desktop_config.json` and shell out to `claude mcp` for Claude Code. A desktop-only React dialog drives it all via `invoke()`.

**Tech Stack:** PyInstaller, Tauri v2 (Rust), `tauri-plugin-shell`, `serde_json`, React + shadcn/ui, `@tauri-apps/api/core`.

## Global Constraints

- MCP transport is **stdio only**, spawned per-client on demand. Do NOT add an always-on MCP process.
- Merge, never clobber: registration touches only the `mcpServers.beacon` key. If a client config file is unparseable, **refuse to write** and return an error.
- Staged binary path must be **stable across app updates**: `app_data_dir()/mcp_server[.exe]` (same dir the backend already uses via `BEACON_DATA_DIR`).
- No Python required on the user's machine — the binary is fully standalone.
- All new frontend UI is gated behind `isDesktop()` from `frontend/src/lib/platform.ts`.
- Windows is the verified shipping target (`tauri.conf.json` bundles `nsis`). macOS/Linux paths are implemented for parity but not verified this pass.
- Bundle identifier is `com.beacon.app`; `app_data_dir()` resolves to `%APPDATA%\com.beacon.app` on Windows.

---

### Task 1: MCP PyInstaller entrypoint + spec + build wiring

Mirror the backend's packaging. The MCP server uses package-relative imports
(`from .core.tester import ...`), so — exactly like the backend — it needs a
top-level launcher module that imports via absolute package paths, then a spec
and a build step.

**Files:**
- Create: `backend/run_mcp.py`
- Create: `backend/mcp_server.spec`
- Modify: `backend/build_backend.py`
- Reference (do not modify): `backend/run.py`, `backend/backend.spec`, `backend/app/mcp_server.py:355-364`

**Interfaces:**
- Produces: a build that emits `backend/dist/mcp_server[.exe]` when `build_backend.py` runs.
- Consumes: `backend/app/mcp_server.py`'s `main()` function (already exists at line 355).

- [ ] **Step 1: Create the PyInstaller entrypoint launcher**

`backend/run_mcp.py`:

```python
"""PyInstaller entry point for the packaged MCP server.

`app/mcp_server.py` uses package-relative imports (`from .core.tester import
...`), which fail when PyInstaller runs a module directly as a top-level
script. This launcher sits at the backend root and imports via absolute
package imports instead, then starts the MCP server (stdio transport by
default; BEACON_MCP_TRANSPORT can override). Storage path comes from the
BEACON_DATA_DIR env var the Tauri shell / client config injects.
"""
from app.mcp_server import main

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify the launcher runs the server (stdio waits on stdin — a clean 2s timeout means success)**

Run (from `backend/`, with deps installed):
```bash
python -c "import run_mcp; print('import ok')"
```
Expected: prints `import ok` with no ImportError. (Full `python run_mcp.py` would block on stdio waiting for an MCP client — the import check is the fast proof the entrypoint wiring is correct.)

- [ ] **Step 3: Create the PyInstaller spec**

`backend/mcp_server.spec` (mirror of `backend.spec`, entrypoint `run_mcp.py`, name `mcp_server`, no uvicorn hidden-imports since MCP stdio doesn't need them):

```python
# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['run_mcp.py'],
    pathex=[],
    binaries=[],
    datas=[('app', 'app')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='mcp_server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
```

- [ ] **Step 4: Extend build_backend.py to build both binaries**

Modify `backend/build_backend.py` — after the existing backend build block, add a second PyInstaller run for the MCP server:

```python
import os

import PyInstaller.__main__

if __name__ == "__main__":
    PyInstaller.__main__.run([
        "run.py",
        "--onefile",
        "--name", "backend",
        "--clean",
        "--noconfirm",
        "--log-level", "INFO",
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.loops",
        "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols",
        "--hidden-import", "uvicorn.protocols.http",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan",
        "--hidden-import", "uvicorn.lifespan.on",
        "--add-data", f"app{os.pathsep}app",
    ])

    PyInstaller.__main__.run([
        "run_mcp.py",
        "--onefile",
        "--name", "mcp_server",
        "--clean",
        "--noconfirm",
        "--log-level", "INFO",
        "--add-data", f"app{os.pathsep}app",
    ])

    print("\nBackend + MCP server built as dist/backend and dist/mcp_server")
    print("(.exe on Windows). Run `npm run desktop:prepare` from frontend/ to")
    print("copy them into src-tauri/ with the required <target-triple> suffix.")
```

- [ ] **Step 5: Run the full build and confirm both binaries exist**

Run (from `backend/`):
```bash
python build_backend.py
```
Expected: completes without error; both `dist/backend.exe` and `dist/mcp_server.exe` exist (`.exe` on Windows).

Verify:
```bash
ls dist/
```
Expected: lists `backend.exe` and `mcp_server.exe`.

- [ ] **Step 6: Commit**

```bash
git add backend/run_mcp.py backend/mcp_server.spec backend/build_backend.py
git commit -m "feat(desktop): build MCP server as standalone PyInstaller binary"
```

---

### Task 2: Copy MCP binary into Tauri + declare as externalBin

Extend the prepare-desktop script to copy the new binary with the required
target-triple suffix, and register it in the Tauri bundle config.

**Files:**
- Modify: `frontend/scripts/prepare-desktop.cjs`
- Modify: `frontend/src-tauri/tauri.conf.json:42-44`

**Interfaces:**
- Consumes: `backend/dist/mcp_server[.exe]` from Task 1.
- Produces: `frontend/src-tauri/mcp_server-<triple>[.exe]` and an `externalBin` entry named `mcp_server`.

- [ ] **Step 1: Add the MCP binary copy to prepare-desktop.cjs**

Modify `frontend/scripts/prepare-desktop.cjs` — after the existing backend copy (the block ending at the `console.log('Copied ...')` line, ~line 58), add:

```javascript
// Second sidecar: the MCP server binary (same triple-suffix convention).
const mcpSrcName = isWindows ? 'mcp_server.exe' : 'mcp_server';
const mcpDestName = isWindows ? `mcp_server-${triple}.exe` : `mcp_server-${triple}`;
const mcpSrcBinary = path.join(distDir, mcpSrcName);
const mcpDestBinary = path.join(tauriDir, mcpDestName);

if (!fs.existsSync(mcpSrcBinary)) {
  console.error(`MCP server binary not found at ${mcpSrcBinary}`);
  process.exit(1);
}

fs.copyFileSync(mcpSrcBinary, mcpDestBinary);
console.log(`Copied ${mcpSrcName} -> ${mcpDestBinary}`);
```

- [ ] **Step 2: Add mcp_server to externalBin in tauri.conf.json**

Modify `frontend/src-tauri/tauri.conf.json` — change the `externalBin` array:

```json
    "externalBin": [
      "backend",
      "mcp_server"
    ],
```

- [ ] **Step 3: Run prepare and confirm the triple-suffixed binary lands**

Run (from `frontend/`):
```bash
npm run desktop:prepare
```
Expected: prints both `Copied backend.exe -> ...` and `Copied mcp_server.exe -> ...`.

Verify (from repo root):
```bash
ls frontend/src-tauri/ | grep mcp_server
```
Expected: a file like `mcp_server-x86_64-pc-windows-msvc.exe`.

- [ ] **Step 4: Commit**

```bash
git add frontend/scripts/prepare-desktop.cjs frontend/src-tauri/tauri.conf.json
git commit -m "feat(desktop): bundle mcp_server binary as second sidecar"
```

---

### Task 3: Stage the MCP binary to a stable path + expose its path

On startup, copy the bundled MCP binary to the per-user data dir (stable across
updates) and expose that path to the frontend. The binary is NOT spawned —
stdio clients launch it themselves.

**Files:**
- Modify: `frontend/src-tauri/src/main.rs`
- Reference: `frontend/src-tauri/src/main.rs:39-64` (existing setup block, data_dir + sidecar)

**Interfaces:**
- Consumes: the `mcp_server` externalBin from Task 2; `app.path().app_data_dir()` (already used at main.rs:45-48).
- Produces: Tauri command `mcp_server_path() -> String` returning the staged absolute path (used by Task 4 & the frontend in Task 6).

- [ ] **Step 1: Add a helper to resolve where Tauri placed the bundled sidecar**

Modify `frontend/src-tauri/src/main.rs` — add near the top (after the existing `use` statements):

```rust
use std::path::PathBuf;

/// The sidecar binary name Tauri resolves at runtime (no triple suffix — Tauri
/// strips it and appends the OS extension). Matches `externalBin` in
/// tauri.conf.json.
#[cfg(windows)]
const MCP_BINARY_NAME: &str = "mcp_server.exe";
#[cfg(not(windows))]
const MCP_BINARY_NAME: &str = "mcp_server";

/// Absolute path where we stage the MCP binary for stdio clients to launch.
/// Stored in a Tauri-managed state so the command can return it.
struct McpServerPath(Mutex<PathBuf>);
```

- [ ] **Step 2: Add the staging logic + command**

Modify `frontend/src-tauri/src/main.rs` — inside `setup()`, after the `data_dir` is created (after line 49 `std::fs::create_dir_all(&data_dir).ok();`), add:

```rust
            // Stage the bundled MCP server binary to a STABLE per-user path so
            // a config entry registered once keeps working across app updates.
            // stdio MCP clients (Claude Desktop/Code/etc.) launch it themselves;
            // we do NOT spawn it here.
            let staged_mcp = data_dir.join(MCP_BINARY_NAME);
            if let Ok(resource_dir) = app.path().resource_dir() {
                let bundled = resource_dir.join(MCP_BINARY_NAME);
                if bundled.exists() {
                    // Copy if missing or the bundled one is a different size
                    // (cheap "did it change across an update" check).
                    let needs_copy = match (std::fs::metadata(&bundled), std::fs::metadata(&staged_mcp)) {
                        (Ok(b), Ok(s)) => b.len() != s.len(),
                        _ => true,
                    };
                    if needs_copy {
                        let _ = std::fs::copy(&bundled, &staged_mcp);
                    }
                }
            }
            app.manage(McpServerPath(Mutex::new(staged_mcp)));
```

Then add the command function (near `backend_port`, after line 20):

```rust
#[tauri::command]
fn mcp_server_path(state: State<McpServerPath>) -> String {
    state.0.lock().unwrap().to_string_lossy().to_string()
}
```

- [ ] **Step 3: Register the command in the handler**

Modify `frontend/src-tauri/src/main.rs:38` — extend `generate_handler!`:

```rust
        .invoke_handler(tauri::generate_handler![backend_port, mcp_server_path])
```

- [ ] **Step 4: Build the Rust layer to confirm it compiles**

Run (from `frontend/src-tauri/`):
```bash
cargo build
```
Expected: compiles with no errors. (Warnings about the bundled binary not existing at dev time are fine — staging is a runtime no-op when the resource is absent.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src-tauri/src/main.rs
git commit -m "feat(desktop): stage MCP binary to stable path + expose mcp_server_path"
```

---

### Task 4: Rust registration module — pure JSON merge/remove (unit-tested)

The only logic worth automated testing: merging/removing Beacon's entry in a
client config JSON without disturbing other keys. Written as pure functions.

**Files:**
- Create: `frontend/src-tauri/src/mcp_registration.rs`
- Modify: `frontend/src-tauri/src/main.rs` (add `mod mcp_registration;`)

**Interfaces:**
- Produces (used by Task 5): `merge_beacon_entry(config: &str, binary_path: &str) -> Result<String, String>` and `remove_beacon_entry(config: &str) -> Result<String, String>`, plus `beacon_is_registered(config: &str) -> bool`.
- Consumes: `serde_json` (already in Cargo.toml:15).

- [ ] **Step 1: Write failing unit tests**

Create `frontend/src-tauri/src/mcp_registration.rs`:

```rust
//! Pure, I/O-free logic for editing a client's MCP config JSON. The command
//! layer (in main.rs) reads/writes files; these functions only transform the
//! JSON string, so they are unit-testable and can never clobber a file.

use serde_json::{json, Value};

/// Insert or replace the `mcpServers.beacon` entry, preserving every other key.
/// Returns pretty-printed JSON. Errors if the input is present but not valid
/// JSON (caller must refuse to write in that case).
pub fn merge_beacon_entry(config: &str, binary_path: &str) -> Result<String, String> {
    let mut root: Value = if config.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(config).map_err(|e| format!("config is not valid JSON: {e}"))?
    };
    if !root.is_object() {
        return Err("config root is not a JSON object".into());
    }
    let obj = root.as_object_mut().unwrap();
    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| json!({}));
    if !servers.is_object() {
        return Err("mcpServers is not a JSON object".into());
    }
    servers.as_object_mut().unwrap().insert(
        "beacon".to_string(),
        json!({ "command": binary_path, "args": [] }),
    );
    serde_json::to_string_pretty(&root).map_err(|e| e.to_string())
}

/// Remove only the `mcpServers.beacon` entry, leaving all else intact.
pub fn remove_beacon_entry(config: &str) -> Result<String, String> {
    if config.trim().is_empty() {
        return Ok("{}".to_string());
    }
    let mut root: Value =
        serde_json::from_str(config).map_err(|e| format!("config is not valid JSON: {e}"))?;
    if let Some(servers) = root.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        servers.remove("beacon");
    }
    serde_json::to_string_pretty(&root).map_err(|e| e.to_string())
}

/// True if the config already has an `mcpServers.beacon` entry.
pub fn beacon_is_registered(config: &str) -> bool {
    serde_json::from_str::<Value>(config)
        .ok()
        .and_then(|v| v.get("mcpServers").and_then(|s| s.get("beacon")).cloned())
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn merges_into_empty_config() {
        let out = merge_beacon_entry("", "C:/beacon/mcp_server.exe").unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["mcpServers"]["beacon"]["command"], "C:/beacon/mcp_server.exe");
    }

    #[test]
    fn preserves_other_servers() {
        let existing = r#"{"mcpServers":{"other":{"command":"foo"}}}"#;
        let out = merge_beacon_entry(existing, "bpath").unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["mcpServers"]["other"]["command"], "foo");
        assert_eq!(v["mcpServers"]["beacon"]["command"], "bpath");
    }

    #[test]
    fn replaces_existing_beacon_not_duplicate() {
        let existing = r#"{"mcpServers":{"beacon":{"command":"old"}}}"#;
        let out = merge_beacon_entry(existing, "new").unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["mcpServers"]["beacon"]["command"], "new");
        assert_eq!(v["mcpServers"].as_object().unwrap().len(), 1);
    }

    #[test]
    fn preserves_unrelated_top_level_keys() {
        let existing = r#"{"theme":"dark","mcpServers":{}}"#;
        let out = merge_beacon_entry(existing, "b").unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["theme"], "dark");
    }

    #[test]
    fn errors_on_corrupt_json() {
        assert!(merge_beacon_entry("{not json", "b").is_err());
    }

    #[test]
    fn remove_takes_out_only_beacon() {
        let existing = r#"{"mcpServers":{"beacon":{"command":"b"},"other":{"command":"o"}}}"#;
        let out = remove_beacon_entry(existing).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(v["mcpServers"].get("beacon").is_none());
        assert_eq!(v["mcpServers"]["other"]["command"], "o");
    }

    #[test]
    fn is_registered_detects_presence() {
        assert!(beacon_is_registered(r#"{"mcpServers":{"beacon":{}}}"#));
        assert!(!beacon_is_registered(r#"{"mcpServers":{}}"#));
        assert!(!beacon_is_registered("garbage"));
    }
}
```

- [ ] **Step 2: Declare the module in main.rs**

Modify `frontend/src-tauri/src/main.rs` — add after the `#![cfg_attr(...)]` line at the top:

```rust
mod mcp_registration;
```

- [ ] **Step 3: Run the tests — expect them to pass**

Run (from `frontend/src-tauri/`):
```bash
cargo test mcp_registration
```
Expected: all 7 tests PASS. (These are TDD tests whose implementation is written in the same file; if any fail, fix the pure functions until green.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src-tauri/src/mcp_registration.rs frontend/src-tauri/src/main.rs
git commit -m "feat(desktop): merge-safe MCP config edit functions + unit tests"
```

---

### Task 5: Rust commands — status, register/unregister for both clients

Wrap the pure functions with file I/O and CLI calls, exposed as Tauri commands.

**Files:**
- Modify: `frontend/src-tauri/src/mcp_registration.rs` (add command fns + path resolution)
- Modify: `frontend/src-tauri/src/main.rs` (register commands in handler)

**Interfaces:**
- Consumes: `merge_beacon_entry` / `remove_beacon_entry` / `beacon_is_registered` (Task 4); `mcp_server_path` state (Task 3); `tauri-plugin-shell` for `claude` CLI.
- Produces (used by Task 6): commands `mcp_status() -> McpStatus`, `mcp_register_claude_desktop()`, `mcp_unregister_claude_desktop()`, `mcp_register_claude_code()`, `mcp_unregister_claude_code()`. `McpStatus` is `{ claude_desktop: String, claude_code: String }` where values are `"registered" | "not_registered" | "config_not_found" | "cli_missing"`.

- [ ] **Step 1: Add config-path resolution + status/register/unregister commands**

Modify `frontend/src-tauri/src/mcp_registration.rs` — append (before the `#[cfg(test)]` block):

```rust
use std::path::PathBuf;
use serde::Serialize;
use tauri::{Manager, State};
use tauri_plugin_shell::ShellExt;

use crate::McpServerPath;

#[derive(Serialize)]
pub struct McpStatus {
    pub claude_desktop: String,
    pub claude_code: String,
}

/// Locate Claude Desktop's config file per-OS. Returns the path even if it
/// doesn't exist yet (caller decides whether to create it).
fn claude_desktop_config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let base = app.path().app_config_dir().ok()?; // %APPDATA% / ~/Library/Application Support / ~/.config
    // app_config_dir() is Beacon's own dir; we want the sibling "Claude" dir.
    let parent = base.parent()?;
    Some(parent.join("Claude").join("claude_desktop_config.json"))
}

#[tauri::command]
pub fn mcp_status(app: tauri::AppHandle) -> McpStatus {
    // Claude Desktop
    let claude_desktop = match claude_desktop_config_path(&app) {
        Some(p) if p.exists() => match std::fs::read_to_string(&p) {
            Ok(s) if beacon_is_registered(&s) => "registered",
            Ok(_) => "not_registered",
            Err(_) => "config_not_found",
        },
        _ => "config_not_found",
    }
    .to_string();

    // Claude Code: `claude mcp list` and look for a "beacon" line.
    let claude_code = match std::process::Command::new("claude")
        .args(["mcp", "list"])
        .output()
    {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            if text.lines().any(|l| l.trim_start().to_lowercase().starts_with("beacon")) {
                "registered"
            } else {
                "not_registered"
            }
        }
        Err(_) => "cli_missing",
    }
    .to_string();

    McpStatus { claude_desktop, claude_code }
}

#[tauri::command]
pub fn mcp_register_claude_desktop(
    app: tauri::AppHandle,
    mcp_path: State<McpServerPath>,
) -> Result<(), String> {
    let path = claude_desktop_config_path(&app).ok_or("could not resolve Claude config path")?;
    let binary = mcp_path.0.lock().unwrap().to_string_lossy().to_string();
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let merged = merge_beacon_entry(&existing, &binary)?; // refuses on corrupt JSON
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, merged).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mcp_unregister_claude_desktop(app: tauri::AppHandle) -> Result<(), String> {
    let path = claude_desktop_config_path(&app).ok_or("could not resolve Claude config path")?;
    if !path.exists() {
        return Ok(());
    }
    let existing = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let updated = remove_beacon_entry(&existing)?;
    std::fs::write(&path, updated).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_register_claude_code(
    app: tauri::AppHandle,
    mcp_path: State<'_, McpServerPath>,
) -> Result<(), String> {
    let binary = mcp_path.0.lock().unwrap().to_string_lossy().to_string();
    let output = app
        .shell()
        .command("claude")
        .args(["mcp", "add", "beacon", "--", &binary])
        .output()
        .await
        .map_err(|_| "Claude Code CLI not installed".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn mcp_unregister_claude_code(app: tauri::AppHandle) -> Result<(), String> {
    let output = app
        .shell()
        .command("claude")
        .args(["mcp", "remove", "beacon"])
        .output()
        .await
        .map_err(|_| "Claude Code CLI not installed".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
```

- [ ] **Step 2: Register the commands in main.rs**

Modify `frontend/src-tauri/src/main.rs` — extend `generate_handler!`:

```rust
        .invoke_handler(tauri::generate_handler![
            backend_port,
            mcp_server_path,
            mcp_registration::mcp_status,
            mcp_registration::mcp_register_claude_desktop,
            mcp_registration::mcp_unregister_claude_desktop,
            mcp_registration::mcp_register_claude_code,
            mcp_registration::mcp_unregister_claude_code
        ])
```

- [ ] **Step 3: Confirm it compiles and unit tests still pass**

Run (from `frontend/src-tauri/`):
```bash
cargo build && cargo test mcp_registration
```
Expected: compiles; all 7 pure-function tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src-tauri/src/mcp_registration.rs frontend/src-tauri/src/main.rs
git commit -m "feat(desktop): MCP status + register/unregister commands for Claude clients"
```

---

### Task 6: Frontend — typed invoke wrappers for the MCP commands

A thin, desktop-guarded module so the dialog never touches `invoke` directly.

**Files:**
- Create: `frontend/src/lib/mcp.ts`
- Reference: `frontend/src/lib/api.ts:16-24` (invoke import pattern), `frontend/src/lib/platform.ts`

**Interfaces:**
- Consumes: Tauri commands from Task 5; `isDesktop()` from platform.ts.
- Produces (used by Task 7): `getMcpStatus(): Promise<McpStatus>`, `getMcpServerPath(): Promise<string>`, `registerClaudeDesktop()`, `unregisterClaudeDesktop()`, `registerClaudeCode()`, `unregisterClaudeCode()` — all `Promise`-returning; register/unregister resolve void or throw the Rust error string. `McpStatus = { claude_desktop: ClientState; claude_code: ClientState }`, `ClientState = 'registered' | 'not_registered' | 'config_not_found' | 'cli_missing'`.

- [ ] **Step 1: Write the wrapper module**

Create `frontend/src/lib/mcp.ts`:

```ts
// Desktop-only wrappers around the Tauri MCP registration commands.
// Guarded by isDesktop(); calling on web throws (the dialog is never shown there).
import { isDesktop } from './platform'

export type ClientState =
  | 'registered'
  | 'not_registered'
  | 'config_not_found'
  | 'cli_missing'

export interface McpStatus {
  claude_desktop: ClientState
  claude_code: ClientState
}

async function invoker() {
  if (!isDesktop()) throw new Error('MCP registration is desktop-only')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke
}

export async function getMcpStatus(): Promise<McpStatus> {
  const invoke = await invoker()
  return invoke<McpStatus>('mcp_status')
}

export async function getMcpServerPath(): Promise<string> {
  const invoke = await invoker()
  return invoke<string>('mcp_server_path')
}

export async function registerClaudeDesktop(): Promise<void> {
  const invoke = await invoker()
  await invoke('mcp_register_claude_desktop')
}

export async function unregisterClaudeDesktop(): Promise<void> {
  const invoke = await invoker()
  await invoke('mcp_unregister_claude_desktop')
}

export async function registerClaudeCode(): Promise<void> {
  const invoke = await invoker()
  await invoke('mcp_register_claude_code')
}

export async function unregisterClaudeCode(): Promise<void> {
  const invoke = await invoker()
  await invoke('mcp_unregister_claude_code')
}
```

- [ ] **Step 2: Typecheck**

Run (from `frontend/`):
```bash
npx tsc --noEmit
```
Expected: no errors from `src/lib/mcp.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/mcp.ts
git commit -m "feat(frontend): typed invoke wrappers for MCP registration"
```

---

### Task 7: Frontend — McpSettingsDialog component

The user-facing panel. Follows the existing dialog components' shadcn structure.

**Files:**
- Create: `frontend/src/components/dialogs/McpSettingsDialog.tsx`
- Reference: an existing dialog (e.g. `frontend/src/components/dialogs/EnvironmentsDialog.tsx`) for the exact Dialog import paths, Button/Badge usage, and styling conventions in this project.

**Interfaces:**
- Consumes: everything from `frontend/src/lib/mcp.ts` (Task 6).
- Produces: `<McpSettingsDialog open={boolean} onOpenChange={(v:boolean)=>void} />` default export, used by Task 8.

- [ ] **Step 1: Read an existing dialog to match conventions**

Read `frontend/src/components/dialogs/EnvironmentsDialog.tsx` fully first to copy the exact shadcn import paths (`@/components/ui/dialog`, `button`, etc.), how it uses `open`/`onOpenChange`, and any toast helper the project uses. Use those same imports below (adjust the JSX skeleton to match the project's actual `Dialog` API).

- [ ] **Step 2: Write the dialog component**

Create `frontend/src/components/dialogs/McpSettingsDialog.tsx`. Use the same UI primitive imports the existing dialogs use; the logic is:

```tsx
import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  getMcpStatus, getMcpServerPath,
  registerClaudeDesktop, unregisterClaudeDesktop,
  registerClaudeCode, unregisterClaudeCode,
  type McpStatus, type ClientState,
} from '@/lib/mcp'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

const STATE_LABEL: Record<ClientState, string> = {
  registered: 'Registered',
  not_registered: 'Not registered',
  config_not_found: 'Config not found',
  cli_missing: 'CLI not installed',
}

export default function McpSettingsDialog({ open, onOpenChange }: Props) {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [binaryPath, setBinaryPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setError(null)
    try {
      const [s, p] = await Promise.all([getMcpStatus(), getMcpServerPath()])
      setStatus(s)
      setBinaryPath(p)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    }
  }

  useEffect(() => {
    if (open) refresh()
  }, [open])

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const snippet = JSON.stringify(
    { mcpServers: { beacon: { command: binaryPath, args: [] } } },
    null,
    2,
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>MCP Server</DialogTitle>
          <DialogDescription>
            Let AI agents drive Beacon. Register with a Claude client below, or
            copy the config for any other MCP client.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-sm text-red-500 border border-red-500/30 rounded p-2">
            {error}
          </div>
        )}

        {/* Binary path */}
        <div className="space-y-1">
          <div className="text-sm font-medium">Server binary</div>
          <div className="flex gap-2">
            <code className="flex-1 text-xs bg-muted rounded px-2 py-1 truncate">
              {binaryPath || '—'}
            </code>
            <Button
              variant="outline" size="sm"
              onClick={() => navigator.clipboard.writeText(binaryPath)}
            >
              Copy
            </Button>
          </div>
        </div>

        {/* Claude Desktop */}
        <ClientRow
          name="Claude Desktop"
          state={status?.claude_desktop}
          busy={busy}
          onRegister={() => act(registerClaudeDesktop)}
          onUnregister={() => act(unregisterClaudeDesktop)}
        />

        {/* Claude Code */}
        <ClientRow
          name="Claude Code"
          state={status?.claude_code}
          busy={busy}
          onRegister={() => act(registerClaudeCode)}
          onUnregister={() => act(unregisterClaudeCode)}
        />

        {/* Other clients */}
        <div className="space-y-1">
          <div className="text-sm font-medium">Other MCP clients</div>
          <p className="text-xs text-muted-foreground">
            Cursor, Windsurf, Cline, and any MCP-compatible client: paste this.
          </p>
          <div className="flex gap-2 items-start">
            <pre className="flex-1 text-xs bg-muted rounded px-2 py-1 overflow-x-auto">
              {snippet}
            </pre>
            <Button
              variant="outline" size="sm"
              onClick={() => navigator.clipboard.writeText(snippet)}
            >
              Copy
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ClientRow({
  name, state, busy, onRegister, onUnregister,
}: {
  name: string
  state?: ClientState
  busy: boolean
  onRegister: () => void
  onUnregister: () => void
}) {
  const registered = state === 'registered'
  const disabled = busy || state === 'cli_missing'
  return (
    <div className="flex items-center justify-between border rounded p-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{name}</span>
        <Badge variant={registered ? 'default' : 'secondary'}>
          {state ? STATE_LABEL[state] : '…'}
        </Badge>
      </div>
      <Button
        size="sm"
        variant={registered ? 'outline' : 'default'}
        disabled={disabled}
        onClick={registered ? onUnregister : onRegister}
      >
        {registered ? 'Unregister' : 'Register'}
      </Button>
    </div>
  )
}
```

Note: if `@/components/ui/badge` does not exist in the project, add it via the project's shadcn workflow, or substitute a `<span>` with the project's existing status-pill styling found in Step 1.

- [ ] **Step 3: Typecheck**

Run (from `frontend/`):
```bash
npx tsc --noEmit
```
Expected: no errors from the new file. Fix any import-path mismatches against what Step 1 revealed.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/dialogs/McpSettingsDialog.tsx
git commit -m "feat(frontend): McpSettingsDialog with status, register toggles, copy snippet"
```

---

### Task 8: Wire the dialog into the app (desktop-only entry point)

Add a way to open the dialog, shown only on desktop.

**Files:**
- Modify: `frontend/src/App.tsx` (or the toolbar/menu component where other dialogs like `EnvironmentsDialog` are opened — find it in Step 1)

**Interfaces:**
- Consumes: `McpSettingsDialog` (Task 7), `isDesktop()` (platform.ts).

- [ ] **Step 1: Find where sibling dialogs are opened**

Run (from `frontend/`):
```bash
grep -rn "EnvironmentsDialog\|ProjectSettingsDialog" src/ --include=*.tsx
```
Expected: shows the component that imports and renders these dialogs with an `open` state and a trigger button. That is the file to modify.

- [ ] **Step 2: Add state, trigger, and render — gated by isDesktop()**

In the file found in Step 1, mirror how a sibling dialog is wired. Add:

```tsx
import { isDesktop } from '@/lib/platform'
import McpSettingsDialog from '@/components/dialogs/McpSettingsDialog'
// ...
const [mcpOpen, setMcpOpen] = useState(false)
// ...
{isDesktop() && (
  <Button variant="ghost" size="sm" onClick={() => setMcpOpen(true)}>
    MCP
  </Button>
)}
{isDesktop() && <McpSettingsDialog open={mcpOpen} onOpenChange={setMcpOpen} />}
```

Place the trigger button alongside the existing dialog triggers (match the surrounding markup — the exact placement depends on the toolbar structure seen in Step 1).

- [ ] **Step 3: Typecheck + build**

Run (from `frontend/`):
```bash
npx tsc --noEmit && npm run build
```
Expected: typechecks and builds with no errors.

- [ ] **Step 4: Verify in the web dev server that the button is hidden on web**

Run (from `frontend/`):
```bash
npm run dev
```
Open http://localhost:5173 — confirm the **MCP** button does NOT appear (web has no `isDesktop()`). Stop the server.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): desktop-only entry point for MCP settings dialog"
```

---

### Task 9: End-to-end desktop verification + docs update

Build the real installer and verify the full flow, then update user docs.

**Files:**
- Modify: `docs/mcp.md` (add a "Desktop app" section)

- [ ] **Step 1: Build backend binaries + the desktop installer**

Run:
```bash
cd backend && python build_backend.py && cd ../frontend && npm run desktop:prepare && npm run tauri:build
```
Expected: produces an NSIS installer under `frontend/src-tauri/target/release/bundle/nsis/`.

- [ ] **Step 2: Install and verify staging**

Install the produced `.exe`. Launch Beacon. Verify the staged binary exists:
```bash
ls "$APPDATA/com.beacon.app/mcp_server.exe"
```
Expected: the file is present.

- [ ] **Step 3: Verify register/unregister (Claude Desktop) preserves other entries**

- In the app: open **MCP** dialog → note Claude Desktop status.
- If you have an existing `claude_desktop_config.json` with other servers, back it up first.
- Click **Register** → open `%APPDATA%\Claude\claude_desktop_config.json` and confirm a `beacon` entry pointing at the staged path exists, and any pre-existing servers are untouched.
- Click **Unregister** → confirm only `beacon` was removed.

- [ ] **Step 4: Verify Claude Code path + CLI-missing behavior**

- If `claude` CLI is installed: Register → run `claude mcp list` in a terminal → confirm `beacon` appears → Unregister → confirm it's gone.
- If not installed: confirm the Claude Code row shows "CLI not installed" and the button is disabled.

- [ ] **Step 5: Verify corrupt-config refusal**

- Manually write `{ this is not json` into `claude_desktop_config.json`.
- Click **Register** for Claude Desktop → confirm an error message is shown and the file is NOT overwritten (still contains your garbage, not a fresh config).
- Restore the file.

- [ ] **Step 6: Update docs**

Modify `docs/mcp.md` — add a section after "## Connect":

```markdown
## Desktop app (no Python needed)

The Beacon desktop app bundles the MCP server as a standalone binary — you do
**not** need Python installed. Open **MCP** in the app to:

- Register / unregister with **Claude Desktop** and **Claude Code** in one click
  (Beacon only ever touches its own `beacon` entry — your other MCP servers are
  left untouched).
- Copy a ready-to-paste config snippet for any other MCP client (Cursor,
  Windsurf, Cline, …).

The bundled binary is staged at a stable per-user path
(`%APPDATA%\com.beacon.app\mcp_server.exe` on Windows) so registrations keep
working across app updates.
```

- [ ] **Step 7: Commit**

```bash
git add docs/mcp.md
git commit -m "docs(mcp): document desktop bundling + one-click registration"
```

---

## Self-Review Notes

- **Spec coverage:** packaging (T1), bundling as externalBin (T2), stable-path staging + path command (T3), pure merge/remove + tests (T4), status/register/unregister commands incl. corrupt-refusal & CLI-missing (T5), typed wrappers (T6), Settings UI with live status + toggles + copy snippet (T7), desktop-only entry point (T8), e2e verification + docs (T9). All spec sections mapped.
- **Type consistency:** `ClientState` string enum matches between Rust command return strings (`"registered"` etc., T5) and the TS type (T6/T7). `mcp_server_path`, `mcp_status`, and the four register/unregister command names are identical across T3/T5/T6.
- **Known adaptation points (call out during execution, not placeholders):** exact shadcn import paths and toolbar wiring must be matched to this project's actual files (T7 Step 1, T8 Step 1) — the plan instructs reading a sibling dialog first rather than guessing.
