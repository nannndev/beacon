//! Recursive Beacon template resolution and dynamic generator functions.

use std::collections::HashMap;
use std::sync::Arc;
use chrono::{SecondsFormat, Utc};
use parking_lot::RwLock;
use rand::seq::SliceRandom;
use rand::Rng;
use regex::{Captures, Regex};
use serde_json::Value;
use uuid::Uuid;

const FIRST_NAMES: &[&str] = &[
    "Andi", "Budi", "Citra", "Dewi", "Eko", "Fitri", "Gita", "Hadi", "Indah", "Joko", "Alex",
    "Sam", "Maria", "John",
];

const LAST_NAMES: &[&str] = &[
    "Santoso", "Wijaya", "Pratama", "Saputra", "Lestari", "Hidayat", "Kusuma", "Smith", "Garcia",
    "Lee",
];

const ALPHANUMERIC: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

pub struct TemplateResolver {
    variables: Arc<RwLock<HashMap<String, String>>>,
    dynamic_regex: Regex,
}

impl TemplateResolver {
    pub fn new(variables: Arc<RwLock<HashMap<String, String>>>) -> Self {
        Self {
            variables,
            dynamic_regex: Regex::new(r"\{\{([^}]+)\}\}").unwrap(),
        }
    }

    pub fn from_map(variables: HashMap<String, String>) -> Self {
        Self::new(Arc::new(RwLock::new(variables)))
    }

    pub fn resolve(&self, value: &Value, overlay: Option<&HashMap<String, String>>) -> Value {
        let mut snapshot = self.variables.read().clone();
        if let Some(ov) = overlay {
            for (k, v) in ov {
                snapshot.insert(k.clone(), v.clone());
            }
        }
        self.resolve_internal(value, &snapshot)
    }

    pub fn resolve_str(&self, text: &str, overlay: Option<&HashMap<String, String>>) -> String {
        let mut snapshot = self.variables.read().clone();
        if let Some(ov) = overlay {
            for (k, v) in ov {
                snapshot.insert(k.clone(), v.clone());
            }
        }
        self.substitute_string(text, &snapshot)
    }

    fn resolve_internal(&self, value: &Value, vars: &HashMap<String, String>) -> Value {
        match value {
            Value::String(s) => Value::String(self.substitute_string(s, vars)),
            Value::Object(map) => {
                if map.contains_key("__file__") {
                    return value.clone();
                }
                let mut out = serde_json::Map::new();
                for (k, v) in map {
                    out.insert(k.clone(), self.resolve_internal(v, vars));
                }
                Value::Object(out)
            }
            Value::Array(arr) => {
                let out = arr.iter().map(|item| self.resolve_internal(item, vars)).collect();
                Value::Array(out)
            }
            _ => value.clone(),
        }
    }

    fn substitute_string(&self, text: &str, vars: &HashMap<String, String>) -> String {
        let mut substituted = text.to_string();
        for (key, val) in vars {
            let token = format!("{{{{{}}}}}", key);
            substituted = substituted.replace(&token, val);
        }

        self.dynamic_regex
            .replace_all(&substituted, |caps: &Captures| {
                let spec = caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
                Self::generate(spec)
            })
            .to_string()
    }

    pub fn generate(spec: &str) -> String {
        let normalized = spec.to_lowercase();
        let trimmed = normalized.trim();
        let mut rng = rand::thread_rng();

        if trimmed == "random_email" {
            let n: u32 = rng.gen_range(100_000..10_000_000);
            return format!("test{}@mail.test", n);
        }
        if trimmed == "random_phone" {
            let digits: String = (0..8).map(|_| rng.gen_range(0..10).to_string()).collect();
            return format!("+62812{}", digits);
        }
        if trimmed == "random_uuid" || trimmed == "uuid" {
            return Uuid::new_v4().to_string();
        }
        if trimmed == "timestamp" {
            let now_ms = Utc::now().timestamp_millis();
            return now_ms.to_string();
        }
        if trimmed == "random_string" {
            return (0..8)
                .map(|_| *ALPHANUMERIC.choose(&mut rng).unwrap() as char)
                .collect();
        }
        if trimmed == "random_number" || trimmed == "random_int" {
            let n: u32 = rng.gen_range(100_000..=999_999);
            return n.to_string();
        }
        if trimmed == "random_name" {
            let first = FIRST_NAMES.choose(&mut rng).unwrap();
            let last = LAST_NAMES.choose(&mut rng).unwrap();
            return format!("{} {}", first, last);
        }
        if trimmed == "random_bool" {
            return if rng.gen_bool(0.5) { "true".into() } else { "false".into() };
        }
        if trimmed == "iso_date" {
            return Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        }
        if trimmed.starts_with("random_choice:") {
            let raw_spec = spec.trim();
            if let Some((_, rest)) = raw_spec.split_once(':') {
                let options: Vec<&str> = rest
                    .split('|')
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .collect();
                if let Some(choice) = options.choose(&mut rng) {
                    return choice.to_string();
                }
            }
            return String::new();
        }
        if trimmed.starts_with("random_int:") {
            if let Some((_, rest)) = trimmed.split_once(':') {
                if let Some((min_str, max_str)) = rest.split_once(':') {
                    if let (Ok(min), Ok(max)) = (min_str.parse::<i64>(), max_str.parse::<i64>()) {
                        if min <= max {
                            let val = rng.gen_range(min..=max);
                            return val.to_string();
                        }
                    }
                }
            }
            let fallback: u32 = rng.gen_range(1000..10_000);
            return fallback.to_string();
        }
        if trimmed.starts_with("random_string:") {
            if let Some((_, len_str)) = trimmed.split_once(':') {
                if let Ok(len) = len_str.parse::<usize>() {
                    let len = len.max(1);
                    return (0..len)
                        .map(|_| *ALPHANUMERIC.choose(&mut rng).unwrap() as char)
                        .collect();
                }
            }
            let fallback: u32 = rng.gen_range(100..1000);
            return format!("rnd{}", fallback);
        }

        format!("{{{{{}}}}}", spec)
    }
}

