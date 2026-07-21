//! Pure, I/O-free logic for editing a client's MCP config JSON.
//!
//! The Beacon MCP server is a standard, client-agnostic MCP server.
//! We only provide special one-click registration for Claude (Desktop + Code)
//! because they have official CLI + known config file locations.
//! All other clients (Cursor, Windsurf, Cline, Continue, etc.) use the generic
//! stdio config snippet shown in the UI.

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

/// Run a blocking operation with a timeout. Returns None if it timed out.
/// This prevents `claude` CLI calls (which can occasionally hang or be slow)
/// from making the MCP settings dialog appear stuck.
fn run_with_timeout<F, T>(f: F, timeout: Duration) -> Option<T>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = f();
        let _ = tx.send(result);
    });
    rx.recv_timeout(timeout).ok()
}

use std::path::PathBuf;
use std::time::Duration;
use serde::Serialize;
use tauri::{Manager, State};

use crate::McpServerPath;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// A GUI app launched from Finder/Dock on macOS inherits a bare PATH
/// (`/usr/bin:/bin:/usr/sbin:/sbin`) — it does NOT see the user's shell PATH,
/// so `claude` installed in `~/.local/bin`, Homebrew, or an npm global dir is
/// invisible. Build a PATH that prepends the common install locations to
/// whatever we did inherit, used both to locate `claude` and as the child's
/// PATH (the CLI itself may shell out to `node`).
#[cfg(not(windows))]
fn enriched_path() -> String {
    let mut dirs: Vec<String> = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        for suffix in [".local/bin", ".npm-global/bin", ".bun/bin", ".deno/bin", ".volta/bin"] {
            dirs.push(format!("{home}/{suffix}"));
        }
    }
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(d.to_string());
    }
    if let Ok(existing) = std::env::var("PATH") {
        dirs.push(existing);
    }
    dirs.join(":")
}

/// Resolve an absolute path to the `claude` binary from the common install
/// locations, falling back to the bare name (PATH lookup) if none match.
#[cfg(not(windows))]
fn resolve_claude() -> String {
    if let Ok(home) = std::env::var("HOME") {
        for suffix in [".local/bin/claude", ".npm-global/bin/claude", ".bun/bin/claude", ".volta/bin/claude"] {
            let candidate = format!("{home}/{suffix}");
            if std::path::Path::new(&candidate).is_file() {
                return candidate;
            }
        }
    }
    for d in ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"] {
        if std::path::Path::new(d).is_file() {
            return d.to_string();
        }
    }
    "claude".to_string()
}

/// Build a std::process::Command that invokes the `claude` CLI, resolving the
/// `.cmd`/`.ps1` npm shim on Windows (CreateProcess doesn't search PATHEXT for
/// a bare program name, so we go through `cmd /C`). `extra` are the args after
/// `claude`.
fn claude_command(extra: &[&str]) -> std::process::Command {
    #[cfg(windows)]
    {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg("claude");
        c.args(extra);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = std::process::Command::new(resolve_claude());
        c.args(extra);
        // Give the child the enriched PATH so a node-backed `claude` shim can
        // still find `node`, and so PATH lookup works when we fell back to the
        // bare name.
        c.env("PATH", enriched_path());
        c
    }
}

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
pub async fn mcp_status(app: tauri::AppHandle) -> McpStatus {
    // Claude Desktop - file read is fast
    let claude_desktop = match claude_desktop_config_path(&app) {
        Some(p) if p.exists() => match std::fs::read_to_string(&p) {
            Ok(s) if beacon_is_registered(&s) => "registered",
            Ok(_) => "not_registered",
            Err(_) => "config_not_found",
        },
        _ => "config_not_found",
    }
    .to_string();

    // Claude Code: offload to blocking thread + timeout so a slow/hanging
    // `claude` CLI never makes the MCP dialog appear stuck.
    //
    // NOTE: we deliberately avoid `claude mcp list` — it health-checks EVERY
    // configured server (remote claude.ai servers included), which routinely
    // takes 20-30s and made detection time out and report "CLI not installed"
    // even when the CLI was present. Instead: `--version` for presence (fast,
    // no health check), then `mcp get beacon` for registration.
    let claude_code = tauri::async_runtime::spawn_blocking(|| {
        let present = run_with_timeout(
            || claude_command(&["--version"]).output().ok().map(|o| o.status.success()),
            Duration::from_secs(6),
        );
        if present != Some(Some(true)) {
            return "cli_missing".to_string();
        }
        // CLI is present. Is beacon registered? `mcp get` starts the one server
        // so it's slower than `--version`; a timeout here just means we couldn't
        // confirm — treat as not_registered rather than falsely "cli_missing".
        let registered = run_with_timeout(
            || claude_command(&["mcp", "get", "beacon"]).output().ok().map(|o| o.status.success()),
            Duration::from_secs(15),
        );
        match registered {
            Some(Some(true)) => "registered".to_string(),
            _ => "not_registered".to_string(),
        }
    })
    .await
    .unwrap_or_else(|_| "cli_missing".to_string());

    McpStatus { claude_desktop, claude_code }
}

/// Write `contents` to `path` atomically: write a sibling temp file in the same
/// directory, then rename it over the target. A crash/power-loss mid-write can
/// only leave the (discardable) temp file behind — the user's real config is
/// either the old bytes or the new bytes, never a truncated mix. Upholds the
/// merge-never-clobber invariant against interrupted writes, not just bad input.
fn atomic_write(path: &std::path::Path, contents: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("config path has no parent directory")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(
        ".{}.beacon.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("config")
    ));
    std::fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    // rename is atomic on the same volume; on Windows it also replaces an
    // existing target. Clean up the temp file if the rename fails.
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
pub fn mcp_register_claude_desktop(
    app: tauri::AppHandle,
    mcp_path: State<McpServerPath>,
) -> Result<(), String> {
    let path = claude_desktop_config_path(&app).ok_or("could not resolve Claude config path")?;
    let binary = mcp_path.0.lock().unwrap().to_string_lossy().to_string();
    let existing = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("failed to read Claude Desktop config: {e}")),
    };
    let merged = merge_beacon_entry(&existing, &binary)?; // refuses on corrupt JSON
    atomic_write(&path, &merged)
}

#[tauri::command]
pub fn mcp_unregister_claude_desktop(app: tauri::AppHandle) -> Result<(), String> {
    let path = claude_desktop_config_path(&app).ok_or("could not resolve Claude config path")?;
    if !path.exists() {
        return Ok(());
    }
    let existing = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let updated = remove_beacon_entry(&existing)?;
    atomic_write(&path, &updated)
}

#[tauri::command]
pub fn mcp_register_claude_code(mcp_path: State<McpServerPath>) -> Result<(), String> {
    let binary = mcp_path.0.lock().unwrap().to_string_lossy().to_string();
    let output = claude_command(&["mcp", "add", "beacon", "--", &binary])
        .output()
        .map_err(|e| format!("Failed to run Claude Code CLI (is it installed and in PATH?): {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.to_lowercase().contains("already exists") {
            Ok(())  // treat as success, it was already registered
        } else {
            Err(stderr)
        }
    }
}

#[tauri::command]
pub fn mcp_unregister_claude_code() -> Result<(), String> {
    let output = claude_command(&["mcp", "remove", "beacon"])
        .output()
        .map_err(|e| format!("Failed to run Claude Code CLI: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.to_lowercase().contains("not found") || stderr.to_lowercase().contains("does not exist") {
            Ok(())  // nothing to remove, treat as success
        } else {
            Err(stderr)
        }
    }
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

    #[test]
    fn errors_on_non_object_root() {
        // Well-formed JSON that isn't an object must error, not panic.
        assert!(merge_beacon_entry("[]", "b").is_err());
        assert!(merge_beacon_entry("5", "b").is_err());
        assert!(merge_beacon_entry("\"str\"", "b").is_err());
    }

    #[test]
    fn errors_on_non_object_mcp_servers() {
        // mcpServers present but the wrong type must error, not panic.
        assert!(merge_beacon_entry(r#"{"mcpServers":5}"#, "b").is_err());
    }
}
