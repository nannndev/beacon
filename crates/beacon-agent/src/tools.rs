use beacon_core::{
    APITester, EndpointTest, TestConfig,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

/// Operations for inspecting and mutating the active Beacon project workspace.
pub trait WorkspaceOps: Send + Sync {
    fn get_config(&self) -> TestConfig;
    fn get_endpoint(&self, id_or_name: &str) -> Option<EndpointTest>;
    fn list_endpoints(&self) -> Vec<EndpointTest>;
    fn create_endpoint(&self, test: EndpointTest) -> Result<EndpointTest, String>;
    fn update_endpoint(&self, id_or_name: &str, patch: Value) -> Result<EndpointTest, String>;
    fn delete_endpoint(&self, id_or_name: &str) -> Result<String, String>;
    fn set_variable(&self, name: &str, value: &str) -> Result<(), String>;
    fn save_extracted_variables(&self, vars: HashMap<String, String>) -> Result<(), String>;
}

/// Fallback read-only workspace adapter wrapping a TestConfig clone.
pub struct ConfigWorkspace(pub TestConfig);

impl WorkspaceOps for ConfigWorkspace {
    fn get_config(&self) -> TestConfig {
        self.0.clone()
    }
    fn get_endpoint(&self, id_or_name: &str) -> Option<EndpointTest> {
        let needle = id_or_name.trim();
        self.0
            .tests
            .iter()
            .find(|t| t.id == needle || t.name.eq_ignore_ascii_case(needle))
            .cloned()
    }
    fn list_endpoints(&self) -> Vec<EndpointTest> {
        self.0.tests.clone()
    }
    fn create_endpoint(&self, _test: EndpointTest) -> Result<EndpointTest, String> {
        Err("Workspace mutation not supported in standalone config mode".into())
    }
    fn update_endpoint(&self, _id_or_name: &str, _patch: Value) -> Result<EndpointTest, String> {
        Err("Workspace mutation not supported in standalone config mode".into())
    }
    fn delete_endpoint(&self, _id_or_name: &str) -> Result<String, String> {
        Err("Workspace mutation not supported in standalone config mode".into())
    }
    fn set_variable(&self, name: &str, value: &str) -> Result<(), String> {
        self.0
            .variables
            .write()
            .insert(name.to_string(), value.to_string());
        Ok(())
    }
    fn save_extracted_variables(&self, vars: HashMap<String, String>) -> Result<(), String> {
        let mut v = self.0.variables.write();
        for (k, val) in vars {
            v.insert(k, val);
        }
        Ok(())
    }
}

pub fn agent_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "beacon_list_endpoints",
                "description": "List all configured API endpoints in the active Beacon project with ID, name, method, URL, and summary of assertions & extractors.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filter": { "type": "string", "description": "Optional keyword to filter endpoints by name, URL, or method" }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_get_endpoint",
                "description": "Retrieve full configuration and metadata of an endpoint (headers, payload, query params, auth, extractors, and assertions) by ID or name.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string", "description": "Endpoint ID or exact name" }
                    },
                    "required": ["id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_create_endpoint",
                "description": "Create a new API endpoint in the active Beacon project. Automatically persists to the project workspace and updates the UI.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Descriptive endpoint name (e.g. 'Get User Profile', 'Create Order')" },
                        "url": { "type": "string", "description": "Endpoint URL or path, supporting {{variables}} (e.g. '{{base_url}}/users', 'https://api.example.com/v1/auth')" },
                        "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], "description": "HTTP method (default: GET)" },
                        "headers": { "type": "object", "description": "HTTP headers dict (e.g. {'Content-Type': 'application/json', 'Authorization': 'Bearer {{token}}'})" },
                        "payload": { "type": "object", "description": "JSON request body payload" },
                        "payload_type": { "type": "string", "enum": ["json", "form", "raw", "graphql"], "description": "Body type (default: json)" },
                        "auth": {
                            "type": "object",
                            "description": "Structured auth config (e.g. {'type': 'bearer', 'token': '{{token}}'} or {'type': 'apikey', 'key': 'X-API-Key', 'value': '{{api_key}}', 'in': 'header'})"
                        },
                        "extractors": {
                            "type": "object",
                            "description": "Variable extractors from response: { variable_name: 'body.access_token' | 'header.set-cookie' }"
                        },
                        "assertions": {
                            "type": "array",
                            "description": "Response assertions to enforce status code, latency, headers, or body values",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "type": { "type": "string", "enum": ["status_code", "response_time", "header", "body", "json_path", "regex"] },
                                    "op": { "type": "string", "enum": ["eq", "ne", "lt", "lte", "gt", "gte", "contains", "exists", "regex"] },
                                    "value": { "description": "Expected value or threshold" },
                                    "path": { "type": "string", "description": "JSON dot-path for json_path assertion (e.g. 'body.id', 'body.data[0].status')" },
                                    "name": { "type": "string", "description": "Header name for header assertion (e.g. 'content-type')" }
                                },
                                "required": ["type"]
                            }
                        }
                    },
                    "required": ["name", "url"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_update_endpoint",
                "description": "Update an existing endpoint's URL, method, headers, payload, auth, extractors, or assertions. Supports partial updates (e.g. batch-prefixing {{base_url}}, adding smart assertions, or fixing payloads).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string", "description": "Endpoint ID or name to update" },
                        "name": { "type": "string", "description": "New endpoint name" },
                        "url": { "type": "string", "description": "New URL path or full URL" },
                        "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
                        "headers": { "type": "object", "description": "Updated headers dict" },
                        "payload": { "type": "object", "description": "Updated JSON request body" },
                        "payload_type": { "type": "string", "enum": ["json", "form", "raw", "graphql"] },
                        "auth": { "type": "object", "description": "Updated auth configuration" },
                        "extractors": { "type": "object", "description": "Updated variable extractors" },
                        "assertions": { "type": "array", "description": "Updated response assertions array" }
                    },
                    "required": ["id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_delete_endpoint",
                "description": "Delete an endpoint from the active Beacon project workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string", "description": "Endpoint ID or name to delete" }
                    },
                    "required": ["id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_run_collection",
                "description": "Run an ordered sequence of endpoints with automatic variable chaining: extractors pull values (e.g. login tokens) from responses into variables for downstream requests, evaluating all assertions step-by-step.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "endpoint_ids": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Ordered list of endpoint IDs or names to execute. If omitted or empty, runs all endpoints in the current project."
                        },
                        "stop_on_failure": {
                            "type": "boolean",
                            "description": "If true, stops execution immediately if an endpoint fails or has failing assertions (default: false)"
                        }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_run_load_test",
                "description": "Execute a concurrent load, spike, stress, or smoke test against a target endpoint. Returns throughput (RPS), error breakdown, status codes, and latency percentiles (p50, p75, p90, p95, p99).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "endpoint_id": { "type": "string", "description": "Target endpoint ID or name from the project" },
                        "url": { "type": "string", "description": "Ad-hoc URL if testing an endpoint not saved in the project" },
                        "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"], "description": "HTTP method (if ad-hoc URL)" },
                        "concurrency": { "type": "integer", "description": "Number of concurrent virtual users/workers (default: 5, max recommended for agent: 50)" },
                        "max_requests": { "type": "integer", "description": "Total number of requests to execute (e.g. 50, 200, 1000)" },
                        "delay_ms": { "type": "integer", "description": "Delay in milliseconds between requests per worker (default: 20)" },
                        "mode": { "type": "string", "enum": ["smoke", "load", "spike", "stress"], "description": "Test profile label (default: load)" }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_probe_endpoint",
                "description": "Fire a single HTTP probe against a saved endpoint or ad-hoc URL, inspecting status, headers, body, latency, and assertion pass/fail results.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "endpoint_id": { "type": "string", "description": "Optional saved endpoint ID or name to probe" },
                        "url": { "type": "string", "description": "Target URL (e.g. /users or full https://...)" },
                        "method": { "type": "string", "description": "HTTP method (GET, POST, PUT, DELETE, etc.)" },
                        "headers": { "type": "object", "description": "HTTP headers dict" },
                        "payload": { "type": "object", "description": "JSON payload body" },
                        "assertions": { "type": "array", "description": "Optional assertions to verify against the response" }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_list_variables",
                "description": "List all active project, environment, and global variables.",
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
                "description": "Set or update an environment variable in the active Beacon project workspace.",
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

pub async fn execute_tool(name: &str, args: &Value, workspace: &dyn WorkspaceOps) -> Value {
    match name {
        "beacon_list_endpoints" => {
            let filter = args
                .get("filter")
                .and_then(|f| f.as_str())
                .unwrap_or("")
                .trim()
                .to_lowercase();
            let endpoints = workspace.list_endpoints();
            let filtered: Vec<Value> = endpoints
                .into_iter()
                .filter(|t| {
                    if filter.is_empty() {
                        true
                    } else {
                        t.name.to_lowercase().contains(&filter)
                            || t.url.to_lowercase().contains(&filter)
                            || t.method.to_lowercase().contains(&filter)
                    }
                })
                .map(|t| {
                    let assertions_summary: Vec<String> = t
                        .assertions
                        .iter()
                        .filter_map(|a| {
                            let a_type = a.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            let op = a.get("op").and_then(|v| v.as_str()).unwrap_or("eq");
                            let val = a.get("value").map(|v| v.to_string()).unwrap_or_default();
                            if !a_type.is_empty() {
                                Some(format!("{}: {} {}", a_type, op, val))
                            } else {
                                None
                            }
                        })
                        .collect();
                    let extractors_summary: Vec<String> = t
                        .extractors
                        .iter()
                        .map(|(k, v)| format!("{} <- {}", k, v))
                        .collect();
                    let auth_type = t
                        .auth
                        .as_ref()
                        .and_then(|a| a.get("type"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("none");

                    json!({
                        "id": t.id,
                        "name": t.name,
                        "method": t.method,
                        "url": t.url,
                        "assertions_count": t.assertions.len(),
                        "assertions": assertions_summary,
                        "extractors": extractors_summary,
                        "auth_type": auth_type,
                    })
                })
                .collect();
            json!({ "endpoints": filtered, "count": filtered.len() })
        }

        "beacon_get_endpoint" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
            if id.is_empty() {
                return json!({ "error": "Endpoint id is required" });
            }
            match workspace.get_endpoint(id) {
                Some(ep) => serde_json::to_value(&ep).unwrap_or(json!({ "error": "Serialization error" })),
                None => json!({ "error": format!("Endpoint '{}' not found", id) }),
            }
        }

        "beacon_create_endpoint" => {
            let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("").trim();
            if name.is_empty() || url.is_empty() {
                return json!({ "error": "'name' and 'url' are required to create an endpoint" });
            }
            let method = args
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("GET")
                .to_uppercase();

            let mut test = EndpointTest::new(
                Some(format!("ep_{}", Uuid::new_v4().simple())),
                name.to_string(),
                url.to_string(),
                Some(method),
            );

            if let Some(headers_obj) = args.get("headers").and_then(|h| h.as_object()) {
                test.headers = headers_obj
                    .iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect();
            }
            if let Some(payload) = args.get("payload") {
                test.payload = payload.clone();
            }
            if let Some(pt) = args.get("payload_type").and_then(|v| v.as_str()) {
                test.payload_type = pt.to_string();
            }
            if let Some(auth) = args.get("auth") {
                test.auth = Some(auth.clone());
            }
            if let Some(ext_obj) = args.get("extractors").and_then(|e| e.as_object()) {
                test.extractors = ext_obj
                    .iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect();
            }
            if let Some(assertions_arr) = args.get("assertions").and_then(|a| a.as_array()) {
                test.assertions = assertions_arr.clone();
            }

            match workspace.create_endpoint(test) {
                Ok(created) => json!({
                    "status": "created",
                    "mutated": true,
                    "endpoint": created,
                }),
                Err(err) => json!({ "error": err }),
            }
        }

        "beacon_update_endpoint" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
            if id.is_empty() {
                return json!({ "error": "Endpoint id is required for update" });
            }
            match workspace.update_endpoint(id, args.clone()) {
                Ok(updated) => json!({
                    "status": "updated",
                    "mutated": true,
                    "endpoint": updated,
                }),
                Err(err) => json!({ "error": err }),
            }
        }

        "beacon_delete_endpoint" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
            if id.is_empty() {
                return json!({ "error": "Endpoint id is required for deletion" });
            }
            match workspace.delete_endpoint(id) {
                Ok(msg) => json!({
                    "status": "deleted",
                    "mutated": true,
                    "message": msg,
                    "id": id,
                }),
                Err(err) => json!({ "error": err }),
            }
        }

        "beacon_run_collection" => {
            let config = workspace.get_config();
            let all_endpoints = workspace.list_endpoints();
            let stop_on_failure = args
                .get("stop_on_failure")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let targets: Vec<EndpointTest> = if let Some(ids) = args.get("endpoint_ids").and_then(|a| a.as_array()) {
                let needle_ids: Vec<String> = ids.iter().filter_map(|v| v.as_str().map(|s| s.trim().to_string())).collect();
                if needle_ids.is_empty() {
                    all_endpoints
                } else {
                    let mut selected = Vec::new();
                    for nid in needle_ids {
                        if let Some(ep) = all_endpoints.iter().find(|t| t.id == nid || t.name.eq_ignore_ascii_case(&nid)) {
                            selected.push(ep.clone());
                        }
                    }
                    selected
                }
            } else {
                all_endpoints
            };

            if targets.is_empty() {
                return json!({ "error": "No endpoints found in project to run collection" });
            }

            let mut step_results: Vec<Value> = Vec::new();
            let mut all_extracted: HashMap<String, String> = HashMap::new();
            let mut all_passed = true;
            let mut passed_count = 0;
            let mut failed_count = 0;

            for (idx, endpoint) in targets.into_iter().enumerate() {
                let tester = APITester::new(endpoint.clone(), config.clone(), 1, 0, 1, None);
                match tester.execute_single().await {
                    Ok(out) => {
                        let assertions_passed = out.assertions.iter().all(|a| a.ok);
                        let is_2xx_3xx = out.status >= 200 && out.status < 400;
                        let step_ok = is_2xx_3xx && assertions_passed;

                        if step_ok {
                            passed_count += 1;
                        } else {
                            failed_count += 1;
                            all_passed = false;
                        }

                        // Chain extracted variables forward to subsequent requests in this run
                        for var_name in &out.extracted {
                            if let Some(val) = config.variables.read().get(var_name) {
                                all_extracted.insert(var_name.clone(), val.clone());
                            }
                        }

                        step_results.push(json!({
                            "step": idx + 1,
                            "id": endpoint.id,
                            "name": endpoint.name,
                            "method": out.method,
                            "target_url": out.target_url,
                            "status": out.status,
                            "time_ms": out.time_ms,
                            "passed": step_ok,
                            "assertions_passed": assertions_passed,
                            "assertions": out.assertions,
                            "extracted": out.extracted,
                        }));

                        if !step_ok && stop_on_failure {
                            break;
                        }
                    }
                    Err(err) => {
                        failed_count += 1;
                        all_passed = false;
                        step_results.push(json!({
                            "step": idx + 1,
                            "id": endpoint.id,
                            "name": endpoint.name,
                            "error": err,
                            "passed": false,
                        }));
                        if stop_on_failure {
                            break;
                        }
                    }
                }
            }

            let mutated = !all_extracted.is_empty();
            if mutated {
                let _ = workspace.save_extracted_variables(all_extracted.clone());
            }

            json!({
                "status": if all_passed { "passed" } else { "failed" },
                "total_steps": step_results.len(),
                "passed_count": passed_count,
                "failed_count": failed_count,
                "all_passed": all_passed,
                "extracted_variables": all_extracted,
                "steps": step_results,
                "mutated": mutated,
            })
        }

        "beacon_run_load_test" => {
            let config = workspace.get_config();
            let concurrency = args
                .get("concurrency")
                .and_then(|v| v.as_u64())
                .unwrap_or(5)
                .min(50) as usize;
            let max_requests = args
                .get("max_requests")
                .and_then(|v| v.as_u64())
                .unwrap_or(50)
                .min(2000);
            let delay_ms = args.get("delay_ms").and_then(|v| v.as_u64()).unwrap_or(20);
            let mode = args
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("load")
                .to_string();

            let target_endpoint: Option<EndpointTest> = if let Some(epid) = args.get("endpoint_id").and_then(|v| v.as_str()) {
                workspace.get_endpoint(epid)
            } else if let Some(url) = args.get("url").and_then(|v| v.as_str()) {
                let method = args.get("method").and_then(|v| v.as_str()).unwrap_or("GET");
                Some(EndpointTest::new(None, "Ad-hoc Load Test".into(), url.into(), Some(method.into())))
            } else {
                workspace.list_endpoints().first().cloned()
            };

            let endpoint = match target_endpoint {
                Some(ep) => ep,
                None => return json!({ "error": "No target endpoint specified or available in project" }),
            };

            let target_desc = format!("{} {}", endpoint.method, endpoint.url);
            let tester = APITester::new(endpoint, config, concurrency, delay_ms, max_requests, None);

            let snap = tester.run_load(|_, _| {}).await;

            let success_pct = if snap.attempts > 0 {
                (snap.success as f64 / snap.attempts as f64) * 100.0
            } else {
                0.0
            };
            let rate_limited_pct = if snap.attempts > 0 {
                (snap.rate_limited as f64 / snap.attempts as f64) * 100.0
            } else {
                0.0
            };

            json!({
                "mode": mode,
                "target": target_desc,
                "concurrency": concurrency,
                "attempts": snap.attempts,
                "success": snap.success,
                "rate_limited": snap.rate_limited,
                "errors": snap.errors,
                "status_codes": snap.status_codes,
                "throughput_rps": (snap.rps * 10.0).round() / 10.0,
                "elapsed_s": (snap.elapsed_s * 100.0).round() / 100.0,
                "latency_percentiles_ms": {
                    "avg": snap.latency_ms.avg,
                    "min": snap.latency_ms.min,
                    "max": snap.latency_ms.max,
                    "p50": snap.latency_ms.p50,
                    "p75": snap.latency_ms.p75,
                    "p90": snap.latency_ms.p90,
                    "p95": snap.latency_ms.p95,
                    "p99": snap.latency_ms.p99,
                },
                "summary": format!(
                    "Completed {} requests (concurrency: {}). {} success ({:.1}%), {} rate limited ({:.1}%), {} errors. Throughput: {:.1} RPS. Latency: p50={}ms, p95={}ms, max={}ms.",
                    snap.attempts, concurrency, snap.success, success_pct, snap.rate_limited, rate_limited_pct, snap.errors, snap.rps, snap.latency_ms.p50, snap.latency_ms.p95, snap.latency_ms.max
                )
            })
        }

        "beacon_probe_endpoint" => {
            let config = workspace.get_config();
            let mut test = if let Some(epid) = args.get("endpoint_id").and_then(|v| v.as_str()) {
                match workspace.get_endpoint(epid) {
                    Some(ep) => ep,
                    None => return json!({ "error": format!("Endpoint '{}' not found", epid) }),
                }
            } else {
                let url = args.get("url").and_then(|u| u.as_str()).unwrap_or("/");
                let method = args.get("method").and_then(|m| m.as_str()).unwrap_or("GET");
                let headers: HashMap<String, Value> = args
                    .get("headers")
                    .and_then(|h| serde_json::from_value(h.clone()).ok())
                    .unwrap_or_default();
                let payload = args.get("payload").cloned().unwrap_or(Value::Null);

                let mut t = EndpointTest::new(
                    Some("probe-adhoc".to_string()),
                    "Probe".to_string(),
                    url.to_string(),
                    Some(method.to_string()),
                );
                t.headers = headers;
                t.payload = payload;
                t
            };

            if let Some(assertions_override) = args.get("assertions").and_then(|a| a.as_array()) {
                test.assertions = assertions_override.clone();
            }

            let tester = APITester::new(test, config, 1, 0, 1, None);
            match tester.execute_single().await {
                Ok(out) => json!({
                    "status": out.status,
                    "time_ms": out.time_ms,
                    "target_url": out.target_url,
                    "headers": out.headers,
                    "body": out.body,
                    "json": out.json,
                    "assertions": out.assertions,
                    "extracted": out.extracted,
                    "passed": out.status >= 200 && out.status < 400 && out.assertions.iter().all(|a| a.ok),
                }),
                Err(err) => json!({ "error": err }),
            }
        }

        "beacon_list_variables" => {
            let config = workspace.get_config();
            let vars = config.snapshot_variables();
            json!({ "variables": vars, "count": vars.len() })
        }

        "beacon_set_variable" => {
            let var_name = args.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
            let var_val = args.get("value").and_then(|v| v.as_str()).unwrap_or("");
            if !var_name.is_empty() {
                match workspace.set_variable(var_name, var_val) {
                    Ok(_) => json!({
                        "status": "updated",
                        "mutated": true,
                        "name": var_name,
                        "value": var_val,
                    }),
                    Err(err) => json!({ "error": err }),
                }
            } else {
                json!({ "error": "'name' is required" })
            }
        }

        _ => json!({ "error": format!("Unknown tool: {}", name) }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, RwLock};

    struct InMemoryWorkspace {
        config: TestConfig,
        endpoints: Arc<RwLock<Vec<EndpointTest>>>,
    }

    impl InMemoryWorkspace {
        fn new() -> Self {
            let mut ep1 = EndpointTest::new(
                Some("ep-1".into()),
                "Get Posts".into(),
                "https://jsonplaceholder.typicode.com/posts".into(),
                Some("GET".into()),
            );
            ep1.assertions = vec![json!({
                "type": "status_code",
                "op": "eq",
                "value": 200
            })];
            let config = TestConfig::new(
                "https://jsonplaceholder.typicode.com".into(),
                HashMap::new(),
                vec![ep1.clone()],
            );
            Self {
                config,
                endpoints: Arc::new(RwLock::new(vec![ep1])),
            }
        }
    }

    impl WorkspaceOps for InMemoryWorkspace {
        fn get_config(&self) -> TestConfig {
            let mut cfg = self.config.clone();
            cfg.tests = self.endpoints.read().unwrap().clone();
            cfg
        }
        fn get_endpoint(&self, id_or_name: &str) -> Option<EndpointTest> {
            let needle = id_or_name.trim();
            self.endpoints
                .read()
                .unwrap()
                .iter()
                .find(|t| t.id == needle || t.name.eq_ignore_ascii_case(needle))
                .cloned()
        }
        fn list_endpoints(&self) -> Vec<EndpointTest> {
            self.endpoints.read().unwrap().clone()
        }
        fn create_endpoint(&self, test: EndpointTest) -> Result<EndpointTest, String> {
            self.endpoints.write().unwrap().push(test.clone());
            Ok(test)
        }
        fn update_endpoint(&self, id_or_name: &str, patch: Value) -> Result<EndpointTest, String> {
            let needle = id_or_name.trim();
            let mut lock = self.endpoints.write().unwrap();
            let idx = lock
                .iter()
                .position(|t| t.id == needle || t.name.eq_ignore_ascii_case(needle))
                .ok_or_else(|| format!("Endpoint '{}' not found", needle))?;

            let mut val = serde_json::to_value(&lock[idx]).unwrap();
            if let (Some(dest), Some(src)) = (val.as_object_mut(), patch.as_object()) {
                for (k, v) in src {
                    if k != "id" && !v.is_null() {
                        dest.insert(k.clone(), v.clone());
                    }
                }
            }
            let updated: EndpointTest = serde_json::from_value(val).unwrap();
            lock[idx] = updated.clone();
            Ok(updated)
        }
        fn delete_endpoint(&self, id_or_name: &str) -> Result<String, String> {
            let needle = id_or_name.trim();
            let mut lock = self.endpoints.write().unwrap();
            let len = lock.len();
            lock.retain(|t| t.id != needle && !t.name.eq_ignore_ascii_case(needle));
            if lock.len() == len {
                Err(format!("Endpoint '{}' not found", needle))
            } else {
                Ok(format!("Deleted {}", needle))
            }
        }
        fn set_variable(&self, name: &str, value: &str) -> Result<(), String> {
            self.config.variables.write().insert(name.to_string(), value.to_string());
            Ok(())
        }
        fn save_extracted_variables(&self, vars: HashMap<String, String>) -> Result<(), String> {
            let mut v = self.config.variables.write();
            for (k, val) in vars {
                v.insert(k, val);
            }
            Ok(())
        }
    }

    #[tokio::test]
    async fn test_agent_endpoint_lifecycle() {
        let ws = InMemoryWorkspace::new();

        // 1. List endpoints
        let list_res = execute_tool("beacon_list_endpoints", &json!({}), &ws).await;
        assert_eq!(list_res["count"], 1);

        // 2. Create endpoint with assertions
        let create_args = json!({
            "name": "Create Post",
            "url": "{{base_url}}/posts",
            "method": "POST",
            "headers": { "Content-Type": "application/json" },
            "payload": { "title": "Test Title", "body": "Test Body" },
            "extractors": { "post_id": "body.id" },
            "assertions": [
                { "type": "status_code", "op": "eq", "value": 201 },
                { "type": "response_time", "op": "lt", "value": 1500 }
            ]
        });
        let create_res = execute_tool("beacon_create_endpoint", &create_args, &ws).await;
        assert_eq!(create_res["status"], "created");
        assert_eq!(create_res["mutated"], true);
        let created_id = create_res["endpoint"]["id"].as_str().unwrap().to_string();

        // 3. Get endpoint metadata
        let get_res = execute_tool("beacon_get_endpoint", &json!({ "id": created_id }), &ws).await;
        assert_eq!(get_res["name"], "Create Post");
        assert_eq!(get_res["assertions"].as_array().unwrap().len(), 2);

        // 4. Update endpoint URL & assertions
        let update_args = json!({
            "id": created_id,
            "url": "{{base_url}}/posts-v2",
            "assertions": [
                { "type": "status_code", "op": "eq", "value": 201 },
                { "type": "header", "name": "content-type", "op": "contains", "value": "json" }
            ]
        });
        let update_res = execute_tool("beacon_update_endpoint", &update_args, &ws).await;
        assert_eq!(update_res["status"], "updated");
        assert_eq!(update_res["endpoint"]["url"], "{{base_url}}/posts-v2");

        // 5. Delete endpoint
        let del_res = execute_tool("beacon_delete_endpoint", &json!({ "id": created_id }), &ws).await;
        assert_eq!(del_res["status"], "deleted");
        assert_eq!(ws.list_endpoints().len(), 1);
    }

    #[tokio::test]
    async fn test_agent_collection_runner_and_chaining() {
        let ws = InMemoryWorkspace::new();
        let collection_res = execute_tool("beacon_run_collection", &json!({}), &ws).await;
        assert_eq!(collection_res["total_steps"], 1);
        assert!(collection_res["steps"].as_array().unwrap().len() > 0);
    }
}
