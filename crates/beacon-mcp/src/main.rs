use beacon_core::{APITester, EndpointTest};
use beacon_server::store::Store;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

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
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "beacon-mcp",
                        "version": "0.10.0"
                    }
                }
            }),
            "notifications/initialized" => continue,
            "tools/list" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": [
                        {
                            "name": "beacon_list_endpoints",
                            "description": "List all configured API endpoints in the active Beacon project.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "beacon_probe_endpoint",
                            "description": "Fire an HTTP probe against an endpoint or URL and return status, latency, headers, and body.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "url": { "type": "string", "description": "Target endpoint URL" },
                                    "method": { "type": "string", "description": "HTTP method (GET, POST, etc.)" },
                                    "headers": { "type": "object", "description": "Headers key-value pairs" },
                                    "payload": { "type": "object", "description": "JSON request body" }
                                },
                                "required": ["url"]
                            }
                        },
                        {
                            "name": "beacon_list_variables",
                            "description": "List current project and environment variables.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "beacon_set_variable",
                            "description": "Set or update an environment variable in the active Beacon project.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "name": { "type": "string", "description": "Variable name" },
                                    "value": { "type": "string", "description": "Variable value" }
                                },
                                "required": ["name", "value"]
                            }
                        }
                    ]
                }
            }),
            "tools/call" => {
                let tool_name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                let mut store = Store::new();

                let result_text = match tool_name {
                    "beacon_list_endpoints" => {
                        let tests: Vec<Value> = store
                            .current_config
                            .tests
                            .iter()
                            .map(|t| {
                                json!({
                                    "id": t.id,
                                    "name": t.name,
                                    "method": t.method,
                                    "url": t.url,
                                })
                            })
                            .collect();
                        serde_json::to_string_pretty(&tests).unwrap_or_default()
                    }
                    "beacon_list_variables" => {
                        let vars = store.current_config.snapshot_variables();
                        serde_json::to_string_pretty(&vars).unwrap_or_default()
                    }
                    "beacon_set_variable" => {
                        let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("");
                        if !name.is_empty() {
                            store.current_config.variables.write().insert(name.to_string(), value.to_string());
                            let _ = store.save();
                            format!("Successfully set {} = {}", name, value)
                        } else {
                            "Error: 'name' is required".to_string()
                        }
                    }
                    "beacon_probe_endpoint" => {
                        let url = args.get("url").and_then(|u| u.as_str()).unwrap_or("/");
                        let method = args.get("method").and_then(|m| m.as_str()).unwrap_or("GET");
                        let headers: HashMap<String, Value> = args
                            .get("headers")
                            .and_then(|h| serde_json::from_value(h.clone()).ok())
                            .unwrap_or_default();
                        let payload = args.get("payload").cloned().unwrap_or(Value::Null);

                        let mut test = EndpointTest::new(
                            Some(Uuid::new_v4().to_string()),
                            "MCP Probe".to_string(),
                            url.to_string(),
                            Some(method.to_string()),
                        );
                        test.headers = headers;
                        test.payload = payload;

                        let tester = APITester::new(test, store.current_config.clone(), 1, 0, 1, None);
                        match tester.execute_single().await {
                            Ok(out) => serde_json::to_string_pretty(&out).unwrap_or_default(),
                            Err(e) => format!("Error executing probe: {}", e),
                        }
                    }
                    _ => format!("Unknown tool: {}", tool_name),
                };

                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": result_text
                            }
                        ]
                    }
                })
            }
            _ => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": "Method not found"
                }
            }),
        };

        let out_str = serde_json::to_string(&response).unwrap_or_default();
        writeln!(stdout, "{}", out_str)?;
        stdout.flush()?;
    }

    Ok(())
}

