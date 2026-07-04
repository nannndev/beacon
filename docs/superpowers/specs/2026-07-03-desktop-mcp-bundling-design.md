# Desktop MCP Bundling & Registration — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorming complete)

## Problem

Beacon ships an MCP server (`backend/app/mcp_server.py`) so AI agents can drive
the tester. Today it is **source-only**: a user must have Python + deps
installed and manually edit `claude_desktop_config.json` (or run `claude mcp
add`) pointing at `python -m app.mcp_server`. This is not "plug and play" for
someone who just installed the desktop app.

The desktop app (Tauri, `frontend/src-tauri/`) already bundles the FastAPI
backend as a PyInstaller sidecar. We want the MCP server to be bundled the same
way and made registerable from a Settings panel inside the app — while keeping
the MCP surface **client-agnostic** (usable by any MCP client, not just Claude).

## Goals

- MCP server ships inside the installer as a standalone binary — **no Python
  required** on the user's machine.
- User can register/unregister the MCP server with Claude Desktop and Claude
  Code from a Settings panel, and see live status.
- Any other MCP client (Cursor, Windsurf, Cline, …) is supported via a
  copy-paste config snippet — not blocked, not privileged.
- Auto-writing another app's config file is done **safely**: merge, never
  clobber; refuse rather than corrupt.

## Non-Goals

- No always-on HTTP/SSE MCP process. Transport is **stdio**, spawned by each
  client on demand (matches existing docs and avoids a second long-lived
  process racing on `tests.json`).
- No per-host rule/skill generation for non-Claude clients. The `.claude/skills`
  file stays a Claude Code nicety; MCP is the universal path.
- No changes to the MCP tool surface itself (`list_projects`, `run_endpoint`,
  etc. stay as-is).

## Key Decisions (from brainstorming)

| # | Decision |
|---|----------|
| Transport | **stdio**, spawned per-client on demand (not an always-on sidecar). |
| Packaging | **PyInstaller standalone binary** (`mcp_server.exe`), mirroring the backend. No Python needed on user machine. |
| Auto-register scope | **Claude Desktop + Claude Code** get one-click register/unregister. Other clients get a generic "Copy config" snippet. |
| Settings UI | **Live status** (re-read client config on open) + **toggle** register/unregister that touches only Beacon's own entry. |

## Architecture

```
McpSettingsDialog (React, isDesktop()-gated)
  └─ invoke("mcp_server_path")       → absolute path of bundled binary (for manual copy)
  └─ invoke("mcp_status")            → { claudeDesktop, claudeCode } status enums
  └─ invoke("mcp_register_claude_desktop")   / unregister
  └─ invoke("mcp_register_claude_code")      / unregister

Rust (src-tauri: main.rs + new mcp_registration.rs)
  ├─ pure fns: merge_beacon_entry(json) / remove_beacon_entry(json)  ← unit-testable
  ├─ path resolution (%APPDATA%\Claude\claude_desktop_config.json, etc.)
  └─ shell exec (`claude mcp add|remove|list`)

Tauri startup (main.rs setup)
  └─ copy mcp_server-<triple>.exe → app_data_dir()\mcp_server.exe (stable path across updates)

Build (prepare-desktop.cjs)
  └─ PyInstaller build backend + mcp_server → copy both to src-tauri/<name>-<triple>.exe
```

## Components

### 1. Packaging

- **`backend/mcp_server.spec`** — new PyInstaller spec, mirror of
  `backend/backend.spec`, entry point `app/mcp_server.py`, output
  `dist/mcp_server[.exe]`.
- **`backend/build_backend.py`** — extend (or add a sibling call) so the same
  build step produces both binaries. Keep one invocation from
  `prepare-desktop.cjs`.
- **`frontend/scripts/prepare-desktop.cjs`** — after building, also copy
  `dist/mcp_server[.exe]` → `src-tauri/mcp_server-<triple>[.exe]`. Fail loudly
  if the binary is missing (same pattern as the existing backend copy).
- **`frontend/src-tauri/tauri.conf.json`** — add `"mcp_server"` to
  `bundle.externalBin` (array becomes `["backend", "mcp_server"]`).

### 2. Stable-path staging (Tauri startup)

In `main.rs` `setup()`:

- Resolve the bundled sidecar's on-disk path (Tauri resource / sidecar dir).
- Copy it to `app_data_dir()\mcp_server.exe` if absent **or** if the bundled
  version is newer (size/mtime check, or a version stamp file). This gives a
  **stable absolute path** that survives app auto-updates — so a config entry
  registered once keeps working.
- The MCP binary is **not spawned** by Tauri (stdio clients spawn it
  themselves). Tauri only stages it and reports its path.
- New command `mcp_server_path() -> String` returns the staged absolute path.

### 3. Registration commands (Rust)

New module `mcp_registration.rs`, wired into `invoke_handler`.

**Pure, unit-testable core** (no I/O):
- `merge_beacon_entry(config_json, binary_path) -> config_json` — parse, insert
  or replace `mcpServers.beacon`, leave every other key untouched, return new
  JSON. Handles the "no `mcpServers` key yet" case.
- `remove_beacon_entry(config_json) -> config_json` — remove only
  `mcpServers.beacon`, leave the rest.

**I/O wrappers (commands):**

| Command | Behavior |
|---------|----------|
| `mcp_status()` | Returns `{ claudeDesktop, claudeCode }`. Claude Desktop: read config file → `Registered` / `NotRegistered` / `ConfigNotFound`. Claude Code: run `claude mcp list` → `Registered` / `NotRegistered` / `CliMissing`. |
| `mcp_register_claude_desktop()` | Locate config path. If file exists → parse, `merge_beacon_entry`, write back. If missing → create minimal config. If unparseable → **error out, do not overwrite**; tell user to add manually. |
| `mcp_unregister_claude_desktop()` | Parse, `remove_beacon_entry`, write back. |
| `mcp_register_claude_code()` | Shell `claude mcp add beacon -- <binary_path>`. If `claude` not found → clear "Claude Code CLI not installed" error. |
| `mcp_unregister_claude_code()` | Shell `claude mcp remove beacon`. |

Config path resolution (Claude Desktop):
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

(Windows is the shipping target today per `tauri.conf.json` `nsis`; the others
are implemented for parity but only Windows is verified in this pass.)

### 4. Settings UI

**`frontend/src/components/dialogs/McpSettingsDialog.tsx`** — shadcn `Dialog`,
following the existing dialog components' structure.

- Entry point (menu item / button) rendered only when `isDesktop()` is true.
- On open: call `mcp_status()` to populate badges.
- Sections:
  - **Binary path** — show absolute path + copy button.
  - **Claude Desktop** — status badge (`Registered` / `Not registered` /
    `Config not found`) + toggle button (Register ↔ Unregister).
  - **Claude Code** — status badge + toggle. If `CliMissing`: badge "CLI not
    installed", toggle disabled.
  - **Other clients** — a generic stdio JSON snippet (using the binary path) in
    a copy box, with a one-line note that it works for any MCP client.
- Errors from Rust surfaced as toast/inline message — never silent.

## Data Flow

1. Install → NSIS drops `mcp_server-<triple>.exe` alongside the app.
2. First launch → Tauri stages it to `%APPDATA%\Beacon\mcp_server.exe`.
3. User opens Settings → MCP → `mcp_status()` reads client configs, badges render.
4. User clicks Register (Claude Desktop) → `merge_beacon_entry` writes the
   `beacon` entry pointing at the staged path.
5. Client (Claude Desktop/Code/other) spawns `mcp_server.exe` over stdio when it
   starts; the MCP server reads/writes the shared `tests.json`.

## Error Handling

- **Corrupt/unreadable client config** → refuse to write, return error, tell
  user to add manually via the copy snippet. Never overwrite a file we can't
  parse.
- **`claude` CLI missing** → status `CliMissing`, register disabled, message
  points to manual/other options.
- **Config dir doesn't exist (Claude never installed)** → for Claude Desktop,
  create the file+dir on register; status shows `ConfigNotFound` until then.
- **Staged binary missing at register time** → error asking user to reopen the
  app (staging happens at startup).

## Testing

- **Unit (Rust):** `merge_beacon_entry` / `remove_beacon_entry` — empty config,
  config with other MCP servers present (must be preserved), config already
  containing a `beacon` entry (must be replaced, not duplicated), missing
  `mcpServers` key.
- **Manual (real app):** build installer → install → verify staging path →
  register Claude Desktop → confirm entry appears and other entries untouched →
  unregister → confirm only `beacon` removed → repeat for Claude Code →
  CLI-missing path → corrupt-config refusal.

## Risks / Notes

- Writing another app's config file is inherently invasive; the merge-only +
  refuse-on-corrupt policy is the mitigation. Toggle unregister removes only the
  `beacon` key.
- Concurrency: the MCP server and the app's backend both write `tests.json`.
  Existing docs already warn against running both writers at once; this design
  does not change that and does not add an always-on MCP process.
- macOS/Linux paths are implemented but only Windows is verified this pass
  (matches current shipping target).
