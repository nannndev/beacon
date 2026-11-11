//! HTTP request transport for Beacon endpoint execution.

use crate::models::{EndpointTest, RequestOptions};
use base64::Engine;
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::multipart::{Form, Part};
use reqwest::{Client, Method, Response};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::str::FromStr;
use std::time::{Duration, Instant};

pub fn resolve_target(base_url: &str, url: &str) -> String {
    let re = Regex::new(r"^[a-zA-Z][a-zA-Z0-9+.-]*://").unwrap();
    if re.is_match(url.trim()) {
        return url.trim().to_string();
    }
    let trimmed_base = base_url.trim_end_matches('/');
    let trimmed_url = url.trim_start_matches('/');
    if trimmed_base.is_empty() {
        trimmed_url.to_string()
    } else {
        format!("{}/{}", trimmed_base, trimmed_url)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpExecutionResult {
    pub status: u16,
    pub time_ms: f64,
    pub body: String,
    pub json: Option<Value>,
    pub headers: HashMap<String, String>,
}

pub struct HttpTransport {
    client: Client,
}

impl Default for HttpTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpTransport {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { client }
    }

    pub fn client_with_options(&self, options: Option<&RequestOptions>) -> Client {
        let mut builder = Client::builder();
        let timeout_s = options.and_then(|o| o.timeout_s).unwrap_or(30.0);
        builder = builder.timeout(Duration::from_secs_f64(timeout_s));

        if let Some(opts) = options {
            if let Some(false) = opts.follow_redirects {
                builder = builder.redirect(reqwest::redirect::Policy::none());
            }
            if let Some(false) = opts.verify_ssl {
                builder = builder.danger_accept_invalid_certs(true);
            }
            if let Some(ref proxy_url) = opts.proxy {
                if let Ok(proxy) = reqwest::Proxy::all(proxy_url) {
                    builder = builder.proxy(proxy);
                }
            }
        }

        builder.build().unwrap_or_else(|_| self.client.clone())
    }

    pub async fn execute(
        &self,
        endpoint: &EndpointTest,
        target_url: &str,
        resolved_headers: &HashMap<String, String>,
        resolved_payload: &Value,
    ) -> Result<HttpExecutionResult, reqwest::Error> {
        let client = self.client_with_options(endpoint.request_options.as_ref());
        let method = Method::from_str(&endpoint.method).unwrap_or(Method::POST);
        let mut req = client.request(method, target_url);

        let mut header_map = HeaderMap::new();
        for (k, v) in resolved_headers {
            if let (Ok(name), Ok(val)) = (HeaderName::from_str(k), HeaderValue::from_str(v)) {
                header_map.insert(name, val);
            }
        }

        let payload_type = endpoint.payload_type.to_lowercase();
        if endpoint.target_type == "web" {
            req = req.headers(header_map);
        } else if payload_type == "form" {
            let mut form_data = HashMap::new();
            if let Some(obj) = resolved_payload.as_object() {
                for (k, v) in obj {
                    let s = match v {
                        Value::String(str_val) => str_val.clone(),
                        Value::Number(n) => n.to_string(),
                        Value::Bool(b) => b.to_string(),
                        _ => v.to_string(),
                    };
                    form_data.insert(k.clone(), s);
                }
            }
            req = req.headers(header_map).form(&form_data);
        } else if payload_type == "multipart" {
            let mut form = Form::new();
            if let Some(obj) = resolved_payload.as_object() {
                for (k, v) in obj {
                    if let Some(f_obj) = v.as_object().filter(|o| o.contains_key("__file__")) {
                        let filename = f_obj
                            .get("name")
                            .and_then(|n| n.as_str())
                            .unwrap_or("file")
                            .to_string();
                        let mime = f_obj
                            .get("type")
                            .and_then(|m| m.as_str())
                            .unwrap_or("application/octet-stream")
                            .to_string();
                        let raw_b64 = f_obj.get("data").and_then(|d| d.as_str()).unwrap_or("");
                        let bytes = base64::engine::general_purpose::STANDARD
                            .decode(raw_b64)
                            .unwrap_or_default();
                        let part = match Part::bytes(bytes.clone())
                            .file_name(filename.clone())
                            .mime_str(&mime)
                        {
                            Ok(p) => p,
                            Err(_) => Part::bytes(bytes).file_name(filename),
                        };
                        form = form.part(k.clone(), part);
                    } else {
                        let text_val = match v {
                            Value::String(s) => s.clone(),
                            _ => v.to_string(),
                        };
                        form = form.text(k.clone(), text_val);
                    }
                }
            }
            header_map.remove(reqwest::header::CONTENT_TYPE);
            req = req.headers(header_map).multipart(form);
        } else if payload_type == "raw" {
            let raw_bytes = match resolved_payload {
                Value::String(s) => s.as_bytes().to_vec(),
                _ => resolved_payload.to_string().into_bytes(),
            };
            req = req.headers(header_map).body(raw_bytes);
        } else {
            req = req.headers(header_map).json(resolved_payload);
        }

        let started = Instant::now();
        let resp: Response = req.send().await?;
        let time_ms = started.elapsed().as_secs_f64() * 1000.0;
        let status = resp.status().as_u16();

        let mut out_headers = HashMap::new();
        for (k, v) in resp.headers() {
            if let Ok(val_str) = v.to_str() {
                out_headers.insert(k.as_str().to_string(), val_str.to_string());
            }
        }

        let body_bytes = resp.bytes().await?;
        let body_str = String::from_utf8_lossy(&body_bytes).to_string();
        let json_body: Option<Value> = serde_json::from_str(&body_str).ok();

        Ok(HttpExecutionResult {
            status,
            time_ms,
            body: body_str,
            json: json_body,
            headers: out_headers,
        })
    }
}

