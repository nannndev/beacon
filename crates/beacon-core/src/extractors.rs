//! Response-to-variable extraction for chained API workflows.

use crate::assertions::dig;
use crate::models::EndpointTest;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;

pub struct ResponseExtractor;

impl ResponseExtractor {
    pub fn apply(
        endpoint: &EndpointTest,
        json_body: Option<&Value>,
        headers: &HashMap<String, String>,
        variables: &mut HashMap<String, String>,
    ) -> Vec<String> {
        let mut changed = Vec::new();
        let cookie_header = headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("set-cookie"))
            .map(|(_, v)| v.as_str())
            .unwrap_or("");

        for (var_name, source) in &endpoint.extractors {
            if let Some(val) = Self::read_value(json_body, cookie_header, var_name, source) {
                let prev = variables.get(var_name);
                if prev.map(|s| s.as_str()) != Some(&val) {
                    changed.push(var_name.clone());
                }
                variables.insert(var_name.clone(), val);
            }
        }
        changed
    }

    fn read_value(
        json_body: Option<&Value>,
        cookie_header: &str,
        var_name: &str,
        source: &str,
    ) -> Option<String> {
        let lowered = source.to_lowercase();
        if lowered.starts_with("body.") {
            if let Some(body) = json_body {
                let dug = dig(body, source)?;
                return match dug {
                    Value::String(s) => Some(s.clone()),
                    Value::Number(n) => Some(n.to_string()),
                    Value::Bool(b) => Some(b.to_string()),
                    other => Some(other.to_string()),
                };
            }
            return None;
        }

        if lowered.contains("set-cookie") || lowered.contains("cookie") {
            let pattern = format!(r"(?i){}=([^;]+)", regex::escape(var_name));
            if let Ok(re) = Regex::new(&pattern) {
                if let Some(caps) = re.captures(cookie_header) {
                    if let Some(m) = caps.get(1) {
                        return Some(m.as_str().to_string());
                    }
                }
            }
        }

        None
    }
}

