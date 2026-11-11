//! Stdio JSON-RPC 2.0 MCP server exposing the same tool set as the in-app agent.
use beacon_agent::{agent_tool_definitions, execute_tool};
use beacon_server::store::{ServerWorkspace, Store};
use parking_lot::RwLock;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::sync::Arc;

/// OpenAI-style `{type, function:{name,description,parameters}}` -> MCP `{name,description,inputSchema}`.
fn mcp_tools() -> Vec<Value> {
    agent_tool_definitions()
        .into_iter()
        .filter_map(|t| {
            let f = t.get("function")?;
            Some(json!({
                "name": f.get("name")?,
                "description": f.get("description").cloned().unwrap_or(Value::Null),
                "inputSchema": f.get("parameters").cloned().unwrap_or(json!({ "type": "object", "properties": {} })),
            }))
        })
        .collect()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let workspace = ServerWorkspace(Arc::new(RwLock::new(Store::new())));

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or(json!({}));

        let response = match method {
            "initialize" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "beacon-mcp", "version": env!("CARGO_PKG_VERSION") }
                }
            }),
            "notifications/initialized" => continue,
            "tools/list" => json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": mcp_tools() } }),
            "tools/call" => {
                let tool_name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                // Re-read the store so edits made in the desktop app since the last call are visible.
                workspace.0.write().load();
                let result = execute_tool(tool_name, &args, &workspace).await;
                let is_error = result.get("error").is_some();
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&result).unwrap_or_default() }],
                        "isError": is_error
                    }
                })
            }
            _ => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": "Method not found" }
            }),
        };

        writeln!(stdout, "{}", serde_json::to_string(&response).unwrap_or_default())?;
        stdout.flush()?;
    }
    Ok(())
}
