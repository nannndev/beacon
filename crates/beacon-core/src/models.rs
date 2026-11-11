//! Serializable execution models matching Beacon's JSON contract.

use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct RequestOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_s: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_redirects: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verify_ssl: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
}

pub fn normalize_request_options(raw: Option<&Value>) -> Option<RequestOptions> {
    let obj = raw?.as_object()?;
    let mut opts = RequestOptions::default();
    let mut has_any = false;

    if let Some(t_val) = obj.get("timeout_s") {
        let t_opt = if let Some(n) = t_val.as_f64() {
            Some(n)
        } else if let Some(s) = t_val.as_str() {
            s.parse::<f64>().ok()
        } else {
            None
        };
        if let Some(t) = t_opt {
            if t > 0.0 {
                opts.timeout_s = Some(t.min(3600.0));
                has_any = true;
            }
        }
    }

    if let Some(fr) = obj.get("follow_redirects").and_then(|v| v.as_bool()) {
        if !fr {
            opts.follow_redirects = Some(false);
            has_any = true;
        }
    }

    if let Some(vssl) = obj.get("verify_ssl").and_then(|v| v.as_bool()) {
        if !vssl {
            opts.verify_ssl = Some(false);
            has_any = true;
        }
    }

    if let Some(proxy) = obj.get("proxy").and_then(|v| v.as_str()) {
        let trimmed = proxy.trim();
        if !trimmed.is_empty() {
            opts.proxy = Some(trimmed.to_string());
            has_any = true;
        }
    }

    if has_any {
        Some(opts)
    } else {
        None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointTest {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, Value>,
    #[serde(default)]
    pub payload: Value,
    #[serde(default = "default_payload_type")]
    pub payload_type: String,
    #[serde(default)]
    pub extractors: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_config: Option<Value>,
    #[serde(default)]
    pub assertions: Vec<Value>,
    #[serde(default = "default_target_type")]
    pub target_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mock_response: Option<Value>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub ws_message: String,
    #[serde(default = "default_ws_message_type", skip_serializing_if = "is_default_ws_msg_type")]
    pub ws_message_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub pre_request_script: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_options: Option<RequestOptions>,
    #[serde(skip)]
    pub inherited_auth: Vec<Value>,
}

fn default_method() -> String {
    "POST".to_string()
}
fn default_payload_type() -> String {
    "json".to_string()
}
fn default_target_type() -> String {
    "api".to_string()
}
fn default_ws_message_type() -> String {
    "text".to_string()
}
fn is_default_ws_msg_type(val: &str) -> bool {
    val == "text"
}

impl EndpointTest {
    pub fn new(id: Option<String>, name: String, url: String, method: Option<String>) -> Self {
        Self {
            id: id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            name,
            url,
            method: method.unwrap_or_else(|| "POST".to_string()).to_uppercase(),
            headers: HashMap::new(),
            payload: Value::Object(serde_json::Map::new()),
            payload_type: "json".to_string(),
            extractors: HashMap::new(),
            run_config: None,
            assertions: Vec::new(),
            target_type: "api".to_string(),
            auth: None,
            mock_response: None,
            ws_message: String::new(),
            ws_message_type: "text".to_string(),
            pre_request_script: String::new(),
            request_options: None,
            inherited_auth: Vec::new(),
        }
    }
}

use serde::de::Deserializer;
use serde::ser::{SerializeStruct, Serializer};

#[derive(Debug, Clone, Default)]
pub struct TestConfig {
    pub base_url: String,
    pub variables: Arc<RwLock<HashMap<String, String>>>,
    pub tests: Vec<EndpointTest>,
}

impl Serialize for TestConfig {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("TestConfig", 3)?;
        state.serialize_field("base_url", &self.base_url)?;
        state.serialize_field("variables", &*self.variables.read())?;
        state.serialize_field("tests", &self.tests)?;
        state.end()
    }
}

impl<'de> Deserialize<'de> for TestConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct Helper {
            #[serde(default)]
            base_url: String,
            #[serde(default)]
            variables: HashMap<String, Value>,
            #[serde(default)]
            tests: Vec<EndpointTest>,
        }
        let h = Helper::deserialize(deserializer)?;
        let mut str_vars = HashMap::new();
        for (k, v) in h.variables {
            str_vars.insert(
                k,
                match v {
                    Value::String(s) => s,
                    other => other.to_string(),
                },
            );
        }
        Ok(TestConfig::new(h.base_url, str_vars, h.tests))
    }
}

impl TestConfig {
    pub fn new(base_url: String, variables: HashMap<String, String>, tests: Vec<EndpointTest>) -> Self {
        Self {
            base_url,
            variables: Arc::new(RwLock::new(variables)),
            tests,
        }
    }

    pub fn snapshot_variables(&self) -> HashMap<String, String> {
        self.variables.read().clone()
    }
}

