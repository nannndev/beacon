//! Structured auth resolution: project -> folder(s) -> endpoint. Mirrors
//! `core/auth.py` (`effective_auth` / `resolve_auth_headers`), which the Rust
//! core crate does not yet port — `APITester::execute_single` only sends
//! headers already on the endpoint. The CLI resolves auth into concrete
//! headers and merges them into the endpoint's `headers` map before
//! executing, exactly like the Python tester's `_build_request`.

use base64::Engine;
use serde_json::Value;
use std::collections::HashMap;

const INHERIT: &str = "inherit";
const NONE: &str = "none";

fn normalize_auth(auth: &Value) -> Option<HashMap<String, Value>> {
    let obj = auth.as_object()?;
    let kind = obj.get("type").and_then(|v| v.as_str()).unwrap_or("").trim().to_lowercase();
    if !["inherit", "none", "bearer", "basic", "apikey", "custom"].contains(&kind.as_str()) {
        return None;
    }
    let mut map: HashMap<String, Value> = obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    map.insert("type".to_string(), Value::String(kind));
    Some(map)
}

/// Resolve an inheritance chain, outermost first: project auth, then each
/// enclosing folder, then the endpoint's own `auth`. The most specific
/// concrete spec wins; `inherit` defers outward; `none` stops inheritance.
pub fn effective_auth(chain: &[Value]) -> Option<HashMap<String, Value>> {
    let mut resolved = None;
    for level in chain {
        let Some(normalized) = normalize_auth(level) else { continue };
        if normalized.get("type").and_then(|v| v.as_str()) == Some(INHERIT) {
            continue;
        }
        resolved = Some(normalized);
    }
    resolved
}

/// Build the headers for a concrete auth spec. `resolve` applies Beacon
/// templating so every credential field may be a `{{variable}}`.
pub fn resolve_auth_headers<F>(auth: Option<&HashMap<String, Value>>, resolve: F) -> HashMap<String, String>
where
    F: Fn(&str) -> String,
{
    let Some(normalized) = auth else { return HashMap::new() };
    let kind = normalized.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if kind == NONE || kind == INHERIT {
        return HashMap::new();
    }

    let value_of = |keys: &[&str], default: &str| -> String {
        for key in keys {
            if let Some(v) = normalized.get(*key) {
                let s = match v {
                    Value::String(s) => s.clone(),
                    Value::Null => String::new(),
                    other => other.to_string(),
                };
                if !s.is_empty() {
                    return resolve(&s);
                }
            }
        }
        default.to_string()
    };

    match kind {
        "bearer" => {
            let token = value_of(&["token", "value"], "");
            if token.is_empty() {
                HashMap::new()
            } else {
                HashMap::from([("Authorization".to_string(), format!("Bearer {}", token))])
            }
        }
        "basic" => {
            let username = value_of(&["username", "user"], "");
            let password = value_of(&["password", "pass"], "");
            if username.is_empty() && password.is_empty() {
                HashMap::new()
            } else {
                let encoded = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", username, password));
                HashMap::from([("Authorization".to_string(), format!("Basic {}", encoded))])
            }
        }
        "apikey" => {
            let header_name = value_of(&["key", "header"], "X-API-Key");
            let api_value = value_of(&["value", "token"], "");
            let placement = normalized.get("in").and_then(|v| v.as_str()).unwrap_or("header").to_lowercase();
            if placement != "header" || header_name.is_empty() {
                HashMap::new()
            } else {
                HashMap::from([(header_name, api_value)])
            }
        }
        "custom" => {
            let header_name = value_of(&["header", "key"], "Authorization");
            if header_name.is_empty() {
                HashMap::new()
            } else {
                HashMap::from([(header_name, value_of(&["value", "token"], ""))])
            }
        }
        _ => HashMap::new(),
    }
}
