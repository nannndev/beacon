//! Detection and normalization for portable API project formats (port of the Python
//! `project_importer.py`). Every importer returns the same Beacon project shape plus a
//! conversion report. No persistence happens here, so preview and import share logic.

use beacon_core::EndpointTest;
use serde_json::{json, Map, Value};
use uuid::Uuid;

const METHODS: [&str; 8] = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

type R<T> = Result<T, String>;

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str).filter(|x| !x.is_empty())
}
fn arr<'a>(v: &'a Value, k: &str) -> &'a [Value] {
    v.get(k).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(x)) => !x.is_empty(),
        Some(Value::Array(x)) => !x.is_empty(),
        Some(Value::Object(x)) => !x.is_empty(),
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
        Some(Value::Bool(true)) => true,
    }
}
fn text(v: &Value) -> String {
    match v {
        Value::String(x) => x.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}
fn obj_or_empty(v: Option<&Value>) -> Value {
    v.filter(|x| x.is_object()).cloned().unwrap_or_else(|| json!({}))
}

/// Python `urlencode(pairs, safe="{}")`: quote_plus, keeping `{}` so `{{var}}` survives.
fn urlencode(pairs: &[(String, String)]) -> String {
    let enc = |x: &str| {
        x.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b'-' | b'~' | b'{' | b'}' => (b as char).to_string(),
                b' ' => "+".into(),
                _ => format!("%{b:02X}"),
            })
            .collect::<String>()
    };
    pairs.iter().map(|(k, v)| format!("{}={}", enc(k), enc(v))).collect::<Vec<_>>().join("&")
}
fn append_query(url: &mut String, pairs: &[(String, String)]) {
    if !pairs.is_empty() {
        url.push(if url.contains('?') { '&' } else { '?' });
        url.push_str(&urlencode(pairs));
    }
}

/// Assign collision-free ids and validate request nodes. Returns the persisted tree.
pub fn materialize_items(items: &[Value]) -> R<(Vec<Value>, usize)> {
    fn prepare(node: &Value, count: &mut usize) -> R<Value> {
        if node["type"] == "folder" {
            let children = arr(node, "items").iter().map(|c| prepare(c, count)).collect::<R<Vec<_>>>()?;
            return Ok(json!({ "id": Uuid::new_v4().to_string(), "name": s(node, "name").unwrap_or("Folder"), "type": "folder", "items": children }));
        }
        let mut raw = node.clone();
        raw["id"] = json!(Uuid::new_v4().to_string());
        raw.as_object_mut().map(|o| o.remove("type"));
        let ep: EndpointTest = serde_json::from_value(raw)
            .map_err(|e| format!("Endpoint '{}' is invalid: {e}", s(node, "name").unwrap_or("Unnamed")))?;
        let mut out = serde_json::to_value(ep).map_err(|e| e.to_string())?;
        out["type"] = json!("request");
        *count += 1;
        Ok(out)
    }
    let mut count = 0;
    let tree = items.iter().map(|i| prepare(i, &mut count)).collect::<R<Vec<_>>>()?;
    Ok((tree, count))
}

/// Accept a direct JSON body or the `{content, filename}` envelope (JSON or YAML text).
fn parse_source(data: &Value) -> R<(Value, String)> {
    let Some(content) = data.get("content").and_then(Value::as_str) else {
        return Ok((data.clone(), String::new()));
    };
    let raw = content.trim();
    let filename = s(data, "filename").unwrap_or("").to_string();
    if raw.is_empty() {
        return Err("The selected file is empty.".into());
    }
    if let Ok(v) = serde_json::from_str::<Value>(raw) {
        return Ok((v, filename));
    }
    let parsed: Value = serde_yaml::from_str(raw).map_err(|e| format!("Could not parse JSON or YAML: {e}"))?;
    if !(parsed.is_object() || parsed.is_array()) {
        return Err("The file must contain a JSON/YAML object or collection.".into());
    }
    Ok((parsed, filename))
}

pub fn normalize_project(data: &Value) -> R<Value> {
    let (source, filename) = parse_source(data)?;
    if !source.is_object() {
        return Err("Expected a project or API collection object at the top level.".into());
    }
    let fmt = detect_format(&source)?;
    let mut warnings = Vec::new();
    let mut project = match fmt {
        "beacon" => beacon(&source, &mut warnings)?,
        "postman" => postman(&source, &mut warnings)?,
        "openapi3" => openapi(&source, &mut warnings, false)?,
        "swagger2" => openapi(&source, &mut warnings, true)?,
        "insomnia" => insomnia(&source)?,
        "har" => har(&source, &mut warnings)?,
        _ => legacy(&source, &mut warnings)?,
    };
    let (endpoints, folders) = count_tree(arr(&project, "items"));
    if endpoints == 0 {
        return Err("No importable requests were found. Use a Beacon export, Postman collection, \
                    OpenAPI/Swagger document, Insomnia export, or HAR file."
            .into());
    }
    let name = s(&project, "name").map(String::from).or_else(|| Some(stem(&filename)).filter(|x| !x.is_empty())).unwrap_or_else(|| "Imported Project".into());
    project["name"] = json!(name);
    if arr(&project, "environments").is_empty() {
        project["environments"] = json!([environment("Local", "", None)]);
    }
    let mut unique: Vec<String> = Vec::new();
    for w in warnings {
        if !unique.contains(&w) {
            unique.push(w);
        }
    }
    let label = match fmt {
        "beacon" => "Beacon project",
        "postman" => "Postman collection",
        "openapi3" => "OpenAPI 3",
        "swagger2" => "Swagger 2",
        "insomnia" => "Insomnia export",
        "har" => "HTTP Archive (HAR)",
        _ => "Beacon legacy config",
    };
    Ok(json!({
        "format": fmt,
        "format_label": label,
        "summary": {
            "name": name, "endpoints": endpoints, "folders": folders,
            "environments": arr(&project, "environments").len(), "warnings": unique.len(),
        },
        "warnings": unique,
        "project": project,
    }))
}

fn detect_format(data: &Value) -> R<&'static str> {
    let payload = if data["project"].is_object() { &data["project"] } else { data };
    if matches!(s(data, "format"), Some("security-tools.project" | "beacon.project")) {
        return Ok("beacon");
    }
    if (payload.get("items").is_some() || payload.get("environments").is_some()) && payload.get("paths").is_none() {
        return Ok("beacon");
    }
    let info_ok = !truthy(data.get("info")) || data["info"].is_object();
    if data.get("item").is_some() && (info_ok || !data["variable"].is_null()) {
        return Ok("postman");
    }
    if data["paths"].is_object() {
        if text(&data["openapi"]).starts_with('3') {
            return Ok("openapi3");
        }
        if text(&data["swagger"]).starts_with('2') {
            return Ok("swagger2");
        }
    }
    if data["_type"] == "export" && data["resources"].is_array() {
        return Ok("insomnia");
    }
    if data["log"]["entries"].is_array() {
        return Ok("har");
    }
    if payload.get("tests").is_some() && (payload.get("base_url").is_some() || payload.get("variables").is_some()) {
        return Ok("legacy");
    }
    Err("Format not recognized. Supported: Beacon, Postman v2, OpenAPI 3, Swagger 2, Insomnia, and HAR.".into())
}

fn beacon(data: &Value, warnings: &mut Vec<String>) -> R<Value> {
    if matches!(s(data, "format"), Some("security-tools.project" | "beacon.project")) {
        if let Some(v) = data.get("version").filter(|v| !v.is_null() && **v != json!(1)) {
            return Err(format!("Beacon project version {v} is not supported."));
        }
    }
    let payload = if data["project"].is_object() { &data["project"] } else { data };
    let mut items = payload.get("items").cloned().unwrap_or(Value::Null);
    if items.is_null() && truthy(payload.get("tests")) {
        items = Value::Array(arr(payload, "tests").iter().filter(|t| t.is_object()).map(|t| { let mut t = t.clone(); t["type"] = json!("request"); t }).collect());
    }
    let Some(items) = items.as_array() else {
        return Err("Beacon project field 'items' must be an array.".into());
    };
    Ok(json!({
        "name": s(payload, "name").unwrap_or("Imported Beacon Project"),
        "environments": normalize_environments(payload.get("environments"))?,
        "items": items.iter().filter(|i| i.is_object()).map(|i| beacon_node(i, warnings)).collect::<R<Vec<_>>>()?,
    }))
}

fn beacon_node(node: &Value, warnings: &mut Vec<String>) -> R<Value> {
    if node["type"] == "folder" || node["items"].is_array() {
        let children = arr(node, "items").iter().filter(|c| c.is_object()).map(|c| beacon_node(c, warnings)).collect::<R<Vec<_>>>()?;
        return Ok(json!({ "name": s(node, "name").unwrap_or("Folder"), "type": "folder", "items": children }));
    }
    let mut req = request(node.get("name"), node.get("url"), node.get("method"), node.get("headers").cloned(), node.get("payload").cloned(), s(node, "payload_type"))?;
    if node["extractors"].is_object() {
        req["extractors"] = node["extractors"].clone();
    }
    if node["assertions"].is_array() {
        req["assertions"] = node["assertions"].clone();
    }
    if node["run_config"].is_object() {
        req["run_config"] = node["run_config"].clone();
    }
    if matches!(s(node, "target_type"), Some("api" | "web")) {
        req["target_type"] = node["target_type"].clone();
    }
    // Rust-only fields Beacon itself exports; keep them on round-trip.
    for k in ["auth", "pre_request_script", "request_options", "mock_response", "ws_message", "ws_message_type", "description"] {
        if truthy(node.get(k)) {
            req[k] = node[k].clone();
        }
    }
    Ok(req)
}

fn legacy(data: &Value, warnings: &mut Vec<String>) -> R<Value> {
    let payload = if data["project"].is_object() { &data["project"] } else { data };
    let Some(tests) = payload["tests"].as_array() else {
        return Err("Legacy config field 'tests' must be an array.".into());
    };
    Ok(json!({
        "name": s(payload, "name").unwrap_or("Imported Config"),
        "environments": [environment("Imported", &text(&payload["base_url"]), payload.get("variables"))],
        "items": tests.iter().filter(|t| t.is_object()).map(|t| beacon_node(t, warnings)).collect::<R<Vec<_>>>()?,
    }))
}

fn postman(data: &Value, warnings: &mut Vec<String>) -> R<Value> {
    fn auth_or<'a>(node: &'a Value, inherited: &'a Value) -> &'a Value {
        node.get("auth").unwrap_or(inherited)
    }
    fn convert(node: &Value, inherited: &Value, scripts: &mut usize, warnings: &mut Vec<String>) -> R<Option<Value>> {
        *scripts += arr(node, "event").len();
        if let Some(children) = node["item"].as_array() {
            let auth = auth_or(node, inherited);
            let mut items = Vec::new();
            for c in children.iter().filter(|c| c.is_object()) {
                if let Some(i) = convert(c, auth, scripts, warnings)? {
                    items.push(i);
                }
            }
            return Ok(Some(json!({ "name": s(node, "name").unwrap_or("Folder"), "type": "folder", "items": items })));
        }
        let req = &node["request"];
        if req.is_string() {
            return request(node.get("name"), Some(req), Some(&json!("GET")), None, None, None).map(Some);
        }
        if !req.is_object() {
            warnings.push(format!("Skipped Postman item '{}' because it has no request.", s(node, "name").unwrap_or("Unnamed")));
            return Ok(None);
        }
        let url = match &req["url"] {
            Value::Object(_) => json!(s(&req["url"], "raw").map(String::from).unwrap_or_else(|| postman_url(&req["url"]))),
            Value::Null => json!(""),
            other => other.clone(),
        };
        let mut headers = header_list(req.get("header"), "key");
        apply_postman_auth(&mut headers, auth_or(req, inherited), warnings);
        let name = s(node, "name").unwrap_or("Request");
        let (payload, ptype) = postman_body(&req["body"], warnings, name);
        *scripts += arr(req, "event").len();
        request(node.get("name"), Some(&url), req.get("method"), Some(Value::Object(headers)), Some(payload), Some(ptype)).map(Some)
    }
    let mut scripts = arr(data, "event").len();
    let mut items = Vec::new();
    for i in arr(data, "item").iter().filter(|i| i.is_object()) {
        if let Some(c) = convert(i, &data["auth"], &mut scripts, warnings)? {
            items.push(c);
        }
    }
    if scripts > 0 {
        warnings.push(format!("Ignored {scripts} Postman pre-request/test script block(s); Beacon does not execute collection scripts."));
    }
    let variables: Map<String, Value> = arr(data, "variable")
        .iter()
        .filter_map(|v| Some((text(v.get("key").filter(|k| truthy(Some(k)))?), v.get("value").cloned().unwrap_or(json!("")))))
        .collect();
    Ok(json!({
        "name": s(&data["info"], "name").or_else(|| s(data, "name")).unwrap_or("Imported Postman Collection"),
        "environments": [environment("Collection variables", "", Some(&Value::Object(variables)))],
        "items": items,
    }))
}

fn postman_url(url: &Value) -> String {
    let join = |v: &Value, sep: &str| match v {
        Value::Array(a) => a.iter().map(text).collect::<Vec<_>>().join(sep),
        other => text(other),
    };
    let mut out = format!("{}://{}/{}", s(url, "protocol").unwrap_or("https"), join(&url["host"], "."), join(&url["path"], "/"));
    let query: Vec<(String, String)> = arr(url, "query")
        .iter()
        .filter(|q| q.is_object() && !truthy(q.get("disabled")))
        .map(|q| (text(&q["key"]), text(&q["value"])))
        .collect();
    append_query(&mut out, &query);
    out
}

fn postman_body(body: &Value, warnings: &mut Vec<String>, name: &str) -> (Value, &'static str) {
    if !body.is_object() {
        return (json!({}), "json");
    }
    match s(body, "mode") {
        Some("raw") => {
            let raw = text(&body["raw"]);
            match serde_json::from_str(&raw) {
                Ok(v) => (v, "json"),
                Err(_) => (json!(raw), "raw"),
            }
        }
        Some(mode @ ("urlencoded" | "formdata")) => {
            let mut payload = Map::new();
            for row in arr(body, mode) {
                let Some(key) = s(row, "key") else { continue };
                if truthy(row.get("disabled")) {
                    continue;
                }
                if row["type"] == "file" {
                    warnings.push(format!("'{name}': imported file field '{key}' without a local file value."));
                    payload.insert(key.into(), json!(""));
                } else {
                    payload.insert(key.into(), row.get("value").cloned().unwrap_or(json!("")));
                }
            }
            (Value::Object(payload), if mode == "formdata" { "multipart" } else { "form" })
        }
        Some("graphql") => {
            let g = &body["graphql"];
            let mut vars = g.get("variables").cloned().filter(|v| truthy(Some(v))).unwrap_or(json!({}));
            if let Value::String(x) = &vars {
                vars = serde_json::from_str(x).unwrap_or(json!({}));
            }
            (json!({ "query": g.get("query").cloned().unwrap_or(json!("")), "variables": vars }), "json")
        }
        Some("file") => {
            warnings.push(format!("'{name}': binary request body was omitted; select the file again on this device."));
            (json!({}), "multipart")
        }
        _ => (json!({}), "json"),
    }
}

fn apply_postman_auth(headers: &mut Map<String, Value>, auth: &Value, warnings: &mut Vec<String>) {
    let Some(kind) = auth.get("type").and_then(Value::as_str).filter(|k| *k != "noauth") else { return };
    let values: Map<String, Value> = arr(auth, kind).iter().filter(|v| v.is_object()).map(|v| (text(&v["key"]), v.get("value").cloned().unwrap_or(json!("")))).collect();
    let mut set_default = |k: String, v: String| {
        headers.entry(k).or_insert(json!(v));
    };
    match kind {
        "bearer" => set_default("Authorization".into(), format!("Bearer {}", values.get("token").map(text).unwrap_or_else(|| "{{access_token}}".into()))),
        "apikey" => {
            if values.get("in") == Some(&json!("header")) {
                let key = values.get("key").map(text).filter(|k| !k.is_empty()).unwrap_or_else(|| "X-API-Key".into());
                set_default(key, values.get("value").map(text).unwrap_or_default());
            } else {
                warnings.push("A Postman API key stored in query parameters needs manual review.".into());
            }
        }
        "basic" => {
            set_default("Authorization".into(), "Basic {{basic_auth}}".into());
            warnings.push("Basic auth credentials were replaced with {{basic_auth}} to avoid embedding secrets.".into());
        }
        other => warnings.push(format!("Postman auth type '{other}' is not converted automatically.")),
    }
}

fn openapi(data: &Value, warnings: &mut Vec<String>, swagger: bool) -> R<Value> {
    let base_url = if swagger { swagger_base(data) } else { openapi_server(data) };
    let schemes = if swagger { &data["securityDefinitions"] } else { &data["components"]["securitySchemes"] };
    let mut by_tag: Vec<(String, Vec<Value>)> = Vec::new();
    let mut ungrouped = Vec::new();
    for (path, path_item) in data["paths"].as_object().into_iter().flatten() {
        let Some(ops) = path_item.as_object() else { continue };
        for (method, op) in ops {
            if !METHODS.contains(&method.to_lowercase().as_str()) || !op.is_object() {
                continue;
            }
            let params: Vec<Value> = arr(path_item, "parameters").iter().chain(arr(op, "parameters")).filter(|p| p.is_object()).cloned().collect();
            let (url, mut headers) = openapi_parameters(path, &params, data);
            let (payload, ptype) = openapi_body(op, &params, data, swagger);
            let security = op.get("security").unwrap_or(&data["security"]);
            openapi_security(&mut headers, security, schemes, warnings);
            let name = s(op, "summary").or_else(|| s(op, "operationId")).map(String::from).unwrap_or_else(|| format!("{} {path}", method.to_uppercase()));
            let req = request(Some(&json!(name)), Some(&json!(url)), Some(&json!(method)), Some(Value::Object(headers)), Some(payload), Some(ptype))?;
            match arr(op, "tags").first() {
                Some(tag) => {
                    let tag = text(tag);
                    match by_tag.iter_mut().find(|(t, _)| *t == tag) {
                        Some((_, list)) => list.push(req),
                        None => by_tag.push((tag, vec![req])),
                    }
                }
                None => ungrouped.push(req),
            }
        }
    }
    let mut items: Vec<Value> = by_tag.into_iter().map(|(t, reqs)| json!({ "name": t, "type": "folder", "items": reqs })).collect();
    items.extend(ungrouped);
    Ok(json!({ "name": s(&data["info"], "title").unwrap_or("Imported API"), "environments": [environment("Imported", &base_url, None)], "items": items }))
}

fn openapi_server(data: &Value) -> String {
    let server = &data["servers"][0];
    let mut url = text(&server["url"]);
    for (k, spec) in server["variables"].as_object().into_iter().flatten() {
        url = url.replace(&format!("{{{k}}}"), &text(&spec["default"]));
    }
    url.trim_end_matches('/').to_string()
}

fn swagger_base(data: &Value) -> String {
    let base_path = text(&data["basePath"]);
    let Some(host) = s(data, "host") else { return base_path };
    let scheme = data["schemes"][0].as_str().unwrap_or("https");
    format!("{scheme}://{host}{base_path}").trim_end_matches('/').to_string()
}

fn openapi_parameters(path: &str, params: &[Value], root: &Value) -> (String, Map<String, Value>) {
    let mut headers = Map::new();
    let mut query = Vec::new();
    // `{id}` path params become `{{id}}` variables.
    let mut url = String::new();
    let mut rest = path;
    while let (Some(a), Some(b)) = (rest.find('{'), rest.find('}')) {
        if b < a {
            break;
        }
        url.push_str(&rest[..a]);
        url.push_str(&format!("{{{{{}}}}}", &rest[a + 1..b]));
        rest = &rest[b + 1..];
    }
    url.push_str(rest);
    for p in params {
        let p = resolve_ref(p, root);
        let (Some(name), loc) = (s(&p, "name"), s(&p, "in")) else { continue };
        if loc == Some("body") {
            continue;
        }
        let schema = if p["schema"].is_object() { p["schema"].clone() } else { p.clone() };
        let value = example(&schema, p.get("example"), root, 0);
        let token = if value.is_null() || value == json!("") { format!("{{{{{name}}}}}") } else { text(&value) };
        match loc {
            Some("query") => query.push((name.to_string(), token)),
            Some("header") => {
                headers.insert(name.into(), json!(token));
            }
            _ => {}
        }
    }
    append_query(&mut url, &query);
    (url, headers)
}

fn openapi_body(op: &Value, params: &[Value], root: &Value, swagger: bool) -> (Value, &'static str) {
    if swagger {
        if let Some(body) = params.iter().map(|p| resolve_ref(p, root)).find(|p| p["in"] == "body") {
            return (example(&body["schema"], body.get("x-example"), root, 0), "json");
        }
        let form: Map<String, Value> = params.iter().filter(|p| p["in"] == "formData").filter_map(|p| Some((s(p, "name")?.to_string(), example(p, None, root, 0)))).collect();
        return if form.is_empty() { (json!({}), "json") } else { (Value::Object(form), "multipart") };
    }
    let Some((mime, spec)) = op["requestBody"]["content"].as_object().and_then(|c| c.iter().next()) else {
        return (json!({}), "json");
    };
    let payload = match spec.get("example") {
        Some(e) => e.clone(),
        None => example(&spec["schema"], None, root, 0),
    };
    let or_empty = |p: Value| if truthy(Some(&p)) { p } else { json!({}) };
    if mime.contains("multipart") {
        (or_empty(payload), "multipart")
    } else if mime.contains("x-www-form-urlencoded") {
        (or_empty(payload), "form")
    } else if !mime.contains("json") {
        match payload {
            Value::String(_) => (payload, "raw"),
            p => (json!(or_empty(p).to_string()), "raw"),
        }
    } else {
        (or_empty(payload), "json")
    }
}

fn openapi_security(headers: &mut Map<String, Value>, security: &Value, schemes: &Value, warnings: &mut Vec<String>) {
    let Some(name) = security[0].as_object().and_then(|o| o.keys().next()) else { return };
    let scheme = &schemes[name];
    let mut set = |k: &str, v: &str| {
        headers.entry(k.to_string()).or_insert(json!(v));
    };
    match s(scheme, "type") {
        Some("http") if scheme["scheme"] == "bearer" => set("Authorization", "Bearer {{access_token}}"),
        Some("apiKey") if scheme["in"] == "header" => set(s(scheme, "name").unwrap_or("X-API-Key"), "{{api_key}}"),
        Some("oauth2" | "openIdConnect") => set("Authorization", "Bearer {{access_token}}"),
        _ => warnings.push(format!("Security scheme '{name}' needs manual configuration.")),
    }
}

fn insomnia(data: &Value) -> R<Value> {
    let resources: Vec<&Value> = arr(data, "resources").iter().filter(|r| r.is_object()).collect();
    let null = Value::Null;
    let workspace = resources.iter().find(|r| r["_type"] == "workspace").copied().unwrap_or(&null);
    let groups: Vec<&Value> = resources.iter().filter(|r| r["_type"] == "request_group").copied().collect();
    let mut children: Vec<(Value, Vec<Value>)> = Vec::new();
    for r in resources.iter().filter(|r| r["_type"] == "request") {
        let mime = text(&r["body"]["mimeType"]);
        let body = text(&r["body"]["text"]);
        let payload = if mime.contains("json") && !body.is_empty() { serde_json::from_str(&body).unwrap_or(json!(body)) } else { json!(body) };
        let ptype = if mime.contains("json") { "json" } else if mime.contains("form") { "form" } else { "raw" };
        let mut url = text(&r["url"]);
        let params: Vec<(String, String)> = arr(r, "parameters").iter().filter(|p| p.is_object() && !truthy(p.get("disabled"))).map(|p| (text(&p["name"]), text(&p["value"]))).collect();
        append_query(&mut url, &params);
        let req = request(r.get("name"), Some(&json!(url)), r.get("method"), Some(Value::Object(header_list(r.get("headers"), "name"))), Some(payload), Some(ptype))?;
        let parent = r["parentId"].clone();
        match children.iter_mut().find(|(p, _)| *p == parent) {
            Some((_, list)) => list.push(req),
            None => children.push((parent, vec![req])),
        }
    }
    let kids = |id: &Value| children.iter().find(|(p, _)| p == id).map(|(_, l)| l.clone()).unwrap_or_default();
    fn folder(g: &Value, groups: &[&Value], kids: &dyn Fn(&Value) -> Vec<Value>, depth: usize) -> Value {
        let nested: Vec<Value> = if depth > 32 { vec![] } else { groups.iter().filter(|c| c["parentId"] == g["_id"]).map(|c| folder(c, groups, kids, depth + 1)).collect() };
        let mut items = nested;
        items.extend(kids(&g["_id"]));
        json!({ "name": s(g, "name").unwrap_or("Folder"), "type": "folder", "items": items })
    }
    let root_id = &workspace["_id"];
    let mut items: Vec<Value> = groups.iter().filter(|g| g["parentId"] == *root_id).map(|g| folder(g, &groups, &kids, 0)).collect();
    items.extend(kids(root_id));
    let env = resources.iter().find(|r| r["_type"] == "environment" && r["parentId"] == *root_id).map(|e| e["data"].clone()).unwrap_or(Value::Null);
    Ok(json!({ "name": s(workspace, "name").unwrap_or("Imported Insomnia Workspace"), "environments": [environment("Imported", "", Some(&env))], "items": items }))
}

fn har(data: &Value, warnings: &mut Vec<String>) -> R<Value> {
    let mut domains: Vec<(String, Vec<Value>)> = Vec::new();
    for entry in arr(&data["log"], "entries") {
        let req = &entry["request"];
        if !req.is_object() {
            continue;
        }
        let url = text(&req["url"]);
        let parsed = reqwest::Url::parse(&url).ok();
        let host = parsed
            .as_ref()
            .and_then(|u| u.host_str().map(|h| u.port().map_or(h.to_string(), |p| format!("{h}:{p}"))))
            .unwrap_or_else(|| "Requests".into());
        let path = parsed.as_ref().map(|u| u.path().to_string()).unwrap_or_else(|| "/".into());
        let mut headers = header_list(req.get("headers"), "name");
        headers.retain(|k, _| !matches!(k.to_lowercase().as_str(), "authorization" | "cookie" | "proxy-authorization"));
        let post = &req["postData"];
        let body = text(&post["text"]);
        let mime = text(&post["mimeType"]);
        let payload = if mime.contains("json") && !body.is_empty() { serde_json::from_str(&body).unwrap_or(json!(body)) } else { json!(body) };
        let method = s(req, "method").unwrap_or("GET");
        let r = request(Some(&json!(format!("{method} {path}"))), Some(&json!(url)), req.get("method"), Some(Value::Object(headers)), Some(payload), Some(if mime.contains("json") { "json" } else { "raw" }))?;
        match domains.iter_mut().find(|(h, _)| *h == host) {
            Some((_, list)) => list.push(r),
            None => domains.push((host, vec![r])),
        }
    }
    warnings.push("HAR response bodies, cookies, and captured authorization values were not imported.".into());
    let items: Vec<Value> = domains.into_iter().map(|(h, l)| json!({ "name": h, "type": "folder", "items": l })).collect();
    Ok(json!({ "name": "Imported HAR", "environments": [environment("Captured", "", None)], "items": items }))
}

fn request(name: Option<&Value>, url: Option<&Value>, method: Option<&Value>, headers: Option<Value>, payload: Option<Value>, payload_type: Option<&str>) -> R<Value> {
    let name = name.map(text).filter(|n| !n.is_empty());
    let Some(url) = url.and_then(Value::as_str).filter(|u| !u.trim().is_empty()) else {
        return Err(format!("Request '{}' is missing a URL.", name.as_deref().unwrap_or("Unnamed")));
    };
    let method = method.map(text).filter(|m| !m.is_empty()).unwrap_or_else(|| "GET".into()).to_uppercase();
    Ok(json!({
        "name": name.unwrap_or_else(|| format!("{method} {url}")),
        "type": "request",
        "url": url,
        "method": method,
        "headers": obj_or_empty(headers.as_ref()),
        "payload": payload.filter(|p| !p.is_null()).unwrap_or_else(|| json!({})),
        "payload_type": payload_type.filter(|p| !p.is_empty()).unwrap_or("json"),
        "extractors": {},
        "assertions": [],
        "run_config": null,
        "target_type": "api",
    }))
}

fn environment(name: &str, base_url: &str, variables: Option<&Value>) -> Value {
    json!({ "name": name, "base_url": base_url, "variables": obj_or_empty(variables) })
}

fn normalize_environments(value: Option<&Value>) -> R<Vec<Value>> {
    match value {
        None | Some(Value::Null) => Ok(vec![environment("Local", "", None)]),
        Some(Value::Array(list)) => Ok(list
            .iter()
            .filter(|e| e.is_object())
            .map(|e| environment(s(e, "name").unwrap_or("Imported"), &text(&e["base_url"]), e.get("variables")))
            .collect()),
        _ => Err("Project field 'environments' must be an array.".into()),
    }
}

fn header_list(rows: Option<&Value>, key_name: &str) -> Map<String, Value> {
    rows.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|r| r.is_object() && s(r, key_name).is_some() && !truthy(r.get("disabled")))
        .map(|r| (text(&r[key_name]), r.get("value").cloned().unwrap_or(json!(""))))
        .collect()
}

fn resolve_ref(schema: &Value, root: &Value) -> Value {
    let Some(r) = schema.get("$ref").and_then(Value::as_str) else { return schema.clone() };
    let mut cur = root;
    for part in r.trim_start_matches("#/").split('/') {
        cur = &cur[part];
    }
    if cur.is_null() { json!({}) } else { cur.clone() }
}

/// An example value for a schema. Unlike the Python version this follows `$ref`s
/// (depth-limited so recursive schemas terminate).
fn example(schema: &Value, explicit: Option<&Value>, root: &Value, depth: usize) -> Value {
    if let Some(e) = explicit.filter(|e| !e.is_null()) {
        return e.clone();
    }
    if depth > 8 || !schema.is_object() {
        return json!("");
    }
    let schema = &resolve_ref(schema, root);
    for k in ["example", "default"] {
        if let Some(v) = schema.get(k) {
            return v.clone();
        }
    }
    if let Some(first) = schema["enum"].get(0) {
        return first.clone();
    }
    let kind = s(schema, "type");
    if kind == Some("object") || schema.get("properties").is_some() {
        let props = schema["properties"].as_object().into_iter().flatten();
        return Value::Object(props.map(|(k, v)| (k.clone(), example(v, None, root, depth + 1))).collect());
    }
    match kind {
        Some("array") => json!([example(&schema["items"], None, root, depth + 1)]),
        Some("integer" | "number") => json!(0),
        Some("boolean") => json!(false),
        _ => json!(""),
    }
}

fn count_tree(items: &[Value]) -> (usize, usize) {
    items.iter().fold((0, 0), |(e, f), i| match i["type"].as_str() {
        Some("folder") => {
            let (ce, cf) = count_tree(arr(i, "items"));
            (e + ce, f + 1 + cf)
        }
        Some("request") => (e + 1, f),
        _ => (e, f),
    })
}

fn stem(filename: &str) -> String {
    let lower = filename.to_lowercase();
    for ext in [".json", ".yaml", ".yml", ".har"] {
        if lower.ends_with(ext) {
            return filename[..filename.len() - ext.len()].trim().to_string();
        }
    }
    filename.trim().to_string()
}
