//! Spawns the real `mcp_server` binary over stdio and speaks JSON-RPC to it,
//! the same way an external MCP client (Claude Desktop/Code, Cursor, …) would.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

struct McpProcess {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
}

impl McpProcess {
    fn spawn(data_dir: &std::path::Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_mcp_server"))
            .env("BEACON_DATA_DIR", data_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn mcp_server");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Self { child, stdin, stdout }
    }

    fn call(&mut self, request: &Value) -> Value {
        let line = serde_json::to_string(request).unwrap();
        writeln!(self.stdin, "{line}").unwrap();
        self.stdin.flush().unwrap();
        let mut response_line = String::new();
        self.stdout.read_line(&mut response_line).expect("no response from mcp_server");
        serde_json::from_str(response_line.trim()).unwrap_or_else(|e| panic!("bad JSON from mcp_server: {e}: {response_line:?}"))
    }
}

impl Drop for McpProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn initialize_tools_list_and_tools_call_over_stdio() {
    let dir = std::env::temp_dir().join(format!("beacon-mcp-stdio-{}-{}", std::process::id(), line!()));
    let _ = std::fs::remove_dir_all(&dir);
    let mut proc = McpProcess::spawn(&dir);

    let init = proc.call(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }));
    assert_eq!(init["result"]["serverInfo"]["name"], "beacon-mcp", "{init}");

    let list = proc.call(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }));
    let tools = list["result"]["tools"].as_array().expect("tools array");
    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    for expected in [
        "beacon_list_endpoints",
        "beacon_search_endpoints",
        "beacon_get_config",
        "beacon_duplicate_endpoint",
        "beacon_run_endpoint",
        "beacon_add_endpoint_from_curl",
        "beacon_import_collection",
    ] {
        assert!(names.contains(&expected), "missing tool '{expected}' in {names:?}");
    }

    let create = proc.call(&json!({
        "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": { "name": "beacon_create_endpoint", "arguments": { "name": "Ping", "url": "/ping" } }
    }));
    let text = create["result"]["content"][0]["text"].as_str().expect("text content");
    let parsed: Value = serde_json::from_str(text).unwrap();
    assert_eq!(parsed["status"], "created", "{parsed}");
    assert_eq!(create["result"]["isError"], false);

    let search = proc.call(&json!({
        "jsonrpc": "2.0", "id": 4, "method": "tools/call",
        "params": { "name": "beacon_search_endpoints", "arguments": { "query": "ping" } }
    }));
    let search_text = search["result"]["content"][0]["text"].as_str().unwrap();
    let search_parsed: Value = serde_json::from_str(search_text).unwrap();
    assert_eq!(search_parsed["total"], 1, "{search_parsed}");

    // An unknown tool must come back as a clean JSON-RPC error result, not kill the process.
    let unknown = proc.call(&json!({
        "jsonrpc": "2.0", "id": 5, "method": "tools/call",
        "params": { "name": "beacon_does_not_exist", "arguments": {} }
    }));
    assert_eq!(unknown["result"]["isError"], true, "{unknown}");

    // The server must still be alive and answer another request after an error.
    let list_again = proc.call(&json!({ "jsonrpc": "2.0", "id": 6, "method": "tools/list", "params": {} }));
    assert!(list_again["result"]["tools"].is_array());

    std::fs::remove_dir_all(&dir).ok();
}
