//! Collection/API-spec import: detection + normalization into a Beacon `items` tree.
//!
//! Ported from the deleted Python `backend/app/services/project_importer.py`
//! (see `git show e68e16e^:backend/app/services/project_importer.py`). Supports
//! Beacon exports/legacy config, Postman v2, OpenAPI 3, Swagger 2 (JSON or
//! YAML), Insomnia exports, and HAR files.
//!
//! This is the single source of truth for import conversion in this codebase:
//! both the HTTP import route (`beacon-server`) and the MCP/agent
//! `beacon_import_collection` tool should call [`normalize`] rather than
//! re-implementing format detection or conversion.
use crate::models::EndpointTest;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use uuid::Uuid;

pub struct NormalizedProject {
    pub format: String,
    pub format_label: String,
    pub name: String,
    /// Materialized Beacon tree: folders and requests, each with a fresh `id`.
    pub items: Vec<Value>,
    pub environments: Vec<Value>,
    pub endpoints_count: usize,
    pub folders_count: usize,
    pub warnings: Vec<String>,
}

const METHODS: &[&str] = &["get", "post", "put", "patch", "delete", "head", "options", "trace"];

/// Accepts either a raw collection/spec JSON value, or the `{content, filename}`
/// text envelope (JSON or YAML text with an optional filename used for the
/// project's default name and format hints).
pub fn normalize(data: &Value) -> Result<NormalizedProject, String> {
    let (source, filename) = parse_source(data)?;
    let source_obj = source
        .as_object()
        .ok_or_else(|| "Expected a project or API collection object at the top level.".to_string())?;

    let fmt = detect_format(source_obj)?;
    let mut warnings: Vec<String> = Vec::new();
    let (name, environments, raw_items) = match fmt {
        "beacon" => beacon_project(source_obj, &mut warnings)?,
        "legacy" => legacy_project(source_obj, &mut warnings)?,
        "postman" => postman_project(source_obj, &mut warnings)?,
        "openapi3" => openapi_project(source_obj, &mut warnings, false)?,
        "swagger2" => openapi_project(source_obj, &mut warnings, true)?,
        "insomnia" => insomnia_project(source_obj, &mut warnings)?,
        "har" => har_project(source_obj, &mut warnings)?,
        _ => return Err("Unsupported import format.".into()),
    };

    let (endpoints_count, folders_count) = count_tree(&raw_items);
    if endpoints_count == 0 {
        return Err(
            "No importable requests were found. Use a Beacon export, Postman collection, \
             OpenAPI/Swagger document, Insomnia export, or HAR file."
                .into(),
        );
    }

    let project_name = if name.trim().is_empty() {
        let stem = stem(&filename);
        if stem.is_empty() { "Imported Project".to_string() } else { stem }
    } else {
        name
    };

    let items = materialize_items(&raw_items)?;
    let environments = if environments.is_empty() {
        vec![environment("Local", "", &Map::new())]
    } else {
        environments
    };

    let format_label = match fmt {
        "beacon" => "Beacon project",
        "postman" => "Postman collection",
        "openapi3" => "OpenAPI 3",
        "swagger2" => "Swagger 2",
        "insomnia" => "Insomnia export",
        "har" => "HTTP Archive (HAR)",
        "legacy" => "Beacon legacy config",
        _ => "Unknown",
    }
    .to_string();

    Ok(NormalizedProject {
        format: fmt.to_string(),
        format_label,
        name: project_name,
        items,
        environments,
        endpoints_count,
        folders_count,
        warnings: unique(warnings),
    })
}

/// Accept either a direct JSON/YAML body or the `{content, filename}` envelope.
fn parse_source(data: &Value) -> Result<(Value, String), String> {
    if let Some(content) = data.as_object().and_then(|o| o.get("content")).and_then(|v| v.as_str()) {
        let raw = content.trim();
        let filename = data
            .as_object()
            .and_then(|o| o.get("filename"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if raw.is_empty() {
            return Err("The selected file is empty.".into());
        }
        match serde_json::from_str::<Value>(raw) {
            Ok(v) => return Ok((v, filename)),
            Err(json_err) => match serde_yaml::from_str::<Value>(raw) {
                Ok(v @ Value::Object(_)) | Ok(v @ Value::Array(_)) => return Ok((v, filename)),
                Ok(_) => return Err("The file must contain a JSON/YAML object or collection.".into()),
                Err(_) => return Err(format!("Invalid JSON: {json_err}")),
            },
        }
    }
    Ok((data.clone(), String::new()))
}

fn detect_format(data: &Map<String, Value>) -> Result<&'static str, String> {
    let payload: &Map<String, Value> = data
        .get("project")
        .and_then(|v| v.as_object())
        .unwrap_or(data);

    if matches!(data.get("format").and_then(|v| v.as_str()), Some("security-tools.project") | Some("beacon.project")) {
        return Ok("beacon");
    }
    if (payload.contains_key("items") || payload.contains_key("environments")) && !payload.contains_key("paths") {
        return Ok("beacon");
    }
    let info_is_obj = data.get("info").map(|v| v.is_object()).unwrap_or(false);
    if data.contains_key("item") && (info_is_obj || data.get("variable").is_some()) {
        return Ok("postman");
    }
    if data.get("openapi").and_then(|v| v.as_str()).is_some_and(|s| s.starts_with('3')) && data.get("paths").is_some_and(|v| v.is_object()) {
        return Ok("openapi3");
    }
    if data.get("swagger").and_then(|v| v.as_str()).is_some_and(|s| s.starts_with('2')) && data.get("paths").is_some_and(|v| v.is_object()) {
        return Ok("swagger2");
    }
    if data.get("_type").and_then(|v| v.as_str()) == Some("export") && data.get("resources").is_some_and(|v| v.is_array()) {
        return Ok("insomnia");
    }
    if data.get("log").and_then(|v| v.get("entries")).is_some_and(|v| v.is_array()) {
        return Ok("har");
    }
    if payload.contains_key("tests") && (payload.contains_key("base_url") || payload.contains_key("variables")) {
        return Ok("legacy");
    }
    Err("Format not recognized. Supported: Beacon, Postman v2, OpenAPI 3, Swagger 2, Insomnia, and HAR.".into())
}

// --------------------------------------------------------------------------- //
// Beacon / legacy
// --------------------------------------------------------------------------- //

fn beacon_project(data: &Map<String, Value>, warnings: &mut Vec<String>) -> Result<(String, Vec<Value>, Vec<Value>), String> {
    if matches!(data.get("format").and_then(|v| v.as_str()), Some("security-tools.project") | Some("beacon.project")) {
        if let Some(version) = data.get("version") {
            if !version.is_null() && version != &json!(1) {
                return Err(format!("Beacon project version {version} is not supported."));
            }
        }
    }
    let payload = data.get("project").and_then(|v| v.as_object()).unwrap_or(data);
    let items_raw = if let Some(items) = payload.get("items") {
        items
            .as_array()
            .ok_or("Beacon project field 'items' must be an array.")?
            .clone()
    } else if let Some(tests) = payload.get("tests").and_then(|v| v.as_array()) {
        tests
            .iter()
            .filter(|t| t.is_object())
            .map(|t| {
                let mut node = t.as_object().cloned().unwrap_or_default();
                node.insert("type".into(), json!("request"));
                Value::Object(node)
            })
            .collect()
    } else {
        return Err("Beacon project field 'items' must be an array.".into());
    };
    let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("Imported Beacon Project").to_string();
    let environments = normalize_environments(payload.get("environments"))?;
    let items: Vec<Value> = items_raw
        .iter()
        .filter_map(|n| n.as_object())
        .map(|n| normalize_beacon_node(n, warnings))
        .collect::<Result<Vec<_>, String>>()?;
    Ok((name, environments, items))
}

fn normalize_beacon_node(node: &Map<String, Value>, warnings: &mut Vec<String>) -> Result<Value, String> {
    let is_folder = node.get("type").and_then(|v| v.as_str()) == Some("folder") || node.get("items").is_some_and(|v| v.is_array());
    if is_folder {
        let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("Folder").to_string();
        let children = node
            .get("items")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|c| c.as_object()).map(|c| normalize_beacon_node(c, warnings)).collect::<Result<Vec<_>, String>>())
            .transpose()?
            .unwrap_or_default();
        return Ok(json!({ "name": name, "type": "folder", "items": children }));
    }
    request(
        node.get("name").and_then(|v| v.as_str()),
        node.get("url"),
        node.get("method").and_then(|v| v.as_str()),
        node.get("headers"),
        node.get("payload"),
        node.get("payload_type").and_then(|v| v.as_str()),
        node.get("extractors"),
        node.get("assertions"),
        node.get("run_config"),
        node.get("target_type").and_then(|v| v.as_str()),
    )
}

fn legacy_project(data: &Map<String, Value>, warnings: &mut Vec<String>) -> Result<(String, Vec<Value>, Vec<Value>), String> {
    let payload = data.get("project").and_then(|v| v.as_object()).unwrap_or(data);
    let tests = payload.get("tests").and_then(|v| v.as_array()).ok_or("Legacy config field 'tests' must be an array.")?;
    let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("Imported Config").to_string();
    let base_url = payload.get("base_url").and_then(|v| v.as_str()).unwrap_or("");
    let vars = payload.get("variables").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let environments = vec![environment("Imported", base_url, &vars)];
    let items: Vec<Value> = tests
        .iter()
        .filter_map(|t| t.as_object())
        .map(|t| normalize_beacon_node(t, warnings))
        .collect::<Result<Vec<_>, String>>()?;
    Ok((name, environments, items))
}

// --------------------------------------------------------------------------- //
// Postman
// --------------------------------------------------------------------------- //

fn postman_project(data: &Map<String, Value>, warnings: &mut Vec<String>) -> Result<(String, Vec<Value>, Vec<Value>), String> {
    let info = data.get("info").and_then(|v| v.as_object());
    let mut scripts = data.get("event").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);

    fn convert(node: &Map<String, Value>, inherited_auth: Option<&Value>, scripts: &mut usize, warnings: &mut Vec<String>) -> Result<Option<Value>, String> {
        *scripts += node.get("event").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
        if let Some(item_list) = node.get("item").and_then(|v| v.as_array()) {
            let node_auth = node.get("auth").or(inherited_auth);
            let mut children = Vec::new();
            for child in item_list.iter().filter_map(|c| c.as_object()) {
                if let Some(c) = convert(child, node_auth, scripts, warnings)? {
                    children.push(c);
                }
            }
            let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("Folder").to_string();
            return Ok(Some(json!({ "name": name, "type": "folder", "items": children })));
        }
        let req = match node.get("request") {
            Some(Value::String(s)) => return Ok(Some(request(node.get("name").and_then(|v| v.as_str()), Some(&json!(s)), Some("GET"), None, None, None, None, None, None, None)?)),
            Some(Value::Object(o)) => o,
            _ => {
                let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("Unnamed");
                warnings.push(format!("Skipped Postman item '{name}' because it has no request."));
                return Ok(None);
            }
        };
        let url = match req.get("url") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Object(u)) => {
                u.get("raw").and_then(|v| v.as_str()).map(|s| s.to_string()).unwrap_or_else(|| postman_url(u))
            }
            _ => String::new(),
        };
        let mut headers = header_list(req.get("header"), "key");
        apply_postman_auth(&mut headers, req.get("auth").or(inherited_auth), warnings);
        let (payload, payload_type) = postman_body(req.get("body"), warnings, node.get("name").and_then(|v| v.as_str()).unwrap_or("Request"));
        *scripts += req.get("event").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
        let headers_val = json!(headers);
        Ok(Some(request(
            node.get("name").and_then(|v| v.as_str()),
            Some(&json!(url)),
            req.get("method").and_then(|v| v.as_str()),
            Some(&headers_val),
            Some(&payload),
            Some(&payload_type),
            None,
            None,
            None,
            None,
        )?))
    }

    let mut items = Vec::new();
    if let Some(item_list) = data.get("item").and_then(|v| v.as_array()) {
        for child in item_list.iter().filter_map(|c| c.as_object()) {
            if let Some(c) = convert(child, data.get("auth"), &mut scripts, warnings)? {
                items.push(c);
            }
        }
    }
    if scripts > 0 {
        warnings.push(format!("Ignored {scripts} Postman pre-request/test script block(s); Beacon does not execute collection scripts."));
    }
    let mut variables = Map::new();
    if let Some(vars) = data.get("variable").and_then(|v| v.as_array()) {
        for v in vars.iter().filter_map(|v| v.as_object()) {
            if let Some(key) = v.get("key").and_then(|v| v.as_str()) {
                variables.insert(key.to_string(), v.get("value").cloned().unwrap_or(json!("")));
            }
        }
    }
    let name = info
        .and_then(|i| i.get("name"))
        .and_then(|v| v.as_str())
        .or_else(|| data.get("name").and_then(|v| v.as_str()))
        .unwrap_or("Imported Postman Collection")
        .to_string();
    let environments = vec![environment("Collection variables", "", &variables)];
    Ok((name, environments, items))
}

fn postman_url(url: &Map<String, Value>) -> String {
    let host = match url.get("host") {
        Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join("."),
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };
    let path = match url.get("path") {
        Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join("/"),
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };
    let protocol = url.get("protocol").and_then(|v| v.as_str()).unwrap_or("https");
    let mut result = format!("{protocol}://{host}/{path}");
    if let Some(query) = url.get("query").and_then(|v| v.as_array()) {
        let pairs: Vec<(String, String)> = query
            .iter()
            .filter_map(|q| q.as_object())
            .filter(|q| !q.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false))
            .map(|q| (q.get("key").and_then(|v| v.as_str()).unwrap_or("").to_string(), q.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string()))
            .collect();
        if !pairs.is_empty() {
            result.push('?');
            result.push_str(&encode_query(&pairs));
        }
    }
    result
}

fn postman_body(body: Option<&Value>, warnings: &mut Vec<String>, name: &str) -> (Value, String) {
    let Some(body) = body.and_then(|v| v.as_object()) else { return (json!({}), "json".into()) };
    let mode = body.get("mode").and_then(|v| v.as_str()).unwrap_or("");
    match mode {
        "raw" => {
            let raw = body.get("raw").and_then(|v| v.as_str()).unwrap_or("").to_string();
            match serde_json::from_str::<Value>(&raw) {
                Ok(v) => (v, "json".into()),
                Err(_) => (json!(raw), "raw".into()),
            }
        }
        "urlencoded" | "formdata" => {
            let rows = body.get(mode).and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let mut payload = Map::new();
            for row in rows.iter().filter_map(|r| r.as_object()) {
                let Some(key) = row.get("key").and_then(|v| v.as_str()) else { continue };
                if key.is_empty() || row.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false) {
                    continue;
                }
                if row.get("type").and_then(|v| v.as_str()) == Some("file") {
                    warnings.push(format!("'{name}': imported file field '{key}' without a local file value."));
                    payload.insert(key.to_string(), json!(""));
                } else {
                    payload.insert(key.to_string(), row.get("value").cloned().unwrap_or(json!("")));
                }
            }
            (Value::Object(payload), if mode == "formdata" { "multipart".into() } else { "form".into() })
        }
        "graphql" => {
            let graph = body.get("graphql").and_then(|v| v.as_object());
            let query = graph.and_then(|g| g.get("query")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let variables = match graph.and_then(|g| g.get("variables")) {
                Some(Value::String(s)) => serde_json::from_str::<Value>(s).unwrap_or(json!({})),
                Some(v) => v.clone(),
                None => json!({}),
            };
            (json!({ "query": query, "variables": variables }), "json".into())
        }
        "file" => {
            warnings.push(format!("'{name}': binary request body was omitted; select the file again on this device."));
            (json!({}), "multipart".into())
        }
        _ => (json!({}), "json".into()),
    }
}

fn apply_postman_auth(headers: &mut Map<String, Value>, auth: Option<&Value>, warnings: &mut Vec<String>) {
    let Some(auth) = auth.and_then(|v| v.as_object()) else { return };
    let kind = auth.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if kind.is_empty() || kind == "noauth" {
        return;
    }
    let mut values: HashMap<String, Value> = HashMap::new();
    if let Some(arr) = auth.get(kind).and_then(|v| v.as_array()) {
        for v in arr.iter().filter_map(|v| v.as_object()) {
            if let Some(key) = v.get("key").and_then(|v| v.as_str()) {
                values.insert(key.to_string(), v.get("value").cloned().unwrap_or(json!("")));
            }
        }
    }
    match kind {
        "bearer" => {
            let token = values.get("token").and_then(|v| v.as_str()).unwrap_or("{{access_token}}");
            headers.entry("Authorization".to_string()).or_insert(json!(format!("Bearer {token}")));
        }
        "apikey" => {
            if values.get("in").and_then(|v| v.as_str()) == Some("header") {
                let key = values.get("key").and_then(|v| v.as_str()).unwrap_or("X-API-Key").to_string();
                let value = values.get("value").cloned().unwrap_or(json!(""));
                headers.entry(key).or_insert(value);
            } else {
                warnings.push("A Postman API key stored in query parameters needs manual review.".into());
            }
        }
        "basic" => {
            headers.entry("Authorization".to_string()).or_insert(json!("Basic {{basic_auth}}"));
            warnings.push("Basic auth credentials were replaced with {{basic_auth}} to avoid embedding secrets.".into());
        }
        other => warnings.push(format!("Postman auth type '{other}' is not converted automatically.")),
    }
}

// --------------------------------------------------------------------------- //
// OpenAPI 3 / Swagger 2
// --------------------------------------------------------------------------- //

fn openapi_project(data: &Map<String, Value>, warnings: &mut Vec<String>, swagger: bool) -> Result<(String, Vec<Value>, Vec<Value>), String> {
    let info = data.get("info").and_then(|v| v.as_object());
    let base_url = if swagger { swagger_base(data) } else { openapi_server(data) };
    let schemes = if swagger {
        data.get("securityDefinitions").and_then(|v| v.as_object()).cloned().unwrap_or_default()
    } else {
        data.get("components").and_then(|v| v.get("securitySchemes")).and_then(|v| v.as_object()).cloned().unwrap_or_default()
    };

    let mut by_tag: Vec<(String, Vec<Value>)> = Vec::new();
    let mut ungrouped: Vec<Value> = Vec::new();

    if let Some(paths) = data.get("paths").and_then(|v| v.as_object()) {
        for (path, path_item) in paths {
            let Some(path_item) = path_item.as_object() else { continue };
            let path_level_params: Vec<&Map<String, Value>> = path_item
                .get("parameters")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|p| p.as_object()).collect())
                .unwrap_or_default();
            for (method, operation) in path_item {
                if !METHODS.contains(&method.to_lowercase().as_str()) {
                    continue;
                }
                let Some(operation) = operation.as_object() else { continue };
                let mut parameters: Vec<&Map<String, Value>> = path_level_params.clone();
                if let Some(op_params) = operation.get("parameters").and_then(|v| v.as_array()) {
                    parameters.extend(op_params.iter().filter_map(|p| p.as_object()));
                }
                let (url, headers) = openapi_parameters(path, &parameters, data);
                let (payload, payload_type) = openapi_body(operation, &parameters, data, swagger);
                let mut headers = headers;
                openapi_security(&mut headers, operation.get("security").or(data.get("security")), &schemes, warnings);
                let name = operation
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .or_else(|| operation.get("operationId").and_then(|v| v.as_str()));
                let default_name = format!("{} {}", method.to_uppercase(), path);
                let name = name.unwrap_or(&default_name);
                let headers_val = json!(headers);
                let req = request(
                    Some(name),
                    Some(&json!(url)),
                    Some(method),
                    Some(&headers_val),
                    Some(&payload),
                    Some(&payload_type),
                    None,
                    None,
                    None,
                    None,
                )?;
                let tags = operation.get("tags").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                if let Some(tag) = tags.first().and_then(|v| v.as_str()) {
                    if let Some(entry) = by_tag.iter_mut().find(|(t, _)| t == tag) {
                        entry.1.push(req);
                    } else {
                        by_tag.push((tag.to_string(), vec![req]));
                    }
                } else {
                    ungrouped.push(req);
                }
            }
        }
    }

    let mut items: Vec<Value> = by_tag
        .into_iter()
        .map(|(tag, reqs)| json!({ "name": tag, "type": "folder", "items": reqs }))
        .collect();
    items.extend(ungrouped);
    let name = info.and_then(|i| i.get("title")).and_then(|v| v.as_str()).unwrap_or("Imported API").to_string();
    let environments = vec![environment("Imported", &base_url, &Map::new())];
    Ok((name, environments, items))
}

fn openapi_server(data: &Map<String, Value>) -> String {
    let Some(servers) = data.get("servers").and_then(|v| v.as_array()) else { return String::new() };
    let Some(first) = servers.first().and_then(|v| v.as_object()) else { return String::new() };
    let mut url = first.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if let Some(vars) = first.get("variables").and_then(|v| v.as_object()) {
        for (key, spec) in vars {
            let default = spec.get("default").map(|v| match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            }).unwrap_or_default();
            url = url.replace(&format!("{{{key}}}"), &default);
        }
    }
    url.trim_end_matches('/').to_string()
}

fn swagger_base(data: &Map<String, Value>) -> String {
    let host = data.get("host").and_then(|v| v.as_str()).unwrap_or("");
    if host.is_empty() {
        return data.get("basePath").and_then(|v| v.as_str()).unwrap_or("").to_string();
    }
    let scheme = data
        .get("schemes")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .unwrap_or("https");
    let base_path = data.get("basePath").and_then(|v| v.as_str()).unwrap_or("");
    format!("{scheme}://{host}{base_path}").trim_end_matches('/').to_string()
}

fn openapi_parameters(path: &str, parameters: &[&Map<String, Value>], root: &Map<String, Value>) -> (String, Map<String, Value>) {
    let mut headers = Map::new();
    let mut query: Vec<(String, String)> = Vec::new();
    let path_re = Regex::new(r"\{([^}]+)\}").unwrap();
    let mut url = path_re.replace_all(path, "{{$1}}").to_string();
    for param in parameters {
        let param = resolve_ref(param, root);
        let Some(param) = param.as_object() else { continue };
        let Some(name) = param.get("name").and_then(|v| v.as_str()) else { continue };
        let location = param.get("in").and_then(|v| v.as_str()).unwrap_or("");
        if location == "body" {
            continue;
        }
        let value = example(param.get("schema").unwrap_or(&Value::Object(param.clone())), param.get("example"));
        let token = if !value.is_null() && value != json!("") {
            query_scalar(&value)
        } else {
            format!("{{{{{name}}}}}")
        };
        if location == "query" {
            query.push((name.to_string(), token));
        } else if location == "header" {
            headers.insert(name.to_string(), json!(token));
        }
    }
    if !query.is_empty() {
        url.push(if url.contains('?') { '&' } else { '?' });
        url.push_str(&encode_query(&query));
    }
    (url, headers)
}

fn openapi_body(operation: &Map<String, Value>, parameters: &[&Map<String, Value>], root: &Map<String, Value>, swagger: bool) -> (Value, String) {
    if swagger {
        let body_param = parameters.iter().find(|p| p.get("in").and_then(|v| v.as_str()) == Some("body"));
        if let Some(body_param) = body_param {
            let resolved = resolve_ref(body_param, root);
            let schema = resolved.as_object().and_then(|o| o.get("schema")).cloned().unwrap_or(json!({}));
            let explicit = resolved.as_object().and_then(|o| o.get("x-example"));
            return (example(&schema, explicit), "json".into());
        }
        let form: Vec<&&Map<String, Value>> = parameters.iter().filter(|p| p.get("in").and_then(|v| v.as_str()) == Some("formData")).collect();
        if !form.is_empty() {
            let mut payload = Map::new();
            for p in form {
                if let Some(name) = p.get("name").and_then(|v| v.as_str()) {
                    payload.insert(name.to_string(), example(&Value::Object((*p).clone()), None));
                }
            }
            return (Value::Object(payload), "multipart".into());
        }
        return (json!({}), "json".into());
    }
    let Some(content) = operation.get("requestBody").and_then(|v| v.get("content")).and_then(|v| v.as_object()) else {
        return (json!({}), "json".into());
    };
    let Some((mime, spec)) = content.iter().next() else { return (json!({}), "json".into()) };
    let spec_obj = spec.as_object();
    let payload = if let Some(example_val) = spec_obj.and_then(|s| s.get("example")) {
        example_val.clone()
    } else {
        let schema = spec_obj.and_then(|s| s.get("schema")).cloned().unwrap_or(json!({}));
        example(&resolve_ref_val(&schema, root), None)
    };
    if mime.contains("multipart") {
        return (if payload.is_null() { json!({}) } else { payload }, "multipart".into());
    }
    if mime.contains("x-www-form-urlencoded") {
        return (if payload.is_null() { json!({}) } else { payload }, "form".into());
    }
    if !mime.contains("json") {
        let raw = match &payload {
            Value::String(s) => s.clone(),
            other => serde_json::to_string(other).unwrap_or_default(),
        };
        return (json!(raw), "raw".into());
    }
    (if payload.is_null() { json!({}) } else { payload }, "json".into())
}

fn openapi_security(headers: &mut Map<String, Value>, security: Option<&Value>, schemes: &Map<String, Value>, warnings: &mut Vec<String>) {
    let Some(security) = security.and_then(|v| v.as_array()) else { return };
    let Some(first) = security.first().and_then(|v| v.as_object()) else { return };
    let Some(name) = first.keys().next() else { return };
    let scheme = schemes.get(name).and_then(|v| v.as_object());
    let kind = scheme.and_then(|s| s.get("type")).and_then(|v| v.as_str()).unwrap_or("");
    match kind {
        "http" if scheme.and_then(|s| s.get("scheme")).and_then(|v| v.as_str()) == Some("bearer") => {
            headers.entry("Authorization".to_string()).or_insert(json!("Bearer {{access_token}}"));
        }
        "apiKey" if scheme.and_then(|s| s.get("in")).and_then(|v| v.as_str()) == Some("header") => {
            let header_name = scheme.and_then(|s| s.get("name")).and_then(|v| v.as_str()).unwrap_or("X-API-Key").to_string();
            headers.entry(header_name).or_insert(json!("{{api_key}}"));
        }
        "oauth2" | "openIdConnect" => {
            headers.entry("Authorization".to_string()).or_insert(json!("Bearer {{access_token}}"));
        }
        _ => warnings.push(format!("Security scheme '{name}' needs manual configuration.")),
    }
}

fn resolve_ref(schema: &Map<String, Value>, root: &Map<String, Value>) -> Value {
    resolve_ref_val(&Value::Object(schema.clone()), root)
}

fn resolve_ref_val(schema: &Value, root: &Map<String, Value>) -> Value {
    let Some(obj) = schema.as_object() else { return schema.clone() };
    let Some(reference) = obj.get("$ref").and_then(|v| v.as_str()) else { return schema.clone() };
    let mut cursor = Value::Object(root.clone());
    for part in reference.trim_start_matches("#/").split('/') {
        cursor = cursor.get(part).cloned().unwrap_or(json!({}));
    }
    cursor
}

fn example(schema: &Value, explicit: Option<&Value>) -> Value {
    if let Some(e) = explicit {
        if !e.is_null() {
            return e.clone();
        }
    }
    let Some(obj) = schema.as_object() else { return json!("") };
    if let Some(e) = obj.get("example") {
        return e.clone();
    }
    if let Some(d) = obj.get("default") {
        return d.clone();
    }
    if let Some(enum_vals) = obj.get("enum").and_then(|v| v.as_array()) {
        if let Some(first) = enum_vals.first() {
            return first.clone();
        }
    }
    let kind = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if kind == "object" || obj.contains_key("properties") {
        let mut map = Map::new();
        if let Some(props) = obj.get("properties").and_then(|v| v.as_object()) {
            for (k, v) in props {
                map.insert(k.clone(), example(v, None));
            }
        }
        return Value::Object(map);
    }
    if kind == "array" {
        let item_schema = obj.get("items").cloned().unwrap_or(json!({}));
        return json!([example(&item_schema, None)]);
    }
    if kind == "integer" || kind == "number" {
        return json!(0);
    }
    if kind == "boolean" {
        return json!(false);
    }
    json!("")
}

// --------------------------------------------------------------------------- //
// Insomnia
// --------------------------------------------------------------------------- //

fn insomnia_project(data: &Map<String, Value>, _warnings: &mut Vec<String>) -> Result<(String, Vec<Value>, Vec<Value>), String> {
    let resources: Vec<&Map<String, Value>> = data.get("resources").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|r| r.as_object()).collect()).unwrap_or_default();
    let workspace = resources.iter().find(|r| r.get("_type").and_then(|v| v.as_str()) == Some("workspace")).cloned();
    let groups: Vec<&Map<String, Value>> = resources.iter().filter(|r| r.get("_type").and_then(|v| v.as_str()) == Some("request_group")).cloned().collect();
    let requests: Vec<&Map<String, Value>> = resources.iter().filter(|r| r.get("_type").and_then(|v| v.as_str()) == Some("request")).cloned().collect();

    let mut children: HashMap<String, Vec<Value>> = HashMap::new();
    for req in &requests {
        let body = req.get("body").and_then(|v| v.as_object());
        let mime = body.and_then(|b| b.get("mimeType")).and_then(|v| v.as_str()).unwrap_or("");
        let text = body.and_then(|b| b.get("text")).and_then(|v| v.as_str()).unwrap_or("");
        let payload = if mime.contains("json") && !text.is_empty() {
            serde_json::from_str::<Value>(text).unwrap_or(json!(text))
        } else {
            json!(text)
        };
        let payload_type = if mime.contains("json") { "json" } else if mime.contains("form") { "form" } else { "raw" };
        let mut url = req.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if let Some(params) = req.get("parameters").and_then(|v| v.as_array()) {
            let pairs: Vec<(String, String)> = params
                .iter()
                .filter_map(|p| p.as_object())
                .filter(|p| !p.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false))
                .map(|p| (p.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(), p.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string()))
                .collect();
            if !pairs.is_empty() {
                url.push(if url.contains('?') { '&' } else { '?' });
                url.push_str(&encode_query(&pairs));
            }
        }
        let headers_map = header_list(req.get("headers"), "name");
        let headers_val = json!(headers_map);
        let node = request(
            req.get("name").and_then(|v| v.as_str()),
            Some(&json!(url)),
            req.get("method").and_then(|v| v.as_str()),
            Some(&headers_val),
            Some(&payload),
            Some(payload_type),
            None,
            None,
            None,
            None,
        )?;
        let parent_id = req.get("parentId").and_then(|v| v.as_str()).unwrap_or("").to_string();
        children.entry(parent_id).or_default().push(node);
    }

    fn build_folder(group: &Map<String, Value>, groups: &[&Map<String, Value>], children: &HashMap<String, Vec<Value>>) -> Value {
        let gid = group.get("_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let name = group.get("name").and_then(|v| v.as_str()).unwrap_or("Folder").to_string();
        let mut items: Vec<Value> = groups
            .iter()
            .filter(|g| g.get("parentId").and_then(|v| v.as_str()) == Some(gid.as_str()))
            .map(|g| build_folder(g, groups, children))
            .collect();
        if let Some(reqs) = children.get(&gid) {
            items.extend(reqs.clone());
        }
        json!({ "name": name, "type": "folder", "items": items })
    }

    let root_id = workspace.and_then(|w| w.get("_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut items: Vec<Value> = groups
        .iter()
        .filter(|g| g.get("parentId").and_then(|v| v.as_str()) == Some(root_id.as_str()))
        .map(|g| build_folder(g, &groups, &children))
        .collect();
    if let Some(reqs) = children.get(&root_id) {
        items.extend(reqs.clone());
    }

    let env = resources
        .iter()
        .find(|r| r.get("_type").and_then(|v| v.as_str()) == Some("environment") && r.get("parentId").and_then(|v| v.as_str()) == Some(root_id.as_str()));
    let env_vars = env.and_then(|e| e.get("data")).and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let name = workspace.and_then(|w| w.get("name")).and_then(|v| v.as_str()).unwrap_or("Imported Insomnia Workspace").to_string();
    let environments = vec![environment("Imported", "", &env_vars)];
    Ok((name, environments, items))
}

// --------------------------------------------------------------------------- //
// HAR
// --------------------------------------------------------------------------- //

fn har_project(data: &Map<String, Value>, warnings: &mut Vec<String>) -> Result<(String, Vec<Value>, Vec<Value>), String> {
    let mut domains: Vec<(String, Vec<Value>)> = Vec::new();
    let entries = data.get("log").and_then(|v| v.get("entries")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for entry in entries {
        let Some(req) = entry.get("request").and_then(|v| v.as_object()) else { continue };
        let url = req.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let host = url::Url::parse(&url).ok().and_then(|u| u.host_str().map(|s| s.to_string())).unwrap_or_else(|| "Requests".to_string());
        let path = url::Url::parse(&url).ok().map(|u| u.path().to_string()).unwrap_or_else(|| "/".to_string());
        let mut headers = header_list(req.get("headers"), "name");
        headers.retain(|k, _| !matches!(k.to_lowercase().as_str(), "authorization" | "cookie" | "proxy-authorization"));
        let post = req.get("postData").and_then(|v| v.as_object());
        let text = post.and_then(|p| p.get("text")).and_then(|v| v.as_str()).unwrap_or("");
        let mime = post.and_then(|p| p.get("mimeType")).and_then(|v| v.as_str()).unwrap_or("");
        let payload = if mime.contains("json") && !text.is_empty() {
            serde_json::from_str::<Value>(text).unwrap_or(json!(text))
        } else {
            json!(text)
        };
        let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("GET");
        let headers_val = json!(headers);
        let node = request(
            Some(&format!("{method} {path}")),
            Some(&json!(url)),
            Some(method),
            Some(&headers_val),
            Some(&payload),
            Some(if mime.contains("json") { "json" } else { "raw" }),
            None,
            None,
            None,
            None,
        )?;
        if let Some(entry) = domains.iter_mut().find(|(h, _)| h == &host) {
            entry.1.push(node);
        } else {
            domains.push((host, vec![node]));
        }
    }
    warnings.push("HAR response bodies, cookies, and captured authorization values were not imported.".into());
    let items: Vec<Value> = domains.into_iter().map(|(host, reqs)| json!({ "name": host, "type": "folder", "items": reqs })).collect();
    Ok(("Imported HAR".to_string(), vec![environment("Captured", "", &Map::new())], items))
}

// --------------------------------------------------------------------------- //
// Shared helpers
// --------------------------------------------------------------------------- //

#[allow(clippy::too_many_arguments)]
fn request(
    name: Option<&str>,
    url: Option<&Value>,
    method: Option<&str>,
    headers: Option<&Value>,
    payload: Option<&Value>,
    payload_type: Option<&str>,
    extractors: Option<&Value>,
    assertions: Option<&Value>,
    run_config: Option<&Value>,
    target_type: Option<&str>,
) -> Result<Value, String> {
    let url_str = match url {
        Some(Value::String(s)) if !s.trim().is_empty() => s.clone(),
        _ => return Err(format!("Request '{}' is missing a URL.", name.unwrap_or("Unnamed"))),
    };
    let method = method.unwrap_or("GET").to_uppercase();
    let name = name
        .filter(|n| !n.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{method} {url_str}"));
    let target_type = match target_type {
        Some("web") => "web",
        _ => "api",
    };
    Ok(json!({
        "name": name,
        "type": "request",
        "url": url_str,
        "method": method,
        "headers": headers.cloned().filter(|h| h.is_object()).unwrap_or(json!({})),
        "payload": payload.cloned().unwrap_or(json!({})),
        "payload_type": payload_type.unwrap_or("json"),
        "extractors": extractors.cloned().filter(|e| e.is_object()).unwrap_or(json!({})),
        "assertions": assertions.cloned().filter(|a| a.is_array()).unwrap_or(json!([])),
        "run_config": run_config.cloned().unwrap_or(Value::Null),
        "target_type": target_type,
    }))
}

fn environment(name: &str, base_url: &str, variables: &Map<String, Value>) -> Value {
    json!({ "name": name, "base_url": base_url, "variables": variables })
}

fn normalize_environments(value: Option<&Value>) -> Result<Vec<Value>, String> {
    let Some(value) = value else { return Ok(vec![environment("Local", "", &Map::new())]) };
    if value.is_null() {
        return Ok(vec![environment("Local", "", &Map::new())]);
    }
    let arr = value.as_array().ok_or("Project field 'environments' must be an array.")?;
    Ok(arr
        .iter()
        .filter_map(|e| e.as_object())
        .map(|e| {
            let name = e.get("name").and_then(|v| v.as_str()).unwrap_or("Imported").to_string();
            let base_url = e.get("base_url").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let vars = e.get("variables").and_then(|v| v.as_object()).cloned().unwrap_or_default();
            environment(&name, &base_url, &vars)
        })
        .collect())
}

fn header_list(rows: Option<&Value>, key_name: &str) -> Map<String, Value> {
    let mut out = Map::new();
    if let Some(arr) = rows.and_then(|v| v.as_array()) {
        for row in arr.iter().filter_map(|r| r.as_object()) {
            if row.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false) {
                continue;
            }
            if let Some(key) = row.get(key_name).and_then(|v| v.as_str()) {
                out.insert(key.to_string(), row.get("value").cloned().unwrap_or(json!("")));
            }
        }
    }
    out
}

fn encode_query(pairs: &[(String, String)]) -> String {
    let mut s = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs {
        s.append_pair(k, v);
    }
    // Keep `{{var}}` templating readable: form_urlencoded percent-encodes `{`/`}`.
    s.finish().replace("%7B%7B", "{{").replace("%7D%7D", "}}")
}

fn query_scalar(value: &Value) -> String {
    match value {
        Value::Bool(b) => b.to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn count_tree(items: &[Value]) -> (usize, usize) {
    let mut endpoints = 0;
    let mut folders = 0;
    for item in items {
        let Some(obj) = item.as_object() else { continue };
        if obj.get("type").and_then(|v| v.as_str()) == Some("folder") {
            folders += 1;
            let children = obj.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let (e, f) = count_tree(&children);
            endpoints += e;
            folders += f;
        } else if obj.get("type").and_then(|v| v.as_str()) == Some("request") {
            endpoints += 1;
        }
    }
    (endpoints, folders)
}

fn unique(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    values.into_iter().filter(|v| seen.insert(v.clone())).collect()
}

fn stem(filename: &str) -> String {
    let re = Regex::new(r"(?i)\.(json|ya?ml|har)$").unwrap();
    re.replace(filename, "").trim().to_string()
}

/// Assigns fresh ids to every node (folders and requests), validating requests
/// through [`EndpointTest`] so the result matches what the store persists.
fn materialize_items(items: &[Value]) -> Result<Vec<Value>, String> {
    items.iter().map(prepare_node).collect()
}

fn prepare_node(node: &Value) -> Result<Value, String> {
    let obj = node.as_object().ok_or("Import node must be an object")?;
    if obj.get("type").and_then(|v| v.as_str()) == Some("folder") {
        let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("Folder").to_string();
        let children = obj
            .get("items")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().map(prepare_node).collect::<Result<Vec<_>, String>>())
            .transpose()?
            .unwrap_or_default();
        return Ok(json!({ "id": Uuid::new_v4().to_string(), "name": name, "type": "folder", "items": children }));
    }
    let endpoint_id = format!("ep_{}", Uuid::new_v4().simple());
    let mut with_id = obj.clone();
    with_id.insert("id".into(), json!(endpoint_id));
    with_id.remove("type");
    let endpoint: EndpointTest = serde_json::from_value(Value::Object(with_id))
        .map_err(|e| format!("Endpoint '{}' is invalid: {e}", obj.get("name").and_then(|v| v.as_str()).unwrap_or("Unnamed")))?;
    let mut serialized = serde_json::to_value(&endpoint).map_err(|e| e.to_string())?;
    if let Some(m) = serialized.as_object_mut() {
        m.insert("type".into(), json!("request"));
    }
    Ok(serialized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_beacon_export() {
        let src = json!({
            "format": "beacon.project",
            "project": {
                "name": "Demo",
                "items": [
                    { "type": "request", "name": "Ping", "url": "/ping", "method": "GET" }
                ]
            }
        });
        let out = normalize(&src).unwrap();
        assert_eq!(out.format, "beacon");
        assert_eq!(out.endpoints_count, 1);
        assert_eq!(out.items[0]["name"], "Ping");
        assert!(out.items[0]["id"].as_str().unwrap().starts_with("ep_"));
    }

    #[test]
    fn imports_legacy_config() {
        let src = json!({
            "name": "Legacy",
            "base_url": "https://api.test",
            "variables": {"token": "abc"},
            "tests": [{"name": "Get", "url": "/x", "method": "GET"}]
        });
        let out = normalize(&src).unwrap();
        assert_eq!(out.format, "legacy");
        assert_eq!(out.endpoints_count, 1);
        assert_eq!(out.environments[0]["base_url"], "https://api.test");
    }

    #[test]
    fn imports_postman_v2_with_folders_and_auth() {
        let src = json!({
            "info": {"name": "Demo Postman", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
            "item": [
                {
                    "name": "Auth",
                    "item": [
                        {
                            "name": "Login",
                            "request": {
                                "method": "POST",
                                "header": [{"key": "Content-Type", "value": "application/json"}],
                                "url": {"raw": "https://api.test/login", "host": ["api","test"], "path": ["login"]},
                                "body": {"mode": "raw", "raw": "{\"email\":\"a@b.com\"}"},
                                "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{tkn}}"}]}
                            }
                        }
                    ]
                }
            ]
        });
        let out = normalize(&src).unwrap();
        assert_eq!(out.format, "postman");
        assert_eq!(out.folders_count, 1);
        assert_eq!(out.endpoints_count, 1);
        let folder = &out.items[0];
        assert_eq!(folder["name"], "Auth");
        let login = &folder["items"][0];
        assert_eq!(login["url"], "https://api.test/login");
        assert_eq!(login["payload"]["email"], "a@b.com");
        assert_eq!(login["headers"]["Authorization"], "Bearer {{tkn}}");
    }

    #[test]
    fn imports_openapi3_json() {
        let src = json!({
            "openapi": "3.0.0",
            "info": {"title": "Pets API"},
            "servers": [{"url": "https://petstore.test"}],
            "paths": {
                "/pets/{id}": {
                    "get": {
                        "summary": "Get pet",
                        "tags": ["Pets"],
                        "parameters": [{"name": "id", "in": "path", "schema": {"type": "string"}}]
                    }
                }
            }
        });
        let out = normalize(&src).unwrap();
        assert_eq!(out.format, "openapi3");
        assert_eq!(out.environments[0]["base_url"], "https://petstore.test");
        assert_eq!(out.folders_count, 1);
        let req = &out.items[0]["items"][0];
        assert_eq!(req["name"], "Get pet");
        assert_eq!(req["url"], "/pets/{{id}}");
    }

    #[test]
    fn imports_openapi_yaml_text_envelope() {
        let yaml = "openapi: '3.0.0'\ninfo:\n  title: Mini\npaths:\n  /ping:\n    get:\n      summary: Ping\n";
        let envelope = json!({"content": yaml, "filename": "spec.yaml"});
        let out = normalize(&envelope).unwrap();
        assert_eq!(out.format, "openapi3");
        assert_eq!(out.endpoints_count, 1);
    }

    #[test]
    fn imports_swagger2_json() {
        let src = json!({
            "swagger": "2.0",
            "host": "api.test",
            "basePath": "/v1",
            "schemes": ["https"],
            "paths": {
                "/items": {
                    "post": {
                        "summary": "Create item",
                        "parameters": [{"name": "body", "in": "body", "schema": {"type": "object", "properties": {"name": {"type": "string", "example": "x"}}}}]
                    }
                }
            }
        });
        let out = normalize(&src).unwrap();
        assert_eq!(out.format, "swagger2");
        assert_eq!(out.environments[0]["base_url"], "https://api.test/v1");
        let req = &out.items[0];
        assert_eq!(req["payload"]["name"], "x");
    }

    #[test]
    fn imports_insomnia_export() {
        let src = json!({
            "_type": "export",
            "resources": [
                {"_id": "wrk_1", "_type": "workspace", "name": "WS"},
                {"_id": "req_1", "_type": "request", "parentId": "wrk_1", "name": "Ping", "method": "GET", "url": "https://api.test/ping"}
            ]
        });
        let out = normalize(&src).unwrap();
        assert_eq!(out.format, "insomnia");
        assert_eq!(out.endpoints_count, 1);
        assert_eq!(out.items[0]["name"], "Ping");
    }

    #[test]
    fn imports_har_file() {
        let src = json!({
            "log": {
                "entries": [
                    {"request": {"method": "GET", "url": "https://api.test/items", "headers": [{"name": "Authorization", "value": "secret"}]}}
                ]
            }
        });
        let out = normalize(&src).unwrap();
        assert_eq!(out.format, "har");
        assert_eq!(out.endpoints_count, 1);
        let req = &out.items[0]["items"][0];
        assert!(req["headers"].as_object().unwrap().is_empty());
    }

    #[test]
    fn rejects_empty_or_unrecognized() {
        assert!(normalize(&json!({"foo": "bar"})).is_err());
        assert!(normalize(&json!({"tests": []})).is_err());
    }
}
