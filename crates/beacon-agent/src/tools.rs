use beacon_core::{APITester, EndpointTest, TestConfig};
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn agent_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "beacon_list_endpoints",
                "description": "List all configured API endpoints in the current Beacon project.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_probe_endpoint",
                "description": "Fire a single HTTP probe against an endpoint or ad-hoc URL and inspect the status, headers, body, and latency.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": { "type": "string", "description": "Target URL (e.g. /users or full https://...)" },
                        "method": { "type": "string", "description": "HTTP method (GET, POST, PUT, DELETE, etc.)" },
                        "headers": { "type": "object", "description": "HTTP headers dict" },
                        "payload": { "type": "object", "description": "JSON payload body" }
                    },
                    "required": ["url"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_list_variables",
                "description": "List all active environment and global variables.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_set_variable",
                "description": "Set or update a variable in the active environment.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Variable name" },
                        "value": { "type": "string", "description": "Variable value" }
                    },
                    "required": ["name", "value"]
                }
            }
        }),
    ]
}

pub async fn execute_tool(name: &str, args: &Value, config: &TestConfig) -> Value {
    match name {
        "beacon_list_endpoints" => {
            let endpoints: Vec<Value> = config
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
            json!({ "endpoints": endpoints, "count": config.tests.len() })
        }
        "beacon_list_variables" => {
            let vars = config.snapshot_variables();
            json!({ "variables": vars })
        }
        "beacon_set_variable" => {
            let var_name = args.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let var_val = args.get("value").and_then(|v| v.as_str()).unwrap_or("");
            if !var_name.is_empty() {
                config
                    .variables
                    .write()
                    .insert(var_name.to_string(), var_val.to_string());
                json!({ "status": "updated", "name": var_name, "value": var_val })
            } else {
                json!({ "error": "name is required" })
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
                Some("probe-adhoc".to_string()),
                "Probe".to_string(),
                url.to_string(),
                Some(method.to_string()),
            );
            test.headers = headers;
            test.payload = payload;

            let tester = APITester::new(test, config.clone(), 1, 0, 1, None);
            match tester.execute_single().await {
                Ok(out) => json!({
                    "status": out.status,
                    "time_ms": out.time_ms,
                    "target_url": out.target_url,
                    "headers": out.headers,
                    "body": out.body,
                    "json": out.json,
                }),
                Err(err) => json!({ "error": err }),
            }
        }
        _ => json!({ "error": format!("Unknown tool: {}", name) }),
    }
}
