//! Readable, Git-friendly folder persistence for one Beacon project
//! (port of the Python `project_file_sync.py` + repository inspector).
use crate::store::{Environment, Project};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

pub const MANIFEST: &str = "beacon.yaml";
const FORMAT: &str = "beacon.project";
const SCHEMA_VERSION: i64 = 1;
const LOCAL_DIR: &str = ".beacon/";
const LOCAL_ENVIRONMENTS: &str = ".beacon/environments.local.yaml";
const SECRET_MARKERS: [&str; 12] = [
    "token", "secret", "password", "authorization", "cookie", "credential",
    "apikey", "api_key", "api-key", "privatekey", "private_key", "private-key",
];

type Snapshot = BTreeMap<String, String>;
type R<T> = Result<T, String>;

fn sha(data: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(data)))
}

fn is_secret(key: &str) -> bool {
    let key = key.to_lowercase();
    SECRET_MARKERS.iter().any(|m| key.contains(m))
}

fn vstr(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn slug(value: &str) -> String {
    let mut out = String::new();
    for c in value.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    (if trimmed.is_empty() { "resource" } else { trimmed }).chars().take(48).collect()
}

fn resource_file(directory: &str, name: &str, id: &str) -> String {
    let mut suffix: String = id.chars().filter(|c| c.is_ascii_hexdigit()).take(8).collect();
    if suffix.is_empty() {
        // Python used sha1 here; only matters for IDs without any hex digit.
        suffix = hex::encode(Sha256::digest(if id.is_empty() { name } else { id }))[..8].to_string();
    }
    format!("{directory}/{}--{suffix}.yaml", slug(name))
}

fn yaml_bytes(value: &Value) -> Vec<u8> {
    serde_yaml::to_string(value).unwrap_or_default().into_bytes()
}

fn load_yaml(path: &Path) -> R<Map<String, Value>> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let text = fs::read_to_string(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => format!("Project resource not found: {name}"),
        _ => format!("Could not read {name}: {e}"),
    })?;
    match serde_yaml::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err(format!("Project resource must contain a YAML mapping: {name}")),
        Err(e) => Err(format!("Could not read {name}: {e}")),
    }
}

/// Resolve a manifest-relative path, refusing anything that escapes `root`.
fn safe_relative(root: &Path, raw: &str) -> R<PathBuf> {
    let rel = Path::new(raw);
    if raw.is_empty() || rel.is_absolute() || rel.components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err(format!("Invalid project resource path: {raw}"));
    }
    let target = root.join(rel);
    let real_root = root.canonicalize().map_err(|e| e.to_string())?;
    // The nearest existing ancestor must stay inside the folder (symlink escape).
    if let Some(existing) = target.ancestors().find(|p| p.exists()) {
        let real = existing.canonicalize().map_err(|e| e.to_string())?;
        if !real.starts_with(&real_root) {
            return Err(format!("Project resource escapes the linked folder: {raw}"));
        }
    }
    Ok(target)
}

fn collect_yaml(root: &Path, dir: &Path, out: &mut Snapshot) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            collect_yaml(root, &path, out);
        } else if kind.is_file() && path.extension().is_some_and(|e| e == "yaml") {
            let rel: Vec<String> = path.strip_prefix(root).unwrap_or(&path).components()
                .map(|c| c.as_os_str().to_string_lossy().to_string()).collect();
            if let Ok(bytes) = fs::read(&path) {
                out.insert(rel.join("/"), sha(&bytes));
            }
        }
    }
}

fn snapshot(root: &Path) -> Snapshot {
    let mut out = Snapshot::new();
    if let Ok(bytes) = fs::read(root.join(MANIFEST)) {
        out.insert(MANIFEST.into(), sha(&bytes));
    }
    for dir in ["endpoints", "environments"] {
        collect_yaml(root, &root.join(dir), &mut out);
    }
    out
}

fn snapshot_hash(s: &Snapshot) -> String {
    let body: Vec<String> = s.iter().map(|(p, d)| format!("{p}\0{d}")).collect();
    sha(body.join("\n").as_bytes())
}

fn changes(previous: &Snapshot, current: &Snapshot) -> Vec<Value> {
    let paths: BTreeSet<&String> = previous.keys().chain(current.keys()).collect();
    paths.into_iter().filter_map(|path| {
        let kind = match (previous.get(path), current.get(path)) {
            (None, _) => "added",
            (_, None) => "deleted",
            (Some(a), Some(b)) if a != b => "modified",
            _ => return None,
        };
        Some(json!({ "path": path, "kind": kind }))
    }).collect()
}

fn metadata(project: &Project) -> Map<String, Value> {
    project.file_sync.as_ref().and_then(|v| v.as_object()).cloned().unwrap_or_default()
}

fn linked_path(project: &Project) -> Option<String> {
    metadata(project).get("path").and_then(|p| p.as_str()).filter(|p| !p.is_empty()).map(String::from)
}

fn hashes(meta: &Map<String, Value>) -> Snapshot {
    meta.get("file_hashes").and_then(|h| h.as_object())
        .map(|m| m.iter().map(|(k, v)| (k.clone(), vstr(Some(v)))).collect())
        .unwrap_or_default()
}

fn fresh_metadata(path: &Path) -> Value {
    json!({
        "path": path.to_string_lossy(), "schema_version": SCHEMA_VERSION, "last_synced_hash": null,
        "file_hashes": {}, "last_synced_at": null, "last_error": null, "local_dirty": false,
    })
}

fn mark_synced(meta: &mut Map<String, Value>, snap: &Snapshot) {
    meta.insert("schema_version".into(), json!(SCHEMA_VERSION));
    meta.insert("last_synced_hash".into(), json!(snapshot_hash(snap)));
    meta.insert("file_hashes".into(), json!(snap));
    meta.insert("last_synced_at".into(), json!(chrono::Utc::now().to_rfc3339()));
    meta.insert("last_error".into(), Value::Null);
    meta.insert("local_dirty".into(), json!(false));
}

fn absolute_dir(raw: &str, message: &str) -> R<PathBuf> {
    let root = PathBuf::from(raw);
    if raw.trim().is_empty() || !root.is_absolute() || !root.is_dir() {
        return Err(message.into());
    }
    root.canonicalize().map_err(|e| format!("{message}: {e}"))
}

fn check_manifest(manifest: &Map<String, Value>, not_beacon: &str) -> R<Map<String, Value>> {
    if manifest.get("format").and_then(|f| f.as_str()) != Some(FORMAT) {
        return Err(not_beacon.into());
    }
    if manifest.get("version").and_then(|v| v.as_i64()) != Some(SCHEMA_VERSION) {
        return Err(format!("Unsupported Beacon project version: {}", vstr(manifest.get("version"))));
    }
    manifest.get("project").and_then(|p| p.as_object()).cloned()
        .ok_or_else(|| "beacon.yaml is missing project metadata".into())
}

pub fn status(project: &Project) -> Value {
    let meta = metadata(project);
    let Some(path) = linked_path(project) else {
        return json!({
            "linked": false, "path": null, "state": "unlinked", "last_synced_at": null, "changes": [],
            "message": "Project files are stored only in this Beacon workspace",
        });
    };
    let root = PathBuf::from(&path);
    let mut out = json!({
        "linked": true, "path": path,
        "last_synced_at": meta.get("last_synced_at").cloned().unwrap_or(Value::Null),
        "local_dirty": meta.get("local_dirty").and_then(|v| v.as_bool()).unwrap_or(false),
        "last_error": meta.get("last_error").cloned().unwrap_or(Value::Null),
        "state": "clean", "changes": [], "message": "Project files are up to date",
    });
    if !root.is_dir() || !root.join(MANIFEST).is_file() {
        out["state"] = json!("missing_folder");
        out["message"] = json!("The linked folder or beacon.yaml could not be found");
        return out;
    }
    let changed = changes(&hashes(&meta), &snapshot(&root));
    if !changed.is_empty() {
        let n = changed.len();
        if out["local_dirty"] == json!(true) {
            out["state"] = json!("conflict");
            out["message"] = json!("Beacon and the linked folder both changed; choose which source to keep");
        } else {
            out["state"] = json!("external_changes");
            out["message"] = json!(format!("{n} project file{} changed outside Beacon", if n == 1 { "" } else { "s" }));
        }
        out["changes"] = json!(changed);
    }
    out
}

fn serialize(project: &Project) -> R<(BTreeMap<String, Vec<u8>>, Map<String, Value>)> {
    let mut files = BTreeMap::new();
    let mut local_values = Map::new();
    let mut env_paths = Vec::new();
    for env in &project.environments {
        if env.id.is_empty() {
            return Err("Every environment must have a stable ID".into());
        }
        let name = if env.name.is_empty() { "Environment" } else { &env.name };
        let rel = resource_file("environments", name, &env.id);
        let (mut public, mut private) = (Map::new(), Map::new());
        for (key, value) in env.variables.iter().collect::<BTreeMap<_, _>>() {
            if is_secret(key) {
                public.insert(key.clone(), Value::Null);
                private.insert(key.clone(), value.clone());
            } else {
                public.insert(key.clone(), value.clone());
            }
        }
        files.insert(rel.clone(), yaml_bytes(&json!({
            "id": env.id, "name": name, "base_url": env.base_url, "variables": public,
        })));
        if !private.is_empty() {
            local_values.insert(env.id.clone(), Value::Object(private));
        }
        env_paths.push(rel);
    }

    fn items(nodes: &[Value], files: &mut BTreeMap<String, Vec<u8>>) -> R<Vec<Value>> {
        let mut out = Vec::new();
        for node in nodes {
            let Some(obj) = node.as_object() else { continue };
            if obj.get("type").and_then(|t| t.as_str()) == Some("folder") {
                let children = obj.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
                let mut folder = json!({
                    "type": "folder", "id": vstr(obj.get("id")),
                    "name": obj.get("name").and_then(|n| n.as_str()).filter(|n| !n.is_empty()).unwrap_or("Folder"),
                    "items": items(&children, files)?,
                });
                if let Some(auth) = obj.get("auth").filter(|a| !a.is_null()) {
                    folder["auth"] = auth.clone();
                }
                out.push(folder);
                continue;
            }
            let mut endpoint = obj.clone();
            endpoint.remove("type");
            endpoint.remove("file");
            let id = vstr(endpoint.get("id"));
            if id.is_empty() {
                return Err("Every endpoint must have a stable ID".into());
            }
            let name = endpoint.get("name").and_then(|n| n.as_str()).filter(|n| !n.is_empty()).unwrap_or("Request");
            let rel = resource_file("endpoints", name, &id);
            files.insert(rel.clone(), yaml_bytes(&Value::Object(endpoint)));
            out.push(json!({ "type": "request", "id": id, "file": rel }));
        }
        Ok(out)
    }
    let source: Vec<Value> = project.items.clone().unwrap_or_else(|| {
        project.tests.clone().unwrap_or_default().into_iter().map(|mut t| { t["type"] = json!("request"); t }).collect()
    });
    let manifest = json!({
        "format": FORMAT, "version": SCHEMA_VERSION,
        "project": {
            "id": project.id, "name": if project.name.is_empty() { "Project" } else { &project.name },
            "current_environment_id": project.current_environment_id,
            "environments": env_paths, "items": items(&source, &mut files)?,
        },
    });
    files.insert(MANIFEST.into(), yaml_bytes(&manifest));
    Ok((files, local_values))
}

fn ensure_gitignore(root: &Path) -> R<()> {
    let path = root.join(".gitignore");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let lines: BTreeSet<&str> = existing.lines().map(str::trim).collect();
    let missing: Vec<&str> = [".beacon/", ".DS_Store", "Thumbs.db", "desktop.ini"].into_iter().filter(|e| !lines.contains(e)).collect();
    if missing.is_empty() {
        return Ok(());
    }
    let sep = if existing.is_empty() || existing.ends_with('\n') { "" } else { "\n" };
    fs::OpenOptions::new().create(true).append(true).open(&path)
        .and_then(|mut f| { f.write_all(format!("{sep}{}\n", missing.join("\n")).as_bytes())?; f.sync_all() })
        .map_err(|_| "Could not protect local secrets with .gitignore".to_string())
}

pub fn write(project: &mut Project, force: bool) -> R<()> {
    let mut meta = metadata(project);
    let root = PathBuf::from(vstr(meta.get("path")));
    if !root.is_absolute() {
        return Err("Linked project folder is invalid".into());
    }
    fs::create_dir_all(&root).map_err(|e| format!("Could not create linked folder: {e}"))?;
    let previous = hashes(&meta);
    if !force && !previous.is_empty() && !changes(&previous, &snapshot(&root)).is_empty() {
        return Err("Linked project files changed outside Beacon".into());
    }
    let (mut files, local) = serialize(project)?;
    ensure_gitignore(&root)?;
    files.insert(LOCAL_ENVIRONMENTS.into(), yaml_bytes(&json!({ "version": SCHEMA_VERSION, "environments": local })));

    let staging = root.join(format!(".beacon-write-{}", uuid::Uuid::new_v4().simple()));
    let result = (|| -> R<()> {
        for (rel, content) in &files {
            let target = staging.join(rel);
            fs::create_dir_all(target.parent().unwrap_or(&staging)).map_err(|e| e.to_string())?;
            fs::File::create(&target).and_then(|mut f| { f.write_all(content)?; f.sync_all() }).map_err(|e| e.to_string())?;
        }
        // Only files Beacon itself wrote last time (tracked hashes) are ever removed.
        for rel in previous.keys().filter(|p| !files.contains_key(*p)) {
            let target = safe_relative(&root, rel)?;
            if target.is_file() {
                fs::remove_file(&target).map_err(|e| e.to_string())?;
            }
        }
        for rel in files.keys() {
            let target = safe_relative(&root, rel)?;
            fs::create_dir_all(target.parent().unwrap_or(&root)).map_err(|e| e.to_string())?;
            fs::rename(staging.join(rel), &target).map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    let _ = fs::remove_dir_all(&staging);
    result.map_err(|e| format!("Could not write linked project files: {e}"))?;
    mark_synced(&mut meta, &snapshot(&root));
    project.file_sync = Some(Value::Object(meta));
    Ok(())
}

pub fn reload(project: &mut Project) -> R<Value> {
    let mut meta = metadata(project);
    let root = PathBuf::from(vstr(meta.get("path")));
    if !root.is_absolute() || !root.is_dir() {
        return Err("The linked project folder could not be found".into());
    }
    let source = check_manifest(&load_yaml(&root.join(MANIFEST))?, "beacon.yaml is not a Beacon project")?;
    if vstr(source.get("id")) != project.id {
        return Err("Linked folder belongs to a different Beacon project".into());
    }

    let env_paths: Vec<String> = source.get("environments").and_then(|e| e.as_array())
        .map(|a| a.iter().map(|p| vstr(Some(p))).collect()).unwrap_or_default();
    let local_path = root.join(LOCAL_ENVIRONMENTS);
    let local = if local_path.is_file() {
        match load_yaml(&local_path)?.get("environments") {
            None | Some(Value::Null) => Map::new(),
            Some(Value::Object(m)) => m.clone(),
            Some(_) => return Err("Local environment overlay is invalid".into()),
        }
    } else {
        Map::new()
    };
    let mut environments = Vec::new();
    for rel in &env_paths {
        let env = load_yaml(&safe_relative(&root, rel)?)?;
        let mut variables = match env.get("variables") {
            None | Some(Value::Null) => Map::new(),
            Some(Value::Object(m)) => m.clone(),
            Some(_) => return Err(format!("Environment variables must be a mapping: {rel}")),
        };
        let id = vstr(env.get("id"));
        if let Some(Value::Object(overlay)) = local.get(&id) {
            variables.extend(overlay.clone());
        }
        environments.push(Environment {
            id,
            name: env.get("name").and_then(|n| n.as_str()).unwrap_or("Environment").to_string(),
            base_url: vstr(env.get("base_url")),
            variables: variables.into_iter().map(|(k, v)| (k, if v.is_null() { json!("") } else { v })).collect(),
        });
    }

    let mut referenced: BTreeSet<String> = env_paths.iter().cloned().collect();
    referenced.insert(MANIFEST.into());
    fn load_items(root: &Path, nodes: &Value, referenced: &mut BTreeSet<String>) -> R<Vec<Value>> {
        let Some(nodes) = nodes.as_array() else { return Err("Project items must be a list".into()) };
        let mut out = Vec::new();
        for node in nodes {
            let Some(obj) = node.as_object() else { return Err("Project item must be a mapping".into()) };
            if obj.get("type").and_then(|t| t.as_str()) == Some("folder") {
                let mut folder = json!({
                    "type": "folder", "id": vstr(obj.get("id")),
                    "name": obj.get("name").and_then(|n| n.as_str()).unwrap_or("Folder"),
                    "items": load_items(root, obj.get("items").unwrap_or(&json!([])), referenced)?,
                });
                if let Some(auth) = obj.get("auth").filter(|a| !a.is_null()) {
                    folder["auth"] = auth.clone();
                }
                out.push(folder);
                continue;
            }
            let rel = vstr(obj.get("file"));
            if obj.get("type").and_then(|t| t.as_str()) != Some("request") || rel.is_empty() {
                return Err("Request item is missing its endpoint file".into());
            }
            let mut endpoint = load_yaml(&safe_relative(root, &rel)?)?;
            if vstr(endpoint.get("id")) != vstr(obj.get("id")) {
                return Err(format!("Endpoint ID does not match its manifest entry: {rel}"));
            }
            referenced.insert(rel);
            endpoint.insert("type".into(), json!("request"));
            out.push(Value::Object(endpoint));
        }
        Ok(out)
    }
    let items = load_items(&root, source.get("items").filter(|i| !i.is_null()).unwrap_or(&json!([])), &mut referenced)?;
    let snap = snapshot(&root);
    if let Some(extra) = snap.keys().find(|p| !referenced.contains(*p)) {
        return Err(format!("Unreferenced managed project file: {extra}"));
    }

    if let Some(name) = source.get("name").and_then(|n| n.as_str()).filter(|n| !n.is_empty()) {
        project.name = name.to_string();
    }
    project.environments = environments;
    project.current_environment_id = source.get("current_environment_id").and_then(|c| c.as_str()).map(String::from);
    project.items = Some(items);
    project.tests = None;
    mark_synced(&mut meta, &snap);
    project.file_sync = Some(Value::Object(meta));
    Ok(status(project))
}

pub fn link(project: &mut Project, raw_path: &str) -> R<Value> {
    if raw_path.trim().is_empty() {
        return Err("Choose a folder before linking the project".into());
    }
    if !Path::new(raw_path).is_absolute() {
        return Err("Linked project folder must use an absolute path".into());
    }
    let root = absolute_dir(raw_path, "Linked project path is not a folder")?;
    if root.join(MANIFEST).exists() {
        return Err("This folder already contains beacon.yaml. Use Import > Folder to open the existing project.".into());
    }
    let reserved: Vec<&str> = ["endpoints", "environments"].into_iter().filter(|d| {
        let mut found = Snapshot::new();
        collect_yaml(&root, &root.join(d), &mut found);
        !found.is_empty()
    }).collect();
    if !reserved.is_empty() {
        return Err(format!(
            "This repository already uses Beacon's reserved {} YAML folder. Move those YAML files or initialize Beacon in a dedicated subfolder.",
            reserved.join(" and ")
        ));
    }
    let previous = project.file_sync.replace(fresh_metadata(&root));
    if let Err(e) = write(project, true) {
        project.file_sync = previous;
        return Err(e);
    }
    Ok(status(project))
}

pub fn unlink(project: &mut Project) -> Value {
    project.file_sync = None;
    status(project)
}

pub fn open_existing(raw_path: &str, existing_ids: &[String]) -> R<Project> {
    if raw_path.trim().is_empty() {
        return Err("Choose a Beacon project folder".into());
    }
    let root = absolute_dir(raw_path, "Existing project folder must be an absolute directory")?;
    let source = check_manifest(&load_yaml(&root.join(MANIFEST))?, "The selected folder does not contain a Beacon project")?;
    let id = vstr(source.get("id"));
    if id.is_empty() {
        return Err("beacon.yaml is missing a stable project ID".into());
    }
    if existing_ids.contains(&id) {
        return Err("This Beacon project is already open in the workspace".into());
    }
    let mut project = Project {
        id,
        name: source.get("name").and_then(|n| n.as_str()).unwrap_or("Linked Project").to_string(),
        template_id: None,
        environments: Vec::new(),
        current_environment_id: None,
        notifications: None,
        shared_origin: None,
        file_sync: Some(fresh_metadata(&root)),
        items: Some(Vec::new()),
        tests: None,
        auth: None,
    };
    reload(&mut project)?;
    Ok(project)
}

pub fn missing_private_values(project: &Project) -> Value {
    let mut missing = Vec::new();
    for env in &project.environments {
        for (key, value) in env.variables.iter().collect::<BTreeMap<_, _>>() {
            let empty = value.is_null() || value.as_str().is_some_and(|s| s.trim().is_empty());
            if is_secret(key) && empty {
                missing.push(json!({ "environment_id": env.id, "environment_name": env.name, "key": key }));
            }
        }
    }
    Value::Array(missing)
}

/// Called from `Store::save`: write linked folders, but never over external edits.
pub fn sync_before_save(project: &mut Project) {
    if linked_path(project).is_none() {
        return;
    }
    let current = status(project);
    let outcome: R<()> = if current["state"] != "clean" {
        let mut meta = metadata(project);
        let memory_changed = match serialize(project) {
            Ok((files, _)) => {
                let snap: Snapshot = files.iter().filter(|(p, _)| !p.starts_with(LOCAL_DIR)).map(|(p, c)| (p.clone(), sha(c))).collect();
                Some(snapshot_hash(&snap)) != meta.get("last_synced_hash").and_then(|h| h.as_str()).map(String::from)
            }
            Err(_) => true,
        };
        let dirty = meta.get("local_dirty").and_then(|d| d.as_bool()).unwrap_or(false) || memory_changed;
        meta.insert("local_dirty".into(), json!(dirty));
        meta.insert("last_error".into(), current["message"].clone());
        project.file_sync = Some(Value::Object(meta));
        Ok(())
    } else {
        write(project, false)
    };
    if let Err(e) = outcome {
        let mut meta = metadata(project);
        meta.insert("local_dirty".into(), json!(true));
        meta.insert("last_error".into(), json!(e));
        project.file_sync = Some(Value::Object(meta));
    }
}

/// Inspect a folder: either an existing Beacon project or something to initialize.
// shortcut: never lists API-file import candidates (OpenAPI/Postman/...) because the
// importer is not ported to Rust yet; wire `normalize_project` in here when it is.
pub fn inspect(raw_path: &str) -> R<Value> {
    let root = absolute_dir(raw_path, "Repository path must be an absolute directory")?;
    let mode = if root.join(MANIFEST).is_file() { "beacon_project" } else { "empty_repository" };
    Ok(json!({
        "mode": mode,
        "repository_path": root.to_string_lossy(),
        "repository_name": root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "candidates": [],
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_and_secret_names() {
        assert_eq!(slug("Get User / Profile!"), "get-user-profile");
        assert_eq!(slug("***"), "resource");
        assert_eq!(resource_file("endpoints", "Login", "ep_9f2c1d7e0b"), "endpoints/login--e9f2c1d7.yaml");
        assert!(is_secret("X-Api-Key") && is_secret("refresh_TOKEN") && !is_secret("base_path"));
    }

    #[test]
    fn rejects_escaping_paths() {
        let root = std::env::temp_dir();
        assert!(safe_relative(&root, "../etc/passwd").is_err());
        assert!(safe_relative(&root, "/etc/passwd").is_err());
        assert!(safe_relative(&root, "endpoints/a.yaml").is_ok());
    }
}
