//! Response assertion evaluation for Beacon test execution.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssertionResult {
    #[serde(rename = "type")]
    pub assertion_type: Option<String>,
    pub op: String,
    pub expected: Option<Value>,
    pub actual: Option<Value>,
    pub ok: bool,
    pub message: String,
}

pub fn dig<'a>(data: &'a Value, path: &str) -> Option<&'a Value> {
    if path.is_empty() {
        return None;
    }
    let normalized = if path.starts_with("body.") {
        &path[5..]
    } else {
        path
    };

    let mut current = data;
    for segment in normalized.split('.') {
        match current {
            Value::Object(map) => {
                current = map.get(segment)?;
            }
            Value::Array(arr) => {
                let idx: i64 = segment.parse().ok()?;
                let len = arr.len() as i64;
                let actual_idx = if idx < 0 { len + idx } else { idx };
                if actual_idx >= 0 && actual_idx < len {
                    current = arr.get(actual_idx as usize)?;
                } else {
                    return None;
                }
            }
            _ => return None,
        }
    }
    Some(current)
}

pub fn compare(operator: &str, actual: Option<&Value>, expected: Option<&Value>) -> bool {
    let op = operator.trim();
    if op == "exists" {
        return actual.is_some() && !matches!(actual, Some(Value::Null));
    }

    let actual_val = match actual {
        Some(v) if !v.is_null() => v,
        _ => return false,
    };
    let expected_val = match expected {
        Some(v) => v,
        None => return false,
    };

    let actual_str = value_to_raw_string(actual_val);
    let expected_str = value_to_raw_string(expected_val);

    match op {
        "eq" => actual_str == expected_str,
        "ne" => actual_str != expected_str,
        "contains" => actual_str.contains(&expected_str),
        "lt" | "gt" | "lte" | "gte" => {
            if let (Ok(left), Ok(right)) = (actual_str.parse::<f64>(), expected_str.parse::<f64>()) {
                match op {
                    "lt" => left < right,
                    "gt" => left > right,
                    "lte" => left <= right,
                    "gte" => left >= right,
                    _ => false,
                }
            } else {
                false
            }
        }
        _ => false,
    }
}

fn value_to_raw_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => v.to_string(),
    }
}

pub struct ExecutionResponseContext<'a> {
    pub status: u16,
    pub time_ms: f64,
    pub body: &'a str,
    pub json: Option<&'a Value>,
    pub headers: &'a HashMap<String, String>,
}

pub fn evaluate_assertions(
    assertions: &[Value],
    ctx: &ExecutionResponseContext,
) -> Vec<AssertionResult> {
    let mut results = Vec::new();
    let lower_headers: HashMap<String, String> = ctx
        .headers
        .iter()
        .map(|(k, v)| (k.to_lowercase(), v.clone()))
        .collect();

    for assertion in assertions {
        let assertion_type = assertion
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let operator = assertion
            .get("op")
            .and_then(|v| v.as_str())
            .unwrap_or("eq");
        let expected = assertion.get("value").cloned();
        let mut actual: Option<Value> = None;
        let ok;

        match assertion_type {
            "status" => {
                let status_val = Value::from(ctx.status);
                ok = compare(operator, Some(&status_val), expected.as_ref());
                actual = Some(status_val);
            }
            "time_ms" => {
                let time_val = Value::from(ctx.time_ms.round() as i64);
                ok = compare(operator, Some(&time_val), expected.as_ref());
                actual = Some(time_val);
            }
            "body_contains" => {
                let exp_str = expected
                    .as_ref()
                    .map(value_to_raw_string)
                    .unwrap_or_default();
                ok = ctx.body.contains(&exp_str);
            }
            "header" => {
                let h_name = assertion
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_lowercase();
                let h_val = lower_headers.get(&h_name).map(|s| Value::String(s.clone()));
                ok = compare(operator, h_val.as_ref(), expected.as_ref());
                actual = h_val;
            }
            "jsonpath" => {
                let path = assertion
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let dug = ctx.json.and_then(|j| dig(j, path)).cloned();
                ok = compare(operator, dug.as_ref(), expected.as_ref());
                actual = dug;
            }
            _ => {
                ok = false;
            }
        }

        let subject = match assertion_type {
            "status" => "status code".to_string(),
            "time_ms" => "response time (ms)".to_string(),
            "body_contains" => "response body".to_string(),
            "header" => format!(
                "header {}",
                assertion.get("name").and_then(|v| v.as_str()).unwrap_or("")
            ),
            "jsonpath" => format!(
                "JSON path {}",
                assertion.get("path").and_then(|v| v.as_str()).unwrap_or("")
            ),
            other => {
                if other.is_empty() {
                    "unknown assertion".to_string()
                } else {
                    other.to_string()
                }
            }
        };

        let mut message = format!("{} {} {:?}", subject, operator, expected);
        if !ok {
            message.push_str(&format!("; received {:?}", actual));
        }

        results.push(AssertionResult {
            assertion_type: Some(assertion_type.to_string()),
            op: operator.to_string(),
            expected,
            actual,
            ok,
            message,
        });
    }

    results
}

