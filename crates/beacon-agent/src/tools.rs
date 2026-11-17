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
    /// Clones an endpoint (fresh id, name suffixed "(copy)"). Default impl is
    /// get+create; a store-backed workspace may override with an atomic version.
    fn duplicate_endpoint(&self, id_or_name: &str) -> Result<EndpointTest, String> {
        let orig = self
            .get_endpoint(id_or_name)
            .ok_or_else(|| format!("Endpoint '{}' not found", id_or_name))?;
        let mut copy = orig;
        copy.id = format!("ep_{}", Uuid::new_v4().simple());
        copy.name = format!("{} (copy)", copy.name);
        self.create_endpoint(copy)
    }
    fn set_variable(&self, name: &str, value: &str) -> Result<(), String>;
    fn save_extracted_variables(&self, vars: HashMap<String, String>) -> Result<(), String>;
    fn list_projects(&self) -> Vec<Value>;
    fn switch_project(&self, id_or_name: &str) -> Result<Value, String>;
    fn create_project(&self, name: &str, base_url: &str) -> Result<Value, String>;
    /// Scans a source tree (local folder path, "owner/repo", or a GitHub URL) for API
    /// routes, specs, frameworks and auth. Workspaces without code access say so.
    fn analyze_code<'a>(&'a self, _source: &'a str, _branch: Option<&'a str>) -> futures::future::BoxFuture<'a, Result<Value, String>> {
        Box::pin(async { Err("Code analysis is not available in this workspace".to_string()) })
    }
    /// Turns the last analysis of `source` into requests: a new project (made active),
    /// or the active project when `into_active`. `endpoints` overrides the detected list.
    fn import_code(&self, _source: &str, _project_name: &str, _base_url: &str, _into_active: bool, _endpoints: Option<Vec<Value>>) -> Result<Value, String> {
        Err("Code import is not available in this workspace".to_string())
    }
    /// The active project's collection tree (folders + requests).
    fn get_collection(&self) -> Vec<Value> {
        self.list_endpoints().into_iter().filter_map(|t| serde_json::to_value(t).ok()).map(|mut v| { v["type"] = json!("request"); v }).collect()
    }
    /// Replaces the active project's collection tree.
    fn set_collection(&self, _items: Vec<Value>) -> Result<(), String> {
        Err("Folders are not supported in this workspace".into())
    }
    /// Imports a normalized collection's items into the active project, inside
    /// `into_folder` (name, id, or "Parent/Child" path) if given, else a new
    /// top-level folder named after the import. Returns the folder it landed in.
    fn import_items(&self, items: Vec<Value>, folder_name: &str, into_folder: Option<&str>) -> Result<Value, String> {
        let tree = self.get_collection();
        let mut ops = Vec::new();
        let target = if let Some(into) = into_folder.filter(|f| !f.trim().is_empty()) {
            into.to_string()
        } else {
            ops.push(json!({ "op": "create_folder", "name": folder_name }));
            folder_name.to_string()
        };
        let mut next_tree = if ops.is_empty() { tree } else { crate::collection::apply_all(&tree, &ops)?.0 };
        crate::collection::insert_into_folder(&mut next_tree, &target, items)
            .ok_or_else(|| format!("Folder '{target}' not found"))?;
        self.set_collection(next_tree)?;
        Ok(json!(target))
    }
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
    fn list_projects(&self) -> Vec<Value> {
        vec![json!({
            "id": "standalone",
            "name": "Active Workspace",
            "is_active": true,
            "base_url": self.0.base_url,
            "endpoints_count": self.0.tests.len(),
        })]
    }
    fn switch_project(&self, _id_or_name: &str) -> Result<Value, String> {
        Err("Project switching not supported in standalone config mode".into())
    }
    fn create_project(&self, _name: &str, _base_url: &str) -> Result<Value, String> {
        Err("Project creation not supported in standalone config mode".into())
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
                "name": "beacon_search_endpoints",
                "description": "Paginated, compact endpoint search for large projects so results don't flood context. Matches case-insensitively across id, name, method, and URL. Use beacon_get_endpoint for full details of one result.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Optional keyword to filter by" },
                        "offset": { "type": "integer", "description": "0-based offset into the matching set (default 0)" },
                        "limit": { "type": "integer", "description": "Max results to return, 1-200 (default 50)" }
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
                "description": "Create a new API endpoint in the ACTIVE Beacon project. If the endpoint belongs to a different API family than the active project, switch or create the right project first (or ask the user). Automatically persists and updates the UI.",
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
                        "folder": { "type": "string", "description": "Optional folder (name, id, or 'Parent/Child' path) to place the endpoint in. Created if missing." },
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
                "name": "beacon_set_example_response",
                "description": "Document the expected response contract of an endpoint by hand (e.g. after reading the handler source code). Saves status, headers and body as the endpoint's documented example and mock baseline, which exports (OpenAPI, Postman, HTML docs) and the mock server use.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string", "description": "Endpoint ID or name" },
                        "status": { "type": "integer", "description": "HTTP status code of the example (default 200)" },
                        "body": { "description": "Example response body: a JSON object/array or a raw string" },
                        "headers": { "type": "object", "description": "Example response headers (default Content-Type: application/json)" },
                        "enabled": { "type": "boolean", "description": "Also serve this example from the mock server (default false)" }
                    },
                    "required": ["id", "body"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_capture_baseline",
                "description": "Fire the endpoint once against the live API and save the real response as its documented example and mock baseline. Optionally auto-generates assertions (status code, latency SLA, content-type, first JSON key).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string", "description": "Endpoint ID or name" },
                        "generate_assertions": { "type": "boolean", "description": "Add smart assertions derived from the live response (default true)" }
                    },
                    "required": ["id"]
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
                "description": "Set or update an environment variable in the ACTIVE project's environment. Variables for a different API family belong in that API's own project; create/switch first.",
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
        json!({
            "type": "function",
            "function": {
                "name": "beacon_get_collection",
                "description": "Show the ACTIVE project's collection tree: folders and the endpoints inside them, in display order. Call this before organizing so you use real ids and names.",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_organize_collection",
                "description": "Organize the ACTIVE project's collection: create, rename, or delete folders (nested allowed), move endpoints or folders between folders, and reorder items. Pass ALL steps in one call; they apply atomically in order (if one fails, nothing is saved). Endpoints are never lost: deleting a folder keeps its contents unless delete_contents is true. Folders and items are referenced by id, name, or 'Parent/Child' path.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "operations": {
                            "type": "array",
                            "description": "Ordered steps. Examples: {op:'create_folder', name:'Discount', parent?:'Admin'} | {op:'rename_folder', folder:'Disc', name:'Discount'} | {op:'delete_folder', folder:'Old', delete_contents?:false} | {op:'move', items:['Add Discount','ep_123'], to:'Discount' (or null for top level), index?:0} | {op:'reorder', parent?:'Discount' (omit for top level), order:['List Discount','Add Discount']}",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "op": { "type": "string", "enum": ["create_folder", "rename_folder", "delete_folder", "move", "reorder"] },
                                    "name": { "type": "string" },
                                    "parent": { "type": "string" },
                                    "folder": { "type": "string" },
                                    "items": { "type": "array", "items": { "type": "string" } },
                                    "to": { "type": ["string", "null"] },
                                    "index": { "type": "integer" },
                                    "order": { "type": "array", "items": { "type": "string" } },
                                    "delete_contents": { "type": "boolean" }
                                },
                                "required": ["op"]
                            }
                        }
                    },
                    "required": ["operations"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_list_projects",
                "description": "List all projects configured in the user's Beacon workspace, indicating which project is currently active/in-focus, its base URL, environment, and endpoint count.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_switch_project",
                "description": "Switch the active Beacon project workspace to another project by its ID or name (e.g. 'K-MOTION API' or 'JSONPlaceholder API'). Updates the active workspace context and syncs the UI in real time.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project": { "type": "string", "description": "Project ID or project name to switch to" }
                    },
                    "required": ["project"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_create_project",
                "description": "Create a new project workspace in Beacon with a name and optional base URL, and switch to it immediately. Use this when the user asks for endpoints of a new API family (e.g. 'Google APIs') that does not match the active project.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Name of the new project" },
                        "base_url": { "type": "string", "description": "Optional base URL (e.g. 'https://api.myproject.com')" }
                    },
                    "required": ["name"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_get_config",
                "description": "Return the active project's base URL, environment name, variable NAMES (never values, since they may hold secrets/tokens), and endpoint count.",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_duplicate_endpoint",
                "description": "Duplicate an endpoint (fresh id, name suffixed '(copy)'). The copy is added at the project root; use beacon_organize_collection to move it into a folder.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string", "description": "Endpoint ID or name to duplicate" }
                    },
                    "required": ["id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_run_endpoint",
                "description": "Fire ONE saved endpoint repeatedly (optionally concurrently) and return load stats: attempts, success, rate_limited, errors, throughput, and latency percentiles. Alias of beacon_run_load_test scoped to a saved endpoint_id (use beacon_run_load_test directly for ad-hoc URLs).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string", "description": "Endpoint ID or name to run" },
                        "concurrency": { "type": "integer", "description": "Concurrent workers (default 5, max 50)" },
                        "max_requests": { "type": "integer", "description": "Total requests to execute (default 50)" },
                        "delay_ms": { "type": "integer", "description": "Delay in ms between requests per worker (default 20)" }
                    },
                    "required": ["id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_add_endpoint_from_curl",
                "description": "Create an endpoint by parsing a `curl` command string: -X/--request, -H/--header, -d/--data/--data-raw/--data-binary, -u/--user (becomes a Basic auth header), --url or a bare URL. Handles quotes and backslash line continuations.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "curl": { "type": "string", "description": "The full curl command" },
                        "name": { "type": "string", "description": "Short human name for the endpoint (default: derived from the URL)" },
                        "folder": { "type": "string", "description": "Optional folder (name, id, or 'Parent/Child' path) to place it in" }
                    },
                    "required": ["curl"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_import_collection",
                "description": "Import a collection/spec into the active project: Beacon export, Postman v2, OpenAPI 3, Swagger 2 (JSON or YAML), Insomnia export, or HAR. Pass the parsed JSON directly, or {content, filename} for raw JSON/YAML text. Lands inside into_folder if given, else a new folder named after the source.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "data": { "description": "The collection/spec as a JSON object, or {content: string, filename?: string}" },
                        "into_folder": { "type": "string", "description": "Optional existing folder (name, id, or 'Parent/Child' path) to import into" }
                    },
                    "required": ["data"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_analyze_code",
                "description": "Analyze a codebase to discover its API: routes (Express, FastAPI, Flask, Django, Laravel, Spring, Gin, Axum, Next.js, NestJS, Rails…), OpenAPI/Swagger specs, frameworks, auth scheme and a suggested base URL. Source is a local folder path (e.g. ~/code/shop-api) or a GitHub repo ('owner/repo' or https://github.com/owner/repo, needs GitHub connected in Settings). Read-only. Follow with beacon_import_code to turn it into a project.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "source": { "type": "string", "description": "Local folder path, 'owner/repo', or GitHub URL" },
                        "branch": { "type": "string", "description": "GitHub branch (default: the repo's default branch)" }
                    },
                    "required": ["source"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "beacon_import_code",
                "description": "Create requests from the last beacon_analyze_code of the same source: a new project (default, becomes active) with a Default environment holding base_url, or the active project with into_active_project. Requests are grouped in folders per module. Pass 'endpoints' to import your own corrected/complete list (e.g. after reading the code: fix names, folders, sample bodies, drop internal routes) instead of the detected one.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "source": { "type": "string", "description": "Same source you analyzed" },
                        "project_name": { "type": "string", "description": "Name for the new project (default: the repo/folder name)" },
                        "base_url": { "type": "string", "description": "Base URL (default: the detected one)" },
                        "into_active_project": { "type": "boolean", "description": "Add to the active project instead of creating one" },
                        "endpoints": {
                            "type": "array",
                            "description": "Optional curated list replacing the detected endpoints",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "method": { "type": "string" },
                                    "path": { "type": "string", "description": "Path only, e.g. /users/{id}" },
                                    "name": { "type": "string" },
                                    "folder": { "type": "string" },
                                    "description": { "type": "string" },
                                    "sample_body": { "description": "JSON body for POST/PUT/PATCH" }
                                },
                                "required": ["method", "path"]
                            }
                        }
                    },
                    "required": ["source"]
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
                Ok(created) => {
                    let mut out = json!({ "status": "created", "mutated": true, "endpoint": created });
                    if let Some(folder) = args.get("folder").and_then(|v| v.as_str()).filter(|f| !f.trim().is_empty()) {
                        out["folder"] = place_in_folder(workspace, &created.id, folder);
                    }
                    out
                }
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

        "beacon_run_load_test" => run_load(args, workspace).await,

        // Alias of beacon_run_load_test scoped to a saved endpoint (`id` -> `endpoint_id`),
        // per the ported Python `run_endpoint` tool; same stats shape, no ad-hoc URL support.
        "beacon_run_endpoint" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
            if id.is_empty() {
                return json!({ "error": "Endpoint id is required" });
            }
            if workspace.get_endpoint(id).is_none() {
                return json!({ "error": format!("Endpoint '{}' not found", id) });
            }
            let mut load_args = args.clone();
            if let Some(obj) = load_args.as_object_mut() {
                obj.insert("endpoint_id".into(), json!(id));
            }
            run_load(&load_args, workspace).await
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

        "beacon_set_example_response" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
            if id.is_empty() {
                return json!({ "error": "Endpoint id is required" });
            }
            let body = match args.get("body") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Null) | None => return json!({ "error": "'body' is required" }),
                Some(other) => serde_json::to_string_pretty(other).unwrap_or_default(),
            };
            let mut headers = args.get("headers").cloned().unwrap_or(json!({}));
            if headers.as_object().map_or(true, |h| h.is_empty()) {
                headers = json!({ "Content-Type": "application/json" });
            }
            let mock = json!({
                "enabled": args.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false),
                "status": args.get("status").and_then(|v| v.as_u64()).unwrap_or(200),
                "headers": headers,
                "body": body,
            });
            match workspace.update_endpoint(id, json!({ "mock_response": mock })) {
                Ok(ep) => json!({ "status": "documented", "mutated": true, "id": ep.id, "mock_response": ep.mock_response }),
                Err(err) => json!({ "error": err }),
            }
        }

        "beacon_capture_baseline" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
            let test = match workspace.get_endpoint(id) {
                Some(ep) => ep,
                None => return json!({ "error": format!("Endpoint '{}' not found", id) }),
            };
            let generate = args.get("generate_assertions").and_then(|v| v.as_bool()).unwrap_or(true);
            let tester = APITester::new(test.clone(), workspace.get_config(), 1, 0, 1, None);
            let out = match tester.execute_single().await {
                Ok(out) => out,
                Err(err) => return json!({ "error": err }),
            };
            let content_type = out
                .headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
                .map(|(_, v)| v.clone())
                .unwrap_or_else(|| "application/json".into());
            let body = match &out.json {
                Some(j) => serde_json::to_string_pretty(j).unwrap_or_default(),
                None => out.body.clone(),
            };
            let mut patch = json!({
                "mock_response": {
                    "enabled": test.mock_response.as_ref().and_then(|m| m.get("enabled")).and_then(|v| v.as_bool()).unwrap_or(false),
                    "status": out.status,
                    "headers": { "Content-Type": content_type },
                    "body": body,
                }
            });
            let mut added = Vec::new();
            if generate {
                // Mirrors the editor's "Generate assertions" button; same type names as assertions.rs.
                let mut assertions = test.assertions.clone();
                let has = |a: &Vec<Value>, t: &str| a.iter().any(|x| x.get("type").and_then(|v| v.as_str()) == Some(t));
                if !has(&assertions, "status") {
                    assertions.push(json!({ "type": "status", "op": "eq", "value": out.status }));
                    added.push("status");
                }
                if !has(&assertions, "time_ms") {
                    let budget = ((out.time_ms * 3.0).max(500.0) / 100.0).ceil() * 100.0;
                    assertions.push(json!({ "type": "time_ms", "op": "lt", "value": budget as i64 }));
                    added.push("time_ms");
                }
                if !has(&assertions, "header") {
                    let ct = content_type.split(';').next().unwrap_or("").trim().to_string();
                    if !ct.is_empty() {
                        assertions.push(json!({ "type": "header", "name": "content-type", "op": "contains", "value": ct }));
                        added.push("header");
                    }
                }
                if let Some(first_key) = out.json.as_ref().and_then(|j| j.as_object()).and_then(|o| o.keys().next()) {
                    if !has(&assertions, "jsonpath") {
                        assertions.push(json!({ "type": "jsonpath", "path": format!("body.{}", first_key), "op": "exists" }));
                        added.push("jsonpath");
                    }
                }
                patch["assertions"] = Value::Array(assertions);
            }
            match workspace.update_endpoint(&test.id, patch) {
                Ok(ep) => json!({
                    "status": "captured",
                    "mutated": true,
                    "id": ep.id,
                    "http_status": out.status,
                    "time_ms": out.time_ms,
                    "assertions_added": added,
                    "assertions_count": ep.assertions.len(),
                    "example_preview": out.body.chars().take(400).collect::<String>(),
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

        "beacon_get_collection" => {
            let tree = workspace.get_collection();
            json!({ "tree": crate::collection::summarize(&tree) })
        }

        "beacon_organize_collection" => {
            let ops = match args.get("operations").and_then(|o| o.as_array()) {
                Some(o) if !o.is_empty() => o.clone(),
                _ => return json!({ "error": "'operations' must be a non-empty array" }),
            };
            match crate::collection::apply_all(&workspace.get_collection(), &ops) {
                Ok((tree, log)) => match workspace.set_collection(tree.clone()) {
                    Ok(()) => json!({
                        "status": "organized",
                        "mutated": true,
                        "summary": log.join("; "),
                        "changes": log,
                        "tree": crate::collection::summarize(&tree),
                    }),
                    Err(e) => json!({ "error": e }),
                },
                Err(e) => json!({ "error": e }),
            }
        }

        "beacon_list_projects" => {
            let list = workspace.list_projects();
            json!({ "projects": list, "count": list.len() })
        }

        "beacon_switch_project" => {
            let target = args.get("project").and_then(|v| v.as_str()).unwrap_or("").trim();
            if target.is_empty() {
                return json!({ "error": "Project name or ID is required to switch" });
            }
            match workspace.switch_project(target) {
                Ok(info) => json!({
                    "status": "switched",
                    "mutated": true,
                    "active_project": info,
                }),
                Err(err) => json!({ "error": err }),
            }
        }

        "beacon_create_project" => {
            let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
            let base_url = args.get("base_url").and_then(|v| v.as_str()).unwrap_or("").trim();
            if name.is_empty() {
                return json!({ "error": "Project name is required" });
            }
            match workspace.create_project(name, base_url) {
                Ok(info) => json!({
                    "status": "created",
                    "mutated": true,
                    "active_project": info,
                }),
                Err(err) => json!({ "error": err }),
            }
        }

        "beacon_search_endpoints" => {
            let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("").trim().to_lowercase();
            let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let limit = (args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize).clamp(1, 200);
            let all = workspace.list_endpoints();
            let matching: Vec<&EndpointTest> = all
                .iter()
                .filter(|t| {
                    query.is_empty()
                        || format!("{} {} {} {}", t.id, t.name, t.method, t.url).to_lowercase().contains(&query)
                })
                .collect();
            let total = matching.len();
            let page: Vec<Value> = matching
                .into_iter()
                .skip(offset)
                .take(limit)
                .map(|t| json!({ "id": t.id, "name": t.name, "method": t.method, "url": t.url }))
                .collect();
            let has_more = offset + page.len() < total;
            json!({ "items": page, "total": total, "offset": offset, "limit": limit, "has_more": has_more })
        }

        "beacon_get_config" => {
            let config = workspace.get_config();
            let mut names: Vec<String> = config.snapshot_variables().into_keys().collect();
            names.sort();
            json!({
                "base_url": config.base_url,
                "variables": names,
                "endpoint_count": config.tests.len(),
            })
        }

        "beacon_duplicate_endpoint" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
            if id.is_empty() {
                return json!({ "error": "Endpoint id is required" });
            }
            match workspace.duplicate_endpoint(id) {
                Ok(copy) => json!({ "status": "duplicated", "mutated": true, "endpoint": copy }),
                Err(err) => json!({ "error": err }),
            }
        }

        "beacon_add_endpoint_from_curl" => {
            let curl_str = args.get("curl").and_then(|v| v.as_str()).unwrap_or("");
            let parsed = match crate::curl::parse_curl(curl_str) {
                Ok(p) => p,
                Err(err) => return json!({ "error": err }),
            };
            let name = args
                .get("name")
                .and_then(|v| v.as_str())
                .filter(|n| !n.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| parsed.url.clone());
            let mut test = EndpointTest::new(
                Some(format!("ep_{}", Uuid::new_v4().simple())),
                name,
                parsed.url,
                Some(parsed.method),
            );
            test.headers = parsed.headers.into_iter().map(|(k, v)| (k, json!(v))).collect();
            test.payload = parsed.payload;
            test.payload_type = parsed.payload_type;
            match workspace.create_endpoint(test) {
                Ok(created) => {
                    let mut out = json!({ "status": "created", "mutated": true, "endpoint": created });
                    if let Some(folder) = args.get("folder").and_then(|v| v.as_str()).filter(|f| !f.trim().is_empty()) {
                        out["folder"] = place_in_folder(workspace, &created.id, folder);
                    }
                    out
                }
                Err(err) => json!({ "error": err }),
            }
        }

        "beacon_import_collection" => {
            let Some(data) = args.get("data") else {
                return json!({ "error": "'data' is required" });
            };
            let normalized = match beacon_core::normalize_import(data) {
                Ok(n) => n,
                Err(err) => return json!({ "error": err }),
            };
            let into_folder = args.get("into_folder").and_then(|v| v.as_str());
            match workspace.import_items(normalized.items, &normalized.name, into_folder) {
                Ok(folder) => json!({
                    "status": "imported",
                    "mutated": true,
                    "format": normalized.format,
                    "format_label": normalized.format_label,
                    "imported": normalized.endpoints_count,
                    "folders": normalized.folders_count,
                    "into_folder": folder,
                    "warnings": normalized.warnings,
                }),
                Err(err) => json!({ "error": err }),
            }
        }

        "beacon_analyze_code" => {
            let Some(source) = args.get("source").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) else {
                return json!({ "error": "'source' is required" });
            };
            let branch = args.get("branch").and_then(|v| v.as_str()).filter(|b| !b.trim().is_empty());
            match workspace.analyze_code(source, branch).await {
                Ok(analysis) => analysis,
                Err(err) => json!({ "error": err }),
            }
        }

        "beacon_import_code" => {
            let Some(source) = args.get("source").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) else {
                return json!({ "error": "'source' is required" });
            };
            let text = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let into_active = args.get("into_active_project").and_then(|v| v.as_bool()).unwrap_or(false);
            let endpoints = args.get("endpoints").and_then(|v| v.as_array()).cloned();
            match workspace.import_code(source, &text("project_name"), &text("base_url"), into_active, endpoints) {
                Ok(mut out) => {
                    out["mutated"] = json!(true);
                    out
                }
                Err(err) => json!({ "error": err }),
            }
        }

        _ => json!({ "error": format!("Unknown tool: {}", name) }),
    }
}

/// Moves an existing endpoint (by id) into `folder` (name or "Parent/Child" path),
/// creating any missing levels of the path. Returns the folder path on success or
/// an `{"error": ...}` value; the endpoint stays at the top level either way.
fn place_in_folder(workspace: &dyn WorkspaceOps, endpoint_id: &str, folder: &str) -> Value {
    let mut ops = Vec::new();
    let mut parent: Option<String> = None;
    for part in folder.split('/').map(str::trim).filter(|p| !p.is_empty()) {
        ops.push(json!({ "op": "create_folder", "name": part, "parent": parent }));
        parent = Some(parent.map(|p| format!("{p}/{part}")).unwrap_or_else(|| part.to_string()));
    }
    ops.push(json!({ "op": "move", "items": [endpoint_id], "to": folder }));
    match crate::collection::apply_all(&workspace.get_collection(), &ops).and_then(|(tree, _)| workspace.set_collection(tree)) {
        Ok(()) => json!(folder),
        Err(e) => json!({ "error": format!("Endpoint created at the top level; folder placement failed: {e}") }),
    }
}

async fn run_load(args: &Value, workspace: &dyn WorkspaceOps) -> Value {
    let config = workspace.get_config();
    let concurrency = args.get("concurrency").and_then(|v| v.as_u64()).unwrap_or(5).min(50) as usize;
    let max_requests = args.get("max_requests").and_then(|v| v.as_u64()).unwrap_or(50).min(2000);
    let delay_ms = args.get("delay_ms").and_then(|v| v.as_u64()).unwrap_or(20);
    let mode = args.get("mode").and_then(|v| v.as_str()).unwrap_or("load").to_string();

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

    let success_pct = if snap.attempts > 0 { (snap.success as f64 / snap.attempts as f64) * 100.0 } else { 0.0 };
    let rate_limited_pct = if snap.attempts > 0 { (snap.rate_limited as f64 / snap.attempts as f64) * 100.0 } else { 0.0 };

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, RwLock};

    struct InMemoryWorkspace {
        config: TestConfig,
        endpoints: Arc<RwLock<Vec<EndpointTest>>>,
        tree: Arc<RwLock<Option<Vec<Value>>>>,
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
                tree: Arc::new(RwLock::new(None)),
            }
        }
    }

    impl WorkspaceOps for InMemoryWorkspace {
        fn get_collection(&self) -> Vec<Value> {
            // Like the real store: tree order wins, endpoints missing from it are appended.
            let eps: Vec<Value> = self.endpoints.read().unwrap().iter().map(|e| { let mut v = serde_json::to_value(e).unwrap(); v["type"] = json!("request"); v }).collect();
            let mut tree = self.tree.read().unwrap().clone().unwrap_or_default();
            let flat = serde_json::to_string(&tree).unwrap();
            for e in eps { if !flat.contains(e["id"].as_str().unwrap()) { tree.push(e); } }
            tree
        }
        fn set_collection(&self, items: Vec<Value>) -> Result<(), String> {
            *self.tree.write().unwrap() = Some(items);
            Ok(())
        }
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
        fn list_projects(&self) -> Vec<Value> {
            vec![json!({
                "id": "proj-1",
                "name": "Default Project",
                "is_active": true,
                "base_url": "https://jsonplaceholder.typicode.com",
                "endpoints_count": 1,
            })]
        }
        fn switch_project(&self, id_or_name: &str) -> Result<Value, String> {
            Ok(json!({
                "status": "switched",
                "id": id_or_name,
                "name": id_or_name,
                "base_url": "https://example.com",
                "endpoints_count": 5,
            }))
        }
        fn create_project(&self, name: &str, base_url: &str) -> Result<Value, String> {
            Ok(json!({
                "status": "created",
                "id": "proj-new",
                "name": name,
                "base_url": base_url,
                "endpoints_count": 0,
            }))
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
    async fn test_set_example_response_documents_endpoint() {
        let ws = InMemoryWorkspace::new();
        let res = execute_tool(
            "beacon_set_example_response",
            &json!({ "id": "ep-1", "status": 201, "body": { "token": "abc" } }),
            &ws,
        )
        .await;
        assert_eq!(res["status"], "documented");
        let ep = ws.get_endpoint("ep-1").unwrap();
        let mock = ep.mock_response.unwrap();
        assert_eq!(mock["status"], 201);
        assert_eq!(mock["enabled"], false);
        assert!(mock["body"].as_str().unwrap().contains("\"token\""));
        assert_eq!(mock["headers"]["Content-Type"], "application/json");
    }

    #[tokio::test]
    async fn test_agent_collection_runner_and_chaining() {
        let ws = InMemoryWorkspace::new();
        let collection_res = execute_tool("beacon_run_collection", &json!({}), &ws).await;
        assert_eq!(collection_res["total_steps"], 1);
        assert!(collection_res["steps"].as_array().unwrap().len() > 0);
    }

    #[tokio::test]
    async fn test_agent_collection_tools() {
        let ws = InMemoryWorkspace::new();
        let created = execute_tool("beacon_create_endpoint", &json!({ "name": "Add Discount", "url": "/discounts", "method": "POST", "folder": "Promo/Discount" }), &ws).await;
        assert_eq!(created["folder"], "Promo/Discount", "{created}");
        let res = execute_tool("beacon_organize_collection", &json!({ "operations": [
            { "op": "create_folder", "name": "Posts" },
            { "op": "move", "items": ["Get Posts"], "to": "Posts" },
            { "op": "reorder", "order": ["Posts", "Promo"] }
        ] }), &ws).await;
        assert_eq!(res["mutated"], true, "{res}");
        let tree = execute_tool("beacon_get_collection", &json!({}), &ws).await["tree"].clone();
        assert_eq!(tree[0]["name"], "Posts");
        assert_eq!(tree[0]["items"][0]["name"], "Get Posts");
        assert_eq!(tree[1]["items"][0]["name"], "Discount");
        assert_eq!(tree[1]["items"][0]["items"][0]["name"], "Add Discount");
        let bad = execute_tool("beacon_organize_collection", &json!({ "operations": [{ "op": "move", "items": ["nope"], "to": "Posts" }] }), &ws).await;
        assert!(bad["error"].as_str().unwrap().contains("not found"));
    }

    #[tokio::test]
    async fn test_agent_project_tools() {
        let ws = InMemoryWorkspace::new();

        let list_res = execute_tool("beacon_list_projects", &json!({}), &ws).await;
        assert_eq!(list_res["count"], 1);

        let switch_res = execute_tool("beacon_switch_project", &json!({ "project": "K-MOTION API" }), &ws).await;
        assert_eq!(switch_res["status"], "switched");
        assert_eq!(switch_res["mutated"], true);

        let create_res = execute_tool(
            "beacon_create_project",
            &json!({ "name": "Auth Service", "base_url": "https://auth.internal" }),
            &ws,
        )
        .await;
        assert_eq!(create_res["status"], "created");
        assert_eq!(create_res["mutated"], true);
    }

    #[tokio::test]
    async fn test_search_endpoints_pagination() {
        let ws = InMemoryWorkspace::new();
        execute_tool("beacon_create_endpoint", &json!({ "name": "List Users", "url": "/users" }), &ws).await;
        execute_tool("beacon_create_endpoint", &json!({ "name": "Create User", "url": "/users" }), &ws).await;

        let page1 = execute_tool("beacon_search_endpoints", &json!({ "query": "user", "limit": 1 }), &ws).await;
        assert_eq!(page1["total"], 2);
        assert_eq!(page1["items"].as_array().unwrap().len(), 1);
        assert_eq!(page1["has_more"], true);

        let page2 = execute_tool("beacon_search_endpoints", &json!({ "query": "user", "limit": 1, "offset": 1 }), &ws).await;
        assert_eq!(page2["has_more"], false);
        assert_eq!(page2["items"].as_array().unwrap().len(), 1);

        let none = execute_tool("beacon_search_endpoints", &json!({ "query": "nonexistent" }), &ws).await;
        assert_eq!(none["total"], 0);
    }

    #[tokio::test]
    async fn test_get_config_hides_variable_values() {
        let ws = InMemoryWorkspace::new();
        execute_tool("beacon_set_variable", &json!({ "name": "access_token", "value": "super-secret" }), &ws).await;
        let cfg = execute_tool("beacon_get_config", &json!({}), &ws).await;
        assert_eq!(cfg["endpoint_count"], 1);
        let vars = cfg["variables"].as_array().unwrap();
        assert!(vars.iter().any(|v| v == "access_token"));
        // Only the name is exposed, never the value.
        assert!(!cfg.to_string().contains("super-secret"));
    }

    #[tokio::test]
    async fn test_duplicate_endpoint() {
        let ws = InMemoryWorkspace::new();
        let res = execute_tool("beacon_duplicate_endpoint", &json!({ "id": "ep-1" }), &ws).await;
        assert_eq!(res["status"], "duplicated");
        assert_eq!(res["mutated"], true);
        assert_eq!(res["endpoint"]["name"], "Get Posts (copy)");
        assert_ne!(res["endpoint"]["id"], "ep-1");
        assert_eq!(ws.list_endpoints().len(), 2);

        let missing = execute_tool("beacon_duplicate_endpoint", &json!({ "id": "nope" }), &ws).await;
        assert!(missing["error"].as_str().unwrap().contains("not found"));
    }

    #[tokio::test]
    async fn test_run_endpoint_rejects_unknown_id_without_network() {
        let ws = InMemoryWorkspace::new();
        let res = execute_tool("beacon_run_endpoint", &json!({ "id": "does-not-exist" }), &ws).await;
        assert!(res["error"].as_str().unwrap().contains("not found"));
    }

    #[tokio::test]
    async fn test_add_endpoint_from_curl_basic() {
        let ws = InMemoryWorkspace::new();
        let curl = r#"curl -X POST "https://api.test/v1/login" -H "Content-Type: application/json" -d '{"user":"a"}'"#;
        let res = execute_tool("beacon_add_endpoint_from_curl", &json!({ "curl": curl, "name": "Login" }), &ws).await;
        assert_eq!(res["status"], "created");
        assert_eq!(res["mutated"], true);
        assert_eq!(res["endpoint"]["name"], "Login");
        assert_eq!(res["endpoint"]["method"], "POST");
        assert_eq!(res["endpoint"]["url"], "https://api.test/v1/login");
        assert_eq!(res["endpoint"]["payload"]["user"], "a");

        let bad = execute_tool("beacon_add_endpoint_from_curl", &json!({ "curl": "curl -X GET" }), &ws).await;
        assert!(bad["error"].as_str().unwrap().contains("No URL"));
    }

    #[tokio::test]
    async fn test_add_endpoint_from_curl_with_folder() {
        let ws = InMemoryWorkspace::new();
        let res = execute_tool(
            "beacon_add_endpoint_from_curl",
            &json!({ "curl": "curl https://api.test/ping", "name": "Ping", "folder": "Health" }),
            &ws,
        )
        .await;
        assert_eq!(res["folder"], "Health", "{res}");
        let tree = execute_tool("beacon_get_collection", &json!({}), &ws).await["tree"].clone();
        let folder = tree.as_array().unwrap().iter().find(|n| n["name"] == "Health").expect("Health folder present");
        assert_eq!(folder["items"][0]["name"], "Ping");
    }

    #[tokio::test]
    async fn test_import_collection_postman_into_new_folder() {
        let ws = InMemoryWorkspace::new();
        let data = json!({
            "info": {"name": "Imported Demo"},
            "item": [
                {
                    "name": "Ping",
                    "request": {
                        "method": "GET",
                        "url": {"raw": "https://api.test/ping", "host": ["api", "test"], "path": ["ping"]}
                    }
                }
            ]
        });
        let res = execute_tool("beacon_import_collection", &json!({ "data": data }), &ws).await;
        assert_eq!(res["status"], "imported", "{res}");
        assert_eq!(res["mutated"], true);
        assert_eq!(res["format"], "postman");
        assert_eq!(res["imported"], 1);
        assert_eq!(res["into_folder"], "Imported Demo");

        let tree = execute_tool("beacon_get_collection", &json!({}), &ws).await["tree"].clone();
        let folder = tree.as_array().unwrap().iter().find(|n| n["name"] == "Imported Demo").expect("folder present");
        assert_eq!(folder["items"][0]["name"], "Ping");
    }

    #[tokio::test]
    async fn test_import_collection_into_existing_folder() {
        let ws = InMemoryWorkspace::new();
        execute_tool("beacon_organize_collection", &json!({ "operations": [{ "op": "create_folder", "name": "Existing" }] }), &ws).await;
        let data = json!({
            "name": "Legacy",
            "base_url": "https://api.test",
            "variables": {},
            "tests": [{"name": "Get", "url": "/x", "method": "GET"}]
        });
        let res = execute_tool("beacon_import_collection", &json!({ "data": data, "into_folder": "Existing" }), &ws).await;
        assert_eq!(res["status"], "imported", "{res}");
        assert_eq!(res["format"], "legacy");
        assert_eq!(res["into_folder"], "Existing");

        let tree = execute_tool("beacon_get_collection", &json!({}), &ws).await["tree"].clone();
        let folder = tree.as_array().unwrap().iter().find(|n| n["name"] == "Existing").expect("folder present");
        assert_eq!(folder["items"][0]["name"], "Get");
    }

    #[tokio::test]
    async fn test_import_collection_rejects_bad_format() {
        let ws = InMemoryWorkspace::new();
        let res = execute_tool("beacon_import_collection", &json!({ "data": {"foo": "bar"} }), &ws).await;
        assert!(res["error"].as_str().unwrap().contains("not recognized"), "{res}");
    }
}
