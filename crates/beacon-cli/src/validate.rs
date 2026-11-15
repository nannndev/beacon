//! Preflight validation of a project scope without sending any request.
//! Mirrors `cli_runner.validate_project` and its diagnostic codes exactly,
//! since `docs/cli/reference.md` documents those codes as the CLI contract.

use crate::project::walk_project_items;
use regex::Regex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, serde::Serialize)]
pub struct Diagnostic {
    pub severity: &'static str,
    pub code: &'static str,
    pub location: String,
    pub message: String,
}

#[derive(Debug, Default, serde::Serialize)]
pub struct ValidationResult {
    pub diagnostics: Vec<Diagnostic>,
}

impl ValidationResult {
    pub fn errors(&self) -> Vec<&Diagnostic> {
        self.diagnostics.iter().filter(|d| d.severity == "error").collect()
    }
    pub fn warnings(&self) -> Vec<&Diagnostic> {
        self.diagnostics.iter().filter(|d| d.severity == "warning").collect()
    }
    pub fn valid(&self) -> bool {
        self.errors().is_empty()
    }
    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "valid": self.valid(),
            "summary": {"errors": self.errors().len(), "warnings": self.warnings().len()},
            "diagnostics": self.diagnostics,
        })
    }

    fn push(&mut self, severity: &'static str, code: &'static str, location: impl Into<String>, message: impl Into<String>) {
        let location = location.into();
        let message = message.into();
        if !self
            .diagnostics
            .iter()
            .any(|d| d.severity == severity && d.code == code && d.location == location && d.message == message)
        {
            self.diagnostics.push(Diagnostic { severity, code, location, message });
        }
    }
}

const HTTP_METHODS: &[&str] = &["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"];
const PAYLOAD_TYPES: &[&str] = &["json", "form", "multipart", "raw"];
const TARGET_TYPES: &[&str] = &["api", "web"];

fn assertion_operators(assertion_type: &str) -> Option<&'static [&'static str]> {
    match assertion_type {
        "status" => Some(&["eq", "ne", "lt", "gt", "lte", "gte"]),
        "time_ms" => Some(&["eq", "ne", "lt", "gt", "lte", "gte"]),
        "body_contains" => Some(&["eq"]),
        "jsonpath" => Some(&["eq", "ne", "contains", "exists"]),
        "header" => Some(&["exists", "eq", "contains"]),
        _ => None,
    }
}

fn template_tokens(value: &Value, re: &Regex) -> HashSet<String> {
    let mut out = HashSet::new();
    collect_tokens(value, re, &mut out);
    out
}

fn collect_tokens(value: &Value, re: &Regex, out: &mut HashSet<String>) {
    match value {
        Value::String(s) => {
            for cap in re.captures_iter(s) {
                out.insert(cap[1].trim().to_string());
            }
        }
        Value::Object(map) => {
            for v in map.values() {
                collect_tokens(v, re, out);
            }
        }
        Value::Array(arr) => {
            for v in arr {
                collect_tokens(v, re, out);
            }
        }
        _ => {}
    }
}

fn dynamic_template_error(token: &str) -> Option<String> {
    let normalized = token.to_lowercase();
    let normalized = normalized.trim();
    const KNOWN: &[&str] = &[
        "random_email", "random_phone", "random_uuid", "uuid", "timestamp",
        "random_string", "random_number", "random_int", "random_name", "random_bool", "iso_date",
    ];
    if KNOWN.contains(&normalized) {
        return None;
    }
    if let Some(raw_length) = normalized.strip_prefix("random_string:") {
        return match raw_length.parse::<i64>() {
            Ok(n) if n >= 1 => None,
            Ok(_) => Some("random_string length must be at least 1".to_string()),
            Err(_) => Some("random_string length must be an integer".to_string()),
        };
    }
    if let Some(rest) = normalized.strip_prefix("random_choice:") {
        let options: Vec<&str> = rest.split('|').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
        return if options.is_empty() {
            Some("random_choice needs options like random_choice:a|b|c".to_string())
        } else {
            None
        };
    }
    if let Some(rest) = normalized.strip_prefix("random_int:") {
        let parts: Vec<&str> = normalized.split(':').collect();
        if parts.len() != 3 {
            return Some("random_int must use random_int:MIN:MAX".to_string());
        }
        let _ = rest;
        return match (parts[1].parse::<i64>(), parts[2].parse::<i64>()) {
            (Ok(min), Ok(max)) if min <= max => None,
            (Ok(_), Ok(_)) => Some("random_int minimum cannot exceed maximum".to_string()),
            _ => Some("random_int bounds must be integers".to_string()),
        };
    }
    Some("unknown template variable".to_string())
}

/// Validate a runnable project scope. `variables` is the fully-resolved
/// variable map (after saved-env/--env-file/BEACON_VAR_*/--env-var
/// precedence); `missing_private` names variables that are secret-shaped but
/// still empty after that resolution.
pub fn validate_project(
    project: &Value,
    endpoints: &[Value],
    environment: Option<&Value>,
    variables: &HashMap<String, String>,
    missing_private: &HashSet<String>,
) -> ValidationResult {
    let mut result = ValidationResult::default();
    let template_re = Regex::new(r"\{\{([^}]+)\}\}").unwrap();
    let url_re = Regex::new(r"(?i)^https?://").unwrap();

    let mut seen_ids: HashMap<String, String> = HashMap::new();
    let mut seen_names: HashMap<(&'static str, String), String> = HashMap::new();

    let check_id = |id: Option<&str>, location: &str, result: &mut ValidationResult, seen_ids: &mut HashMap<String, String>| {
        let normalized = id.unwrap_or("").trim().to_string();
        if normalized.is_empty() {
            result.push("error", "missing_id", location, "Stable ID is required");
        } else if let Some(existing) = seen_ids.get(&normalized) {
            result.push(
                "error",
                "duplicate_id",
                location,
                format!("ID {:?} is already used by {}", normalized, existing),
            );
        } else {
            seen_ids.insert(normalized, location.to_string());
        }
    };

    check_id(project.get("id").and_then(|v| v.as_str()), "project", &mut result, &mut seen_ids);

    let environments = project.get("environments").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for env in &environments {
        let name = env.get("name").and_then(|v| v.as_str()).unwrap_or("unnamed");
        let location = format!("environment:{}", name);
        check_id(env.get("id").and_then(|v| v.as_str()), &location, &mut result, &mut seen_ids);
        let name_key = ("environment", name.to_lowercase());
        if !name.is_empty() && name_key.1 != "unnamed" {
            if seen_names.contains_key(&name_key) {
                result.push("warning", "ambiguous_name", &location, "Environment name is duplicated; CLI selection must use its ID");
            }
        }
        seen_names.insert(name_key, location);
    }

    let items = project.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for (item, parents) in walk_project_items(&items) {
        let label = item.get("name").and_then(|v| v.as_str()).unwrap_or("unnamed").to_string();
        let mut path_parts = parents.clone();
        path_parts.push(label.clone());
        let location_path = path_parts.join("/");
        let kind: &'static str = if item.get("type").and_then(|v| v.as_str()) == Some("folder") { "folder" } else { "endpoint" };
        let resource_location = format!("{}:{}", kind, location_path);
        check_id(item.get("id").and_then(|v| v.as_str()), &resource_location, &mut result, &mut seen_ids);
        let name_key = (kind, label.to_lowercase());
        if label != "unnamed" {
            if seen_names.contains_key(&name_key) {
                result.push(
                    "warning",
                    "ambiguous_name",
                    &resource_location,
                    format!("{} name is duplicated; CLI selection must use its ID", title_case(kind)),
                );
            }
        }
        seen_names.insert(name_key, resource_location);
    }

    if let Some(environment) = environment {
        let base_url = environment.get("base_url").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        if !base_url.is_empty() && !template_re.is_match(&base_url) && !url_re.is_match(&base_url) {
            result.push(
                "error",
                "invalid_base_url",
                format!("environment:{}", environment.get("name").and_then(|v| v.as_str()).unwrap_or("")),
                "Base URL must start with http:// or https://",
            );
        }
    }

    let available: HashSet<String> = variables.keys().cloned().collect();
    let endpoint_ids: HashSet<String> = endpoints.iter().filter_map(|e| e.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())).collect();
    let mut available = available;

    fn check_template_token(
        token: &str,
        location: &str,
        stack: &[String],
        available: &HashSet<String>,
        variables: &HashMap<String, String>,
        missing_private: &HashSet<String>,
        template_re: &Regex,
        result: &mut ValidationResult,
    ) {
        if available.contains(token) {
            if missing_private.contains(token) {
                result.push(
                    "error",
                    "missing_private_variable",
                    location,
                    format!("Private variable {:?} has no local or CI value", token),
                );
            } else if let Some(value) = variables.get(token) {
                if value.trim().is_empty() {
                    result.push("error", "empty_variable", location, format!("Variable {:?} is used but has no value", token));
                }
            }
            if stack.iter().any(|s| s == token) {
                let mut chain = stack.to_vec();
                chain.push(token.to_string());
                result.push("error", "cyclic_variable", location, format!("Variable template cycle detected: {}", chain.join(" -> ")));
                return;
            }
            let mut next_stack = stack.to_vec();
            next_stack.push(token.to_string());
            if let Some(value) = variables.get(token) {
                let mut deps: Vec<String> = template_re.captures_iter(value).map(|c| c[1].trim().to_string()).collect();
                deps.sort();
                deps.dedup();
                for dep in deps {
                    check_template_token(&dep, location, &next_stack, available, variables, missing_private, template_re, result);
                }
            }
            return;
        }
        if let Some(err) = dynamic_template_error(token) {
            result.push("error", "unknown_variable", location, format!("Template {:?}: {}", token, err));
        }
    }

    if let Some(environment) = environment {
        let location = format!("environment:{}", environment.get("name").and_then(|v| v.as_str()).unwrap_or("unnamed"));
        if let Some(base_url) = environment.get("base_url") {
            let mut tokens: Vec<String> = template_tokens(base_url, &template_re).into_iter().collect();
            tokens.sort();
            for token in tokens {
                check_template_token(&token, &location, &[], &available, variables, missing_private, &template_re, &mut result);
            }
        }
    }

    for (endpoint, parents) in walk_project_items(&items) {
        if endpoint.get("type").and_then(|v| v.as_str()) != Some("request") {
            continue;
        }
        let id = endpoint.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if !endpoint_ids.contains(&id) {
            continue;
        }
        let name = endpoint.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let mut path_parts = parents.clone();
        path_parts.push(if name.is_empty() { id.clone() } else { name.clone() });
        let location = path_parts.join("/");
        let prefix = format!("endpoint:{}", location);
        let url = endpoint.get("url").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let method = endpoint.get("method").and_then(|v| v.as_str()).unwrap_or("").to_uppercase();
        let payload_type = endpoint.get("payload_type").and_then(|v| v.as_str()).unwrap_or("json").to_lowercase();
        let target_type = endpoint.get("target_type").and_then(|v| v.as_str()).unwrap_or("api").to_lowercase();

        if name.is_empty() {
            result.push("error", "missing_name", &prefix, "Endpoint name is required");
        }
        if url.is_empty() {
            result.push("error", "missing_url", &prefix, "Request URL is required");
        } else if !url_re.is_match(&url) && !template_re.is_match(&url) {
            let base_url = environment.and_then(|e| e.get("base_url")).and_then(|v| v.as_str()).unwrap_or("").trim();
            if base_url.is_empty() {
                result.push("error", "missing_base_url", &prefix, "Relative request URL requires an environment base URL");
            }
        }
        if !HTTP_METHODS.contains(&method.as_str()) {
            result.push("error", "invalid_method", &prefix, format!("Unsupported HTTP method: {}", if method.is_empty() { "empty".to_string() } else { method.clone() }));
        }
        if !PAYLOAD_TYPES.contains(&payload_type.as_str()) {
            result.push("error", "invalid_payload_type", &prefix, format!("Unsupported payload type: {}", payload_type));
        }
        if !TARGET_TYPES.contains(&target_type.as_str()) {
            result.push("error", "invalid_target_type", &prefix, format!("Unsupported target type: {}", target_type));
        }
        if let Some(headers) = endpoint.get("headers") {
            if !headers.is_object() {
                result.push("error", "invalid_headers", &prefix, "Headers must be a key-value mapping");
            }
        }

        let mut extractor_names: Vec<String> = Vec::new();
        match endpoint.get("extractors") {
            Some(Value::Object(map)) => {
                for (variable_name, source) in map {
                    extractor_names.push(variable_name.clone());
                    let extractor_location = format!("{}.extractor:{}", prefix, if variable_name.is_empty() { "unnamed" } else { variable_name });
                    let normalized_source = source.as_str().unwrap_or("").to_string();
                    if variable_name.trim().is_empty() {
                        result.push("error", "missing_extractor_name", &extractor_location, "Extractor variable name is required");
                    }
                    if !normalized_source.starts_with("body.") && !normalized_source.to_lowercase().contains("cookie") {
                        result.push("error", "invalid_extractor_source", &extractor_location, "Extractor source must be body.PATH or a cookie source");
                    } else if normalized_source == "body." {
                        result.push("error", "invalid_extractor_source", &extractor_location, "Extractor body path cannot be empty");
                    }
                }
            }
            Some(_) => {
                result.push("error", "invalid_extractors", &prefix, "Extractors must be a variable-to-source mapping");
            }
            None => {}
        }

        match endpoint.get("assertions") {
            Some(Value::Array(assertions)) => {
                for (index, assertion) in assertions.iter().enumerate() {
                    let assertion_location = format!("{}.assertion:{}", prefix, index + 1);
                    let Some(assertion_obj) = assertion.as_object() else {
                        result.push("error", "invalid_assertion", &assertion_location, "Assertion must be a mapping");
                        continue;
                    };
                    let assertion_type = assertion_obj.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let Some(operators) = assertion_operators(&assertion_type) else {
                        result.push("error", "invalid_assertion_type", &assertion_location, format!("Unsupported assertion type: {}", if assertion_type.is_empty() { "empty".to_string() } else { assertion_type }));
                        continue;
                    };
                    let default_op = if assertion_type == "body_contains" { "eq" } else { "" };
                    let operator = assertion_obj.get("op").and_then(|v| v.as_str()).unwrap_or(default_op).to_string();
                    if !operators.contains(&operator.as_str()) {
                        result.push("error", "invalid_assertion_operator", &assertion_location, format!("Operator {} is not valid for {}", if operator.is_empty() { "empty".to_string() } else { operator.clone() }, assertion_type));
                    }
                    if assertion_type == "header" && assertion_obj.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().is_empty() {
                        result.push("error", "missing_header_name", &assertion_location, "Header assertion requires a header name");
                    }
                    if assertion_type == "jsonpath" && assertion_obj.get("path").and_then(|v| v.as_str()).unwrap_or("").trim().is_empty() {
                        result.push("error", "missing_json_path", &assertion_location, "JSON assertion requires a path");
                    }
                    if operator != "exists" && assertion_obj.get("value").map(|v| v.is_null()).unwrap_or(true) {
                        result.push("error", "missing_assertion_value", &assertion_location, "Assertion expected value is required");
                    }
                }
            }
            Some(_) => {
                result.push("error", "invalid_assertions", &prefix, "Assertions must be a list");
            }
            None => {}
        }

        let template_input = serde_json::json!({
            "url": endpoint.get("url"),
            "headers": endpoint.get("headers"),
            "payload": endpoint.get("payload"),
        });
        let mut tokens: Vec<String> = template_tokens(&template_input, &template_re).into_iter().collect();
        tokens.sort();
        for token in tokens {
            check_template_token(&token, &prefix, &[], &available, variables, missing_private, &template_re, &mut result);
        }
        for name in extractor_names {
            available.insert(name);
        }

        match endpoint.get("run_config") {
            Some(rc) if !rc.is_object() && !rc.is_null() => {
                result.push("error", "invalid_run_config", &prefix, "Run configuration must be a mapping");
            }
            Some(Value::Object(rc)) => {
                for (key, minimum) in [("concurrency", 1.0), ("max_requests", 1.0), ("delay", 0.0)] {
                    let Some(value) = rc.get(key) else { continue };
                    let numeric = value.as_f64().or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()));
                    match numeric {
                        None => {
                            result.push("error", "invalid_run_config", &prefix, format!("{} must be numeric", key));
                        }
                        Some(n) if n < minimum => {
                            result.push("error", "invalid_run_config", &prefix, format!("{} must be at least {}", key, minimum as i64));
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    if endpoints.is_empty() {
        result.push("warning", "empty_scope", "project", "Selected scope contains no endpoints");
    }

    result
}

fn title_case(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}
