//! Readable Beacon project-folder loader.
//!
//! Reads the same on-disk format Desktop writes via
//! `services/project_file_sync.py` (`ProjectFileSyncService.write`/`reload`):
//! a `beacon.yaml` manifest referencing environment YAML files and endpoint
//! YAML files, plus an optional `.beacon/environments.local.yaml` overlay of
//! private variable values that are deliberately kept out of the manifest
//! (and out of Git).
//!
//! The in-memory project is a plain `serde_json::Value` tree shaped exactly
//! like the Python dict the old CLI operated on: `{id, name, environments,
//! current_environment_id, items}`, with `items` a tree of `folder`/`request`
//! nodes. Keeping it as `Value` (rather than typed structs) mirrors
//! `cli_runner.py`'s approach and keeps validate/list/run logic generic over
//! whatever extra fields an endpoint or environment YAML happens to carry.

use crate::error::{CliError, CliResult};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

pub const MANIFEST: &str = "beacon.yaml";
pub const LOCAL_ENVIRONMENTS: &str = ".beacon/environments.local.yaml";
const FORMAT: &str = "beacon.project";
const SCHEMA_VERSION: i64 = 1;

/// Resolve `PROJECT` (a folder or a `beacon.yaml` path, defaulting to `.`)
/// and load it. Mirrors `cli_runner.load_project`.
pub fn load_project(project_path: &str) -> CliResult<(Value, PathBuf)> {
    let expanded = expand_user(project_path);
    let mut root = std::fs::canonicalize(&expanded).unwrap_or(expanded);
    if root.is_file() && root.file_name().map(|n| n == MANIFEST).unwrap_or(false) {
        root = root
            .parent()
            .ok_or_else(|| CliError::new(format!("Beacon project not found at {}", root.display())))?
            .to_path_buf();
    }
    if !root.is_dir() || !root.join(MANIFEST).is_file() {
        return Err(CliError::new(format!("Beacon project not found at {}", root.display())));
    }
    let project = open_existing(&root)?;
    Ok((project, root))
}

fn expand_user(raw: &str) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return Path::new(&home).join(rest);
        }
    } else if raw == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home);
        }
    }
    PathBuf::from(raw)
}

fn load_yaml(path: &Path) -> CliResult<Value> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| CliError::new(format!("Could not read {}: {}", display_name(path), e)))?;
    let value: Value = serde_yaml::from_str(&text)
        .map_err(|e| CliError::new(format!("Could not read {}: {}", display_name(path), e)))?;
    if !value.is_object() {
        return Err(CliError::new(format!(
            "Project resource must contain a YAML mapping: {}",
            display_name(path)
        )));
    }
    Ok(value)
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string())
}

/// A relative POSIX path from manifest/YAML content, resolved under `root`
/// and checked against directory traversal. Mirrors `_safe_relative_path`.
fn safe_relative_path(root: &Path, raw: &str) -> CliResult<PathBuf> {
    let posix = raw.replace('\\', "/");
    let parts: Vec<&str> = posix.split('/').filter(|p| !p.is_empty()).collect();
    if posix.starts_with('/') || parts.iter().any(|p| *p == "..") || parts.is_empty() {
        return Err(CliError::new(format!("Invalid project resource path: {}", raw)));
    }
    let mut target = root.to_path_buf();
    for part in &parts {
        target.push(part);
    }
    Ok(target)
}

fn string_value(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Load an existing project folder into the in-memory project tree. Mirrors
/// `ProjectFileSyncService.open_existing` + `.reload`.
pub fn open_existing(root: &Path) -> CliResult<Value> {
    let manifest = load_yaml(&root.join(MANIFEST))?;
    if manifest.get("format").and_then(|v| v.as_str()) != Some(FORMAT) {
        return Err(CliError::new("The selected folder does not contain a Beacon project"));
    }
    if manifest.get("version").and_then(|v| v.as_i64()) != Some(SCHEMA_VERSION) {
        return Err(CliError::new(format!(
            "Unsupported Beacon project version: {:?}",
            manifest.get("version")
        )));
    }
    let source = manifest
        .get("project")
        .filter(|v| v.is_object())
        .ok_or_else(|| CliError::new("beacon.yaml is missing project metadata"))?;
    let project_id = source
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| CliError::new("beacon.yaml is missing a stable project ID"))?
        .to_string();

    let mut referenced: std::collections::HashSet<String> = std::collections::HashSet::new();
    referenced.insert(MANIFEST.to_string());

    let environment_paths: Vec<String> = source
        .get("environments")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().map(string_value).collect())
        .unwrap_or_default();

    let mut environments = Vec::new();
    for relative in &environment_paths {
        let path = safe_relative_path(root, relative)?;
        let env = load_yaml(&path)?;
        if !env.get("variables").map(|v| v.is_object()).unwrap_or(true) {
            return Err(CliError::new(format!("Environment variables must be a mapping: {}", relative)));
        }
        referenced.insert(relative.clone());
        environments.push(env);
    }

    // Private overlay: values kept out of the manifest and out of Git.
    let local_path = root.join(LOCAL_ENVIRONMENTS);
    let mut local_overlay: Map<String, Value> = Map::new();
    if local_path.is_file() {
        let doc = load_yaml(&local_path)?;
        if let Some(envs) = doc.get("environments") {
            if !envs.is_object() {
                return Err(CliError::new("Local environment overlay is invalid"));
            }
            local_overlay = envs.as_object().cloned().unwrap_or_default();
        }
    }

    for env in &mut environments {
        let env_id = env.get("id").map(string_value).unwrap_or_default();
        let mut variables: Map<String, Value> = env
            .get("variables")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        if let Some(overlay) = local_overlay.get(&env_id).and_then(|v| v.as_object()) {
            for (k, v) in overlay {
                variables.insert(k.clone(), v.clone());
            }
        }
        for (_, v) in variables.iter_mut() {
            if v.is_null() {
                *v = Value::String(String::new());
            }
        }
        env.as_object_mut().unwrap().insert("variables".into(), Value::Object(variables));
    }

    fn load_items(root: &Path, nodes: &[Value], referenced: &mut std::collections::HashSet<String>) -> CliResult<Vec<Value>> {
        let mut result = Vec::new();
        for node in nodes {
            let obj = node
                .as_object()
                .ok_or_else(|| CliError::new("Project item must be a mapping"))?;
            let node_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if node_type == "folder" {
                let mut folder = Map::new();
                folder.insert("type".into(), Value::String("folder".into()));
                folder.insert("id".into(), Value::String(obj.get("id").map(string_value).unwrap_or_default()));
                folder.insert(
                    "name".into(),
                    Value::String(obj.get("name").map(string_value).unwrap_or_else(|| "Folder".into())),
                );
                let children = obj.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                folder.insert("items".into(), Value::Array(load_items(root, &children, referenced)?));
                if let Some(auth) = obj.get("auth") {
                    if !auth.is_null() {
                        folder.insert("auth".into(), auth.clone());
                    }
                }
                result.push(Value::Object(folder));
                continue;
            }
            let file = obj
                .get("file")
                .and_then(|v| v.as_str())
                .filter(|s| node_type == "request" && !s.is_empty())
                .ok_or_else(|| CliError::new("Request item is missing its endpoint file"))?;
            let relative = file.to_string();
            let path = safe_relative_path(root, &relative)?;
            let endpoint = load_yaml(&path)?;
            let endpoint_id = endpoint.get("id").map(string_value).unwrap_or_default();
            let node_id = obj.get("id").map(string_value).unwrap_or_default();
            if endpoint_id != node_id {
                return Err(CliError::new(format!("Endpoint ID does not match its manifest entry: {}", relative)));
            }
            referenced.insert(relative.clone());
            let mut merged = endpoint.as_object().cloned().unwrap_or_default();
            merged.insert("type".into(), Value::String("request".into()));
            result.push(Value::Object(merged));
        }
        Ok(result)
    }

    let source_items = source.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let items = load_items(root, &source_items, &mut referenced)?;

    let public_files = snapshot_yaml_paths(root);
    let mut unreferenced: Vec<&String> = public_files.iter().filter(|p| !referenced.contains(*p)).collect();
    unreferenced.sort();
    if let Some(first) = unreferenced.first() {
        return Err(CliError::new(format!("Unreferenced managed project file: {}", first)));
    }

    let mut project = Map::new();
    project.insert("id".into(), Value::String(project_id));
    project.insert(
        "name".into(),
        Value::String(source.get("name").map(string_value).unwrap_or_else(|| "Linked Project".into())),
    );
    project.insert("environments".into(), Value::Array(environments));
    project.insert(
        "current_environment_id".into(),
        source.get("current_environment_id").cloned().unwrap_or(Value::Null),
    );
    project.insert("items".into(), Value::Array(items));
    Ok(Value::Object(project))
}

/// Every managed `*.yaml` file under `endpoints/` and `environments/`, plus
/// the manifest itself, relative to `root` (POSIX separators). Mirrors
/// `ProjectFileSyncService._snapshot`'s file set.
fn snapshot_yaml_paths(root: &Path) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    if root.join(MANIFEST).is_file() {
        out.insert(MANIFEST.to_string());
    }
    for dir in ["endpoints", "environments"] {
        let base = root.join(dir);
        if base.is_dir() {
            walk_yaml(&base, root, &mut out);
        }
    }
    out
}

fn walk_yaml(dir: &Path, root: &Path, out: &mut std::collections::HashSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_yaml(&path, root, out);
        } else if path.extension().map(|e| e == "yaml").unwrap_or(false) {
            if let Ok(relative) = path.strip_prefix(root) {
                out.insert(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

/// Recursively flatten `items` into leaf requests only (folders dissolved).
/// Mirrors `_flatten_requests`.
pub fn flatten_requests(items: &[Value]) -> Vec<Value> {
    let mut result = Vec::new();
    for item in items {
        let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if item_type == "folder" {
            let children = item.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            result.extend(flatten_requests(&children));
        } else if item_type == "request" {
            result.push(item.clone());
        }
    }
    result
}

/// Yield every folder/request with the names of its parent folders. Mirrors
/// `walk_project_items`.
pub fn walk_project_items(items: &[Value]) -> Vec<(Value, Vec<String>)> {
    fn walk(items: &[Value], parents: &[String], out: &mut Vec<(Value, Vec<String>)>) {
        for item in items {
            out.push((item.clone(), parents.to_vec()));
            if item.get("type").and_then(|v| v.as_str()) == Some("folder") {
                let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("Folder").to_string();
                let mut next = parents.to_vec();
                next.push(name);
                let children = item.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                walk(&children, &next, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(items, &[], &mut out);
    out
}

/// Map each endpoint id to the auth of everything enclosing it (project then
/// each folder, outermost first). Mirrors `auth_chains`.
pub fn auth_chains(project: &Value) -> std::collections::HashMap<String, Vec<Value>> {
    let mut chains = std::collections::HashMap::new();
    let project_auth = project.get("auth").filter(|v| !v.is_null());

    fn walk(
        nodes: &[Value],
        inherited: &[Value],
        chains: &mut std::collections::HashMap<String, Vec<Value>>,
    ) {
        for item in nodes {
            let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if item_type == "folder" {
                let mut next = inherited.to_vec();
                if let Some(auth) = item.get("auth") {
                    if !auth.is_null() {
                        next.push(auth.clone());
                    }
                }
                let children = item.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                walk(&children, &next, chains);
            } else if item_type == "request" {
                let id = item.get("id").map(|v| v.as_str().unwrap_or("").to_string()).unwrap_or_default();
                chains.insert(id, inherited.to_vec());
            }
        }
    }

    let init: Vec<Value> = project_auth.cloned().into_iter().collect();
    let items = project.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    walk(&items, &init, &mut chains);
    chains
}

fn find_unique(items: &[Value], selector: &str, kind: &str) -> CliResult<Value> {
    let selector_lower = selector.to_lowercase();
    let mut matches = Vec::new();

    fn visit(items: &[Value], selector: &str, selector_lower: &str, kind: &str, matches: &mut Vec<Value>) {
        for item in items {
            let item_kind = if item.get("type").and_then(|v| v.as_str()) == Some("folder") {
                "folder"
            } else {
                "endpoint"
            };
            if item_kind == kind {
                let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                if id == selector || name == selector_lower {
                    matches.push(item.clone());
                }
            }
            if item.get("type").and_then(|v| v.as_str()) == Some("folder") {
                let children = item.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                visit(&children, selector, selector_lower, kind, matches);
            }
        }
    }

    visit(items, selector, &selector_lower, kind, &mut matches);
    if matches.is_empty() {
        return Err(CliError::new(format!("{} not found: {}", title_case(kind), selector)));
    }
    if matches.len() > 1 {
        return Err(CliError::new(format!("{} name is ambiguous; use its ID: {}", title_case(kind), selector)));
    }
    Ok(matches.remove(0))
}

fn title_case(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

/// Select the endpoints a run/validate acts on, and a scope label. Mirrors
/// `select_endpoints`.
pub fn select_endpoints(
    project: &Value,
    endpoint_selectors: Option<&[String]>,
    folder_selector: Option<&str>,
) -> CliResult<(Vec<Value>, String)> {
    let items = project.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if endpoint_selectors.map(|s| !s.is_empty()).unwrap_or(false) && folder_selector.is_some() {
        return Err(CliError::new("Choose endpoint scope or folder scope, not both"));
    }
    if let Some(selectors) = endpoint_selectors.filter(|s| !s.is_empty()) {
        let mut endpoints = Vec::new();
        for selector in selectors {
            endpoints.push(find_unique(&items, selector, "endpoint")?);
        }
        return Ok((endpoints, format!("endpoints:{}", selectors.join(","))));
    }
    if let Some(selector) = folder_selector {
        let folder = find_unique(&items, selector, "folder")?;
        let children = folder.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let endpoints = flatten_requests(&children);
        if endpoints.is_empty() {
            return Err(CliError::new(format!("Folder has no endpoints: {}", selector)));
        }
        return Ok((endpoints, format!("folder:{}", selector)));
    }
    let endpoints = flatten_requests(&items);
    if endpoints.is_empty() {
        return Err(CliError::new("Project has no endpoints"));
    }
    Ok((endpoints, "project".to_string()))
}

/// Select one environment by name/id, or the project's active/first one.
/// Mirrors `select_environment`.
pub fn select_environment(project: &Value, selector: Option<&str>) -> CliResult<Option<Value>> {
    let environments = project.get("environments").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let wanted = selector
        .map(|s| s.to_string())
        .or_else(|| project.get("current_environment_id").and_then(|v| v.as_str()).map(|s| s.to_string()));
    if let Some(wanted) = wanted {
        let wanted_lower = wanted.to_lowercase();
        let matches: Vec<&Value> = environments
            .iter()
            .filter(|e| {
                let id = e.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let name = e.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                id == wanted || name == wanted_lower
            })
            .collect();
        if matches.is_empty() {
            return Err(CliError::new(format!("Environment not found: {}", wanted)));
        }
        if matches.len() > 1 {
            return Err(CliError::new(format!("Environment name is ambiguous; use its ID: {}", wanted)));
        }
        return Ok(Some(matches[0].clone()));
    }
    Ok(environments.first().cloned())
}

pub struct EndpointRow {
    pub id: String,
    pub name: String,
    pub method: String,
    pub target_type: String,
    pub folder: String,
    pub url: String,
}

pub struct FolderRow {
    pub id: String,
    pub name: String,
    pub path: String,
    pub endpoints: usize,
}

pub struct EnvironmentRow {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub active: bool,
}

pub enum ResourceRows {
    Endpoints(Vec<EndpointRow>),
    Folders(Vec<FolderRow>),
    Environments(Vec<EnvironmentRow>),
}

/// Mirrors `list_project_resources`.
pub fn list_project_resources(project: &Value, resource: &str) -> CliResult<ResourceRows> {
    if resource == "environments" {
        let environments = project.get("environments").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let active_id = project
            .get("current_environment_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| environments.first().and_then(|e| e.get("id")).and_then(|v| v.as_str()).map(|s| s.to_string()))
            .unwrap_or_default();
        let rows = environments
            .iter()
            .map(|e| {
                let id = e.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                EnvironmentRow {
                    active: id == active_id,
                    id,
                    name: e.get("name").and_then(|v| v.as_str()).unwrap_or("Environment").to_string(),
                    base_url: e.get("base_url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                }
            })
            .collect();
        return Ok(ResourceRows::Environments(rows));
    }

    let items = project.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    match resource {
        "endpoints" => {
            let mut rows = Vec::new();
            for (item, parents) in walk_project_items(&items) {
                if item.get("type").and_then(|v| v.as_str()) == Some("request") {
                    rows.push(EndpointRow {
                        id: item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        name: item.get("name").and_then(|v| v.as_str()).unwrap_or("Endpoint").to_string(),
                        method: item.get("method").and_then(|v| v.as_str()).unwrap_or("GET").to_uppercase(),
                        target_type: item.get("target_type").and_then(|v| v.as_str()).unwrap_or("api").to_string(),
                        folder: parents.join(" / "),
                        url: item.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    });
                }
            }
            Ok(ResourceRows::Endpoints(rows))
        }
        "folders" => {
            let mut rows = Vec::new();
            for (item, parents) in walk_project_items(&items) {
                if item.get("type").and_then(|v| v.as_str()) == Some("folder") {
                    let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("Folder").to_string();
                    let mut path_parts = parents.clone();
                    path_parts.push(name.clone());
                    let children = item.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                    rows.push(FolderRow {
                        id: item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        name,
                        path: path_parts.join(" / "),
                        endpoints: flatten_requests(&children).len(),
                    });
                }
            }
            Ok(ResourceRows::Folders(rows))
        }
        other => Err(CliError::new(format!("Unsupported list resource: {}", other))),
    }
}
