//! Variable resolution: saved environment < --env-file < BEACON_VAR_* <
//! --env-var. Mirrors `cli_runner.parse_env_file` / `parse_env_vars` /
//! `shell_variable_name` / `resolve_variables` / `missing_private_values`.

use crate::error::{CliError, CliResult};
use regex::Regex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// `token|secret|password|authorization|cookie|api[_-]?key|private[_-]?key|credential`,
/// case-insensitive. Mirrors `project_file_sync.SECRET_NAME`.
pub fn is_secret_name(key: &str) -> bool {
    let re = Regex::new(r"(?i)token|secret|password|authorization|cookie|api[_-]?key|private[_-]?key|credential").unwrap();
    re.is_match(key)
}

/// The `BEACON_VAR_*` suffix used for a Beacon project variable.
pub fn shell_variable_name(key: &str) -> String {
    let re = Regex::new(r"[^A-Za-z0-9]+").unwrap();
    re.replace_all(key, "_").trim_matches('_').to_uppercase()
}

pub fn parse_env_file(path: &str) -> CliResult<HashMap<String, String>> {
    let expanded = expand_user(path);
    let text = std::fs::read_to_string(&expanded)
        .map_err(|e| CliError::new(format!("Could not read environment file: {}", e)))?;
    let mut result = HashMap::new();
    for (number, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").map(|s| s.trim_start()).unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            return Err(CliError::new(format!("Invalid environment file line {}: expected KEY=VALUE", number + 1)));
        };
        let key = key.trim();
        if key.is_empty() {
            return Err(CliError::new(format!("Invalid environment file line {}: empty key", number + 1)));
        }
        let mut value = value.trim().to_string();
        if value.len() >= 2 {
            let first = value.chars().next().unwrap();
            let last = value.chars().last().unwrap();
            if first == last && (first == '"' || first == '\'') {
                value = value[1..value.len() - 1].to_string();
            }
        }
        result.insert(key.to_string(), value);
    }
    Ok(result)
}

fn expand_user(raw: &str) -> std::path::PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return Path::new(&home).join(rest);
        }
    }
    std::path::PathBuf::from(raw)
}

pub fn parse_env_vars(values: &[String]) -> CliResult<HashMap<String, String>> {
    let mut result = HashMap::new();
    for raw in values {
        let Some((key, value)) = raw.split_once('=') else {
            return Err(CliError::new(format!("Invalid --env-var value: {:?}; expected KEY=VALUE", raw)));
        };
        if key.trim().is_empty() {
            return Err(CliError::new("--env-var key cannot be empty"));
        }
        result.insert(key.trim().to_string(), value.to_string());
    }
    Ok(result)
}

/// Lowest to highest: saved environment, `--env-file`, `BEACON_VAR_*`, `--env-var`.
pub fn resolve_variables(
    environment: Option<&Value>,
    env_file_values: &HashMap<String, String>,
    cli_values: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut variables: HashMap<String, String> = environment
        .and_then(|e| e.get("variables"))
        .and_then(|v| v.as_object())
        .map(|m| {
            m.iter()
                .map(|(k, v)| (k.clone(), match v { Value::String(s) => s.clone(), other => value_to_string(other) }))
                .collect()
        })
        .unwrap_or_default();

    for (k, v) in env_file_values {
        variables.insert(k.clone(), v.clone());
    }

    let keys: Vec<String> = variables.keys().cloned().collect();
    for key in keys {
        let env_name = format!("BEACON_VAR_{}", shell_variable_name(&key));
        if let Ok(value) = std::env::var(&env_name) {
            variables.insert(key, value);
        }
    }

    for (k, v) in cli_values {
        variables.insert(k.clone(), v.clone());
    }

    variables
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Secret-shaped variable names that are still empty after full resolution.
/// Mirrors `missing_private_values`: the probe replaces the environment's
/// `variables` with the already-resolved map, so this scans resolved keys
/// (not just the ones originally declared in the environment YAML).
pub fn missing_private_values(environment: Option<&Value>, variables: &HashMap<String, String>) -> HashSet<String> {
    if environment.is_none() {
        return HashSet::new();
    }
    variables
        .iter()
        .filter(|(key, _)| is_secret_name(key))
        .filter(|(_, value)| value.trim().is_empty())
        .map(|(key, _)| key.clone())
        .collect()
}
