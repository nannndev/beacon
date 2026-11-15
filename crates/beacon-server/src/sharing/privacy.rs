//! Secret redaction, snapshot localisation and three-way merge for shared project source.
//! Port of the Python `sharing/privacy.py` plus the merge helpers from `sharing/service.py`.
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use uuid::Uuid;

pub fn is_likely_secret(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    let compact = k.replace(['_', '-'], "");
    ["token", "secret", "password", "authorization", "cookie"].iter().any(|n| k.contains(n))
        || compact.contains("apikey")
        || compact.contains("privatekey")
}

fn variable_entry(key: &str, raw: &Value) -> Value {
    if let Some(scope) = raw.get("scope").and_then(Value::as_str).filter(|s| *s == "shared" || *s == "private") {
        let value = if scope == "shared" { raw.get("value").cloned().unwrap_or(Value::Null) } else { Value::Null };
        return json!({ "key": key, "scope": scope, "value": value });
    }
    let scope = if is_likely_secret(key) { "private" } else { "shared" };
    let value = if scope == "shared" { raw.clone() } else { Value::Null };
    json!({ "key": key, "scope": scope, "value": value })
}

/// Shareable project source without device-local secret values.
pub fn sanitize_project_source(project: &Value) -> Value {
    let mut source = project.clone();
    let Some(obj) = source.as_object_mut() else { return source };
    // Device-local collaboration/session metadata and notification credentials
    // are never part of the shared project source.
    obj.remove("shared_origin");
    obj.remove("notifications");
    if let Some(envs) = obj.get_mut("environments").and_then(Value::as_array_mut) {
        for env in envs {
            let Some(eo) = env.as_object_mut() else { continue };
            let replaced = match eo.get("variables") {
                Some(Value::Object(vars)) => Some(vars.iter().map(|(k, v)| (k.clone(), variable_entry(k, v))).collect::<Map<_, _>>()),
                Some(Value::Array(list)) => Some(
                    list.iter()
                        .filter_map(|item| {
                            let key = item.get("key").and_then(Value::as_str).filter(|k| !k.is_empty())?;
                            Some((key.to_string(), variable_entry(key, item)))
                        })
                        .collect(),
                ),
                _ => None,
            };
            if let Some(vars) = replaced {
                eo.insert("variables".into(), Value::Object(vars));
            }
        }
    }
    source
}

/// Turn a shared snapshot back into a local project, keeping this device's private variable values.
pub fn localize_snapshot(source: &Value, existing: Option<&Value>) -> Value {
    let mut project = source.clone();
    let existing_envs: HashMap<String, &Value> = existing
        .and_then(|e| e.get("environments"))
        .and_then(Value::as_array)
        .map(|envs| envs.iter().filter_map(|e| Some((e.get("id")?.as_str()?.to_string(), e))).collect())
        .unwrap_or_default();
    if let Some(envs) = project.get_mut("environments").and_then(Value::as_array_mut) {
        for env in envs {
            let id = env.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let existing_vars = existing_envs
                .get(&id)
                .and_then(|e| e.get("variables"))
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let mut localized = Map::new();
            if let Some(vars) = env.get("variables").and_then(Value::as_object) {
                for (key, entry) in vars {
                    let value = if entry.is_object() {
                        if entry.get("scope").and_then(Value::as_str) == Some("shared") {
                            entry.get("value").cloned().unwrap_or(Value::Null)
                        } else {
                            existing_vars.get(key).cloned().unwrap_or_else(|| json!(""))
                        }
                    } else {
                        entry.clone()
                    };
                    localized.insert(key.clone(), value);
                }
            }
            env["variables"] = Value::Object(localized);
        }
    }
    if project.get("id").and_then(Value::as_str).map(str::is_empty).unwrap_or(true) {
        project["id"] = json!(Uuid::new_v4().to_string());
    }
    project
}

fn all_have_ids(lists: [&Vec<Value>; 3]) -> bool {
    lists.iter().all(|l| l.iter().all(|i| i.get("id").and_then(Value::as_str).map(|s| !s.is_empty()).unwrap_or(false)))
}

fn by_id(list: &[Value]) -> HashMap<String, &Value> {
    list.iter().filter_map(|i| Some((i.get("id")?.as_str()?.to_string(), i))).collect()
}

/// Three-way merge of JSON-like project source. `None` means "missing".
/// Returns the merged value and the list of conflicting leaf fields.
pub fn three_way_merge(base: Option<&Value>, team: Option<&Value>, mine: Option<&Value>, path: &[Value]) -> (Option<Value>, Vec<Value>) {
    if mine == team {
        return (mine.cloned(), vec![]);
    }
    if mine == base {
        return (team.cloned(), vec![]);
    }
    if team == base {
        return (mine.cloned(), vec![]);
    }
    if let (Some(Value::Object(b)), Some(Value::Object(t)), Some(Value::Object(m))) = (base, team, mine) {
        let mut keys: Vec<&String> = Vec::new();
        for k in b.keys().chain(t.keys()).chain(m.keys()) {
            if !keys.contains(&k) {
                keys.push(k);
            }
        }
        let mut merged = Map::new();
        let mut conflicts = Vec::new();
        for k in keys {
            let mut p = path.to_vec();
            p.push(json!(k));
            let (value, nested) = three_way_merge(b.get(k), t.get(k), m.get(k), &p);
            if let Some(v) = value {
                merged.insert(k.clone(), v);
            }
            conflicts.extend(nested);
        }
        return (Some(Value::Object(merged)), conflicts);
    }
    // Entity arrays are merged by stable ids so edits to different endpoints
    // do not conflict merely because they share the same collection array.
    if let (Some(Value::Array(b)), Some(Value::Array(t)), Some(Value::Array(m))) = (base, team, mine) {
        if all_have_ids([b, t, m]) {
            let (bm, tm, mm) = (by_id(b), by_id(t), by_id(m));
            let mut order: Vec<String> = Vec::new();
            for item in t.iter().chain(m.iter()) {
                let id = item["id"].as_str().unwrap_or("").to_string();
                if !order.contains(&id) {
                    order.push(id);
                }
            }
            let mut merged = Vec::new();
            let mut conflicts = Vec::new();
            for id in order {
                let mut p = path.to_vec();
                p.push(json!(id));
                let (value, nested) = three_way_merge(bm.get(&id).copied(), tm.get(&id).copied(), mm.get(&id).copied(), &p);
                if let Some(v) = value {
                    merged.push(v);
                }
                conflicts.extend(nested);
            }
            return (Some(Value::Array(merged)), conflicts);
        }
    }
    let label = path.iter().map(|p| match p { Value::String(s) => s.clone(), other => other.to_string() }).collect::<Vec<_>>().join(".");
    let conflict = json!({
        "path": path, "label": label,
        "base_value": base.cloned().unwrap_or(Value::Null),
        "team_value": team.cloned().unwrap_or(Value::Null),
        "local_value": mine.cloned().unwrap_or(Value::Null),
    });
    // Keep the local value in the draft; explicit field choices can replace it.
    (mine.cloned(), vec![conflict])
}

/// Set (or remove, when `value` is null) a merge-conflict path inside `source`.
pub fn set_path(source: &mut Value, path: &[Value], value: Value) -> Result<(), String> {
    let Some((last, parents)) = path.split_last() else { return Err("Empty conflict path".into()) };
    let mut current = source;
    for part in parents {
        let key = part.as_str().map(str::to_string).unwrap_or_else(|| part.to_string());
        current = match current {
            Value::Array(items) => items.iter_mut().find(|i| i.get("id").and_then(Value::as_str) == Some(key.as_str())),
            Value::Object(obj) => obj.get_mut(&key),
            _ => None,
        }
        .ok_or_else(|| format!("Conflict path {key} no longer exists"))?;
    }
    let key = last.as_str().map(str::to_string).unwrap_or_else(|| last.to_string());
    match current {
        Value::Array(items) => {
            let idx = items.iter().position(|i| i.get("id").and_then(Value::as_str) == Some(key.as_str())).ok_or_else(|| format!("Conflict path {key} no longer exists"))?;
            items[idx] = value;
        }
        Value::Object(obj) => {
            if value.is_null() {
                obj.remove(&key);
            } else {
                obj.insert(key, value);
            }
        }
        _ => return Err("Conflict path is not a container".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_secret_variables_and_local_metadata() {
        let project = json!({
            "id": "p1", "name": "Demo", "shared_origin": {"session_token": "x"}, "notifications": {"discord": "hook"},
            "environments": [{"id": "e", "variables": {"api_key": "secret", "base": "https://x"}}]
        });
        let s = sanitize_project_source(&project);
        assert!(s.get("shared_origin").is_none() && s.get("notifications").is_none());
        let vars = &s["environments"][0]["variables"];
        assert_eq!(vars["api_key"], json!({"key": "api_key", "scope": "private", "value": null}));
        assert_eq!(vars["base"], json!({"key": "base", "scope": "shared", "value": "https://x"}));
        let local = localize_snapshot(&s, Some(&project));
        assert_eq!(local["environments"][0]["variables"], json!({"api_key": "secret", "base": "https://x"}));
        let fresh = localize_snapshot(&s, None);
        assert_eq!(fresh["environments"][0]["variables"]["api_key"], json!(""));
    }

    #[test]
    fn merges_non_overlapping_and_reports_conflicts() {
        let base = json!({"name": "A", "items": [{"id": "1", "name": "x"}, {"id": "2", "name": "y"}]});
        let team = json!({"name": "A", "items": [{"id": "1", "name": "team"}, {"id": "2", "name": "y"}]});
        let mine = json!({"name": "B", "items": [{"id": "1", "name": "x"}, {"id": "2", "name": "mine"}]});
        let (merged, conflicts) = three_way_merge(Some(&base), Some(&team), Some(&mine), &[]);
        assert!(conflicts.is_empty());
        assert_eq!(merged.unwrap(), json!({"name": "B", "items": [{"id": "1", "name": "team"}, {"id": "2", "name": "mine"}]}));
        let mine2 = json!({"name": "C", "items": []});
        let team2 = json!({"name": "D", "items": []});
        let (_, conflicts) = three_way_merge(Some(&base), Some(&team2), Some(&mine2), &[]);
        assert_eq!(conflicts[0]["label"], "name");
        let mut src = base.clone();
        set_path(&mut src, &[json!("items"), json!("2"), json!("name")], json!("z")).unwrap();
        assert_eq!(src["items"][1]["name"], "z");
    }
}
