//! Test data for `--data`: CSV or JSON rows exposed as `{{column}}`
//! variables for one pass over the selected endpoints. Mirrors
//! `core/datasets.py`'s `parse_dataset` (format auto-detection, row limits)
//! without pulling in a CSV crate — the format is simple enough (comma-
//! separated, optional quoting) to hand-roll per ponytail: no new dependency
//! for a few dozen lines.

use crate::error::{CliError, CliResult};
use std::collections::BTreeMap;
use std::path::Path;

pub type Row = BTreeMap<String, String>;

const MAX_ROWS: usize = 100_000;

pub fn load_data_file(path: &str) -> CliResult<Vec<Row>> {
    let expanded = expand_user(path);
    let text = std::fs::read_to_string(&expanded)
        .map_err(|e| CliError::new(format!("Could not read test data {}: {}", path, e)))?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let is_json = expanded
        .extension()
        .map(|e| e.eq_ignore_ascii_case("json"))
        .unwrap_or(false);
    let rows = if is_json || text.trim_start().starts_with(['[', '{']) {
        parse_json(text).map_err(|e| CliError::new(format!("Test data {}: {}", path, e)))?
    } else {
        parse_csv(text).map_err(|e| CliError::new(format!("Test data {}: {}", path, e)))?
    };
    if rows.is_empty() {
        return Err(CliError::new(format!("Test data {}: Test data has no rows", path)));
    }
    if rows.len() > MAX_ROWS {
        return Err(CliError::new(format!("Test data {}: Test data has more than {} rows", path, MAX_ROWS)));
    }
    Ok(rows)
}

fn expand_user(raw: &str) -> std::path::PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return Path::new(&home).join(rest);
        }
    }
    std::path::PathBuf::from(raw)
}

fn parse_json(text: &str) -> Result<Vec<Row>, String> {
    let data: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("Invalid JSON: {}", e))?;
    let array = if let Some(rows) = data.get("rows").and_then(|v| v.as_array()) {
        rows.clone()
    } else if let Some(arr) = data.as_array() {
        arr.clone()
    } else {
        return Err("JSON test data must be an array of objects".to_string());
    };
    let mut rows = Vec::new();
    for (index, item) in array.iter().enumerate() {
        let obj = item.as_object().ok_or_else(|| format!("JSON row {} is not an object", index + 1))?;
        let mut row = Row::new();
        for (key, value) in obj {
            let key = key.trim();
            if key.is_empty() {
                continue;
            }
            row.insert(key.to_string(), cell_value(value));
        }
        rows.push(row);
    }
    Ok(rows)
}

fn cell_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(b) => if *b { "true".into() } else { "false".into() },
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Object(_) | serde_json::Value::Array(_) => value.to_string(),
        other => other.to_string(),
    }
}

/// Minimal CSV: comma-delimited, `"..."` quoting with `""` as an escaped
/// quote, `\r\n` or `\n` line endings. No sniffing of alternate delimiters
/// (Python's Sniffer tries `,;\t|`); comma is the documented format.
fn parse_csv(text: &str) -> Result<Vec<Row>, String> {
    let lines = split_csv_records(text);
    let mut iter = lines.into_iter();
    let Some(header) = iter.next() else { return Ok(Vec::new()) };
    let columns: Vec<String> = header.iter().map(|c| c.trim().to_string()).collect();
    if columns.iter().all(|c| c.is_empty()) {
        return Err("The CSV header row is empty".to_string());
    }
    let mut seen = std::collections::HashSet::new();
    for c in &columns {
        if !c.is_empty() && !seen.insert(c.clone()) {
            return Err("The CSV header has duplicate column names".to_string());
        }
    }
    let mut rows = Vec::new();
    for fields in iter {
        if fields.iter().all(|f| f.trim().is_empty()) {
            continue;
        }
        let mut row = Row::new();
        for (i, column) in columns.iter().enumerate() {
            if column.is_empty() {
                continue;
            }
            row.insert(column.clone(), fields.get(i).cloned().unwrap_or_default());
        }
        rows.push(row);
        if rows.len() > MAX_ROWS {
            break;
        }
    }
    Ok(rows)
}

/// Split CSV text into records of fields, honoring quoted fields that may
/// contain commas or embedded newlines.
fn split_csv_records(text: &str) -> Vec<Vec<String>> {
    let mut records = Vec::new();
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    let mut any_content_this_record = false;

    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' => {
                in_quotes = true;
                any_content_this_record = true;
            }
            ',' => {
                fields.push(std::mem::take(&mut field));
                any_content_this_record = true;
            }
            '\r' => {}
            '\n' => {
                fields.push(std::mem::take(&mut field));
                records.push(std::mem::take(&mut fields));
                any_content_this_record = false;
            }
            other => {
                field.push(other);
                any_content_this_record = true;
            }
        }
    }
    if any_content_this_record || !field.is_empty() || !fields.is_empty() {
        fields.push(field);
        records.push(fields);
    }
    records
}
