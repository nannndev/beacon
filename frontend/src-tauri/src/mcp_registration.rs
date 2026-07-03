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
