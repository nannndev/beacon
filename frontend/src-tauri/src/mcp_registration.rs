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

use std::path::PathBuf;
use serde::Serialize;
use tauri::{Manager, State};

use crate::McpServerPath;

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
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = std::process::Command::new("claude");
        c.args(extra);
        c
    }
}

/// Whether the `claude` CLI is actually resolvable on this machine. Uses
/// `where` on Windows (exit 0 = found) and `claude --version` elsewhere
/// (spawn failure = not found). Language-independent — does not parse
/// localized "not recognized" messages.
fn claude_installed() -> bool {
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "where", "claude"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("claude")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
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
    let claude_code = if !claude_installed() {
        "cli_missing"
    } else {
        match claude_command(&["mcp", "list"]).output() {
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
    }
    .to_string();

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
    if !claude_installed() {
        return Err("Claude Code CLI not installed".to_string());
    }
    let binary = mcp_path.0.lock().unwrap().to_string_lossy().to_string();
    let output = claude_command(&["mcp", "add", "beacon", "--", &binary])
        .output()
        .map_err(|_| "Claude Code CLI not installed".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub fn mcp_unregister_claude_code() -> Result<(), String> {
    if !claude_installed() {
        return Err("Claude Code CLI not installed".to_string());
    }
    let output = claude_command(&["mcp", "remove", "beacon"])
        .output()
        .map_err(|_| "Claude Code CLI not installed".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
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
