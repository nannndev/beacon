//! Pure `curl` command parser for `beacon_add_endpoint_from_curl`.
//!
//! Ported from the frontend's reference parser (`frontend/src/lib/curlParser.ts`,
//! tests in `curlParser.test.ts`), plus `-u`/`--user` basic-auth support from the
//! deleted Python `add_endpoint_from_curl` (`git show e68e16e^:backend/app/mcp_server.py`).
use base64::Engine;
use serde_json::{json, Value};

#[derive(Debug)]
pub struct ParsedCurl {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub payload: Value,
    pub payload_type: String,
}

/// shortcut: flags we don't model (e.g. -m/--max-time, -x/--proxy, -k) are
/// skipped without consuming their value, same limitation as the deleted
/// Python parser; a value-bearing unknown flag's value could be misread as
/// the URL. Upgrade if curl snippets with those flags show up often.
pub fn parse_curl(input: &str) -> Result<ParsedCurl, String> {
    if input.trim().is_empty() {
        return Err("Empty cURL command".into());
    }

    // Normalize line continuations and collapse whitespace (matches curlParser.ts).
    let normalized = input
        .replace("\\\r\n", " ")
        .replace("\\\n", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty() {
        return Err("Invalid cURL command".into());
    }

    let tokens = tokenize(&normalized);
    if tokens.is_empty() {
        return Err("Could not parse cURL tokens".into());
    }

    let mut method = String::new();
    let mut url = String::new();
    let mut headers: Vec<(String, String)> = Vec::new();
    let mut body_raw: Option<String> = None;

    let mut i = 0;
    while i < tokens.len() {
        let tok = tokens[i].as_str();
        match tok {
            "curl" | "curl.exe" => i += 1,
            "-X" | "--request" => {
                if let Some(v) = tokens.get(i + 1) {
                    method = v.to_uppercase();
                }
                i += 2;
            }
            "-H" | "--header" => {
                if let Some(h) = tokens.get(i + 1) {
                    if let Some(idx) = h.find(':') {
                        headers.push((h[..idx].trim().to_string(), h[idx + 1..].trim().to_string()));
                    }
                }
                i += 2;
            }
            "-d" | "--data" | "--data-raw" | "--data-binary" | "--data-ascii" | "--data-urlencode" => {
                body_raw = tokens.get(i + 1).cloned();
                i += 2;
            }
            "-u" | "--user" => {
                if let Some(cred) = tokens.get(i + 1) {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(cred.as_bytes());
                    headers.push(("Authorization".to_string(), format!("Basic {encoded}")));
                }
                i += 2;
            }
            "--url" => {
                if let Some(v) = tokens.get(i + 1) {
                    url = v.clone();
                }
                i += 2;
            }
            _ => {
                if url.is_empty() && !tok.starts_with('-') {
                    url = tok.to_string();
                }
                i += 1;
            }
        }
    }

    if method.is_empty() {
        method = if body_raw.is_some() { "POST".into() } else { "GET".into() };
    }

    url = url.trim_matches(|c| c == '\'' || c == '"').to_string();
    if url.is_empty() {
        return Err("No URL found in the curl command.".into());
    }

    let content_type = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
        .map(|(_, v)| v.to_lowercase())
        .unwrap_or_default();

    let (payload, payload_type) = match &body_raw {
        None => (Value::Object(Default::default()), "json".to_string()),
        Some(raw) => {
            let trimmed = raw.trim();
            let looks_json = content_type.contains("application/json")
                || (trimmed.starts_with('{') && trimmed.ends_with('}'))
                || (trimmed.starts_with('[') && trimmed.ends_with(']'));
            if looks_json {
                match serde_json::from_str::<Value>(raw) {
                    Ok(v) => (v, "json".to_string()),
                    Err(_) => (json!(raw), "raw".to_string()),
                }
            } else if content_type.contains("application/x-www-form-urlencoded") {
                (json!(raw), "form".to_string())
            } else {
                (json!(raw), "raw".to_string())
            }
        }
    };

    Ok(ParsedCurl { url, method, headers, payload, payload_type })
}

/// Tokenizes honoring single and double quotes and backslash escapes.
fn tokenize(s: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_double = false;
    let mut in_single = false;
    let mut escape = false;
    for ch in s.chars() {
        if escape {
            current.push(ch);
            escape = false;
            continue;
        }
        match ch {
            '\\' => escape = true,
            '"' if !in_single => in_double = !in_double,
            '\'' if !in_double => in_single = !in_single,
            ' ' if !in_double && !in_single => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_get() {
        let p = parse_curl("curl https://api.example.com/v1/users").unwrap();
        assert_eq!(p.url, "https://api.example.com/v1/users");
        assert_eq!(p.method, "GET");
        assert!(p.headers.is_empty());
    }

    #[test]
    fn parses_post_with_headers_and_json_body() {
        let curl = "curl -X POST \"https://api.retailku.com/v1/auth/login\" \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Authorization: Bearer test_token\" \\\n  -d '{\"email\":\"admin@example.com\",\"password\":\"secret\"}'";
        let p = parse_curl(curl).unwrap();
        assert_eq!(p.url, "https://api.retailku.com/v1/auth/login");
        assert_eq!(p.method, "POST");
        assert!(p.headers.iter().any(|(k, v)| k == "Content-Type" && v == "application/json"));
        assert!(p.headers.iter().any(|(k, v)| k == "Authorization" && v == "Bearer test_token"));
        assert_eq!(p.payload_type, "json");
        assert_eq!(p.payload["email"], "admin@example.com");
        assert_eq!(p.payload["password"], "secret");
    }

    #[test]
    fn infers_post_when_data_given_without_x() {
        let p = parse_curl("curl \"https://api.example.com/v1/data\" -d \"raw_data_string\"").unwrap();
        assert_eq!(p.method, "POST");
        assert_eq!(p.payload, json!("raw_data_string"));
        assert_eq!(p.payload_type, "raw");
    }

    #[test]
    fn errors_on_empty_input() {
        assert_eq!(parse_curl("").unwrap_err(), "Empty cURL command");
    }

    #[test]
    fn basic_auth_from_dash_u() {
        let p = parse_curl("curl -u admin:secret https://api.example.com/x").unwrap();
        let expected = format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(b"admin:secret"));
        assert!(p.headers.iter().any(|(k, v)| k == "Authorization" && v == &expected));
    }

    #[test]
    fn supports_dash_dash_url_flag() {
        let p = parse_curl("curl -X GET --url https://api.example.com/health").unwrap();
        assert_eq!(p.url, "https://api.example.com/health");
        assert_eq!(p.method, "GET");
    }

    #[test]
    fn errors_without_url() {
        assert_eq!(parse_curl("curl -X GET").unwrap_err(), "No URL found in the curl command.");
    }
}
