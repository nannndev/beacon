//! SQLite canonical source for shared projects. Same schema as the Python
//! `sharing/sqlite_repository.py` so existing `workspace.db` files keep working.
use super::privacy::sanitize_project_source;
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const SCHEMA_VERSION: i64 = 1;
pub const OPERATIONS: [&str; 4] = ["project.updated", "endpoint.updated", "folder.updated", "environment.updated"];

pub fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Revision {
    pub id: String,
    pub project_id: String,
    pub revision: i64,
    pub base_revision: i64,
    pub mutation_id: String,
    pub actor_device_id: String,
    pub actor_device_name: Option<String>,
    pub actor_device_ip: Option<String>,
    pub operation: String,
    pub target_type: String,
    pub target_id: Option<String>,
    pub patch: Value,
    pub summary: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct Mutation {
    pub mutation_id: String,
    pub project_id: String,
    pub base_revision: i64,
    pub operation: String,
    pub target_id: Option<String>,
    pub payload: Map<String, Value>,
}

#[derive(Debug, Clone)]
pub struct Actor {
    pub device_id: String,
    pub device_name: Option<String>,
    pub device_ip: Option<String>,
}

#[derive(Debug)]
pub enum RepoError {
    Conflict { current_revision: i64, target_id: Option<String>, latest_entity: Value },
    NotFound(String),
    Bad(String),
    Db(String),
}

impl RepoError {
    pub fn conflict_json(&self) -> Option<Value> {
        match self {
            RepoError::Conflict { current_revision, target_id, latest_entity } => Some(json!({
                "error": "revision_conflict", "current_revision": current_revision,
                "target_id": target_id, "latest_entity": latest_entity,
            })),
            _ => None,
        }
    }
    pub fn message(&self) -> String {
        match self {
            RepoError::Conflict { .. } => "Project source changed since this edit was created".into(),
            RepoError::NotFound(m) | RepoError::Bad(m) | RepoError::Db(m) => m.clone(),
        }
    }
}

impl From<rusqlite::Error> for RepoError {
    fn from(e: rusqlite::Error) -> Self {
        RepoError::Db(e.to_string())
    }
}

fn target_type(operation: &str) -> &str {
    operation.split('.').next().unwrap_or(operation)
}

fn walk_items<'a>(items: &'a [Value], out: &mut Vec<&'a Value>) {
    for item in items {
        out.push(item);
        if item.get("type").and_then(Value::as_str) == Some("folder") {
            if let Some(sub) = item.get("items").and_then(Value::as_array) {
                walk_items(sub, out);
            }
        }
    }
}

pub fn find_entity(source: &Value, ttype: &str, target_id: Option<&str>) -> Option<Value> {
    match ttype {
        "project" => Some(source.clone()),
        "folder" | "endpoint" => {
            let expected = if ttype == "endpoint" { "request" } else { "folder" };
            let mut all = Vec::new();
            walk_items(source.get("items").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]), &mut all);
            all.into_iter()
                .find(|i| i.get("id").and_then(Value::as_str) == target_id && i.get("type").and_then(Value::as_str) == Some(expected))
                .cloned()
        }
        "environment" => source
            .get("environments")
            .and_then(Value::as_array)
            .and_then(|envs| envs.iter().find(|e| e.get("id").and_then(Value::as_str) == target_id).cloned()),
        _ => None,
    }
}

fn apply_payload(entity: &mut Value, payload: &Map<String, Value>) {
    if let Some(obj) = entity.as_object_mut() {
        for (k, v) in payload {
            if k != "id" && k != "type" {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
}

fn update_entity(source: &mut Value, mutation: &Mutation) -> Result<(), RepoError> {
    let (ttype, action) = mutation.operation.split_once('.').unwrap_or((&mutation.operation, ""));
    if action != "updated" {
        return Err(RepoError::Bad(format!("Unsupported Phase 1 operation: {}", mutation.operation)));
    }
    let missing = || RepoError::NotFound(format!("{ttype} {:?} not found", mutation.target_id));
    match ttype {
        "project" => apply_payload(source, &mutation.payload),
        "environment" => {
            let env = source
                .get_mut("environments")
                .and_then(Value::as_array_mut)
                .and_then(|envs| envs.iter_mut().find(|e| e.get("id").and_then(Value::as_str) == mutation.target_id.as_deref()))
                .ok_or_else(missing)?;
            apply_payload(env, &mutation.payload);
        }
        "folder" | "endpoint" => {
            let expected = if ttype == "endpoint" { "request" } else { "folder" };
            let items = source.get_mut("items").and_then(Value::as_array_mut).ok_or_else(missing)?;
            let entity = find_item_mut(items, mutation.target_id.as_deref(), expected).ok_or_else(missing)?;
            apply_payload(entity, &mutation.payload);
        }
        _ => return Err(missing()),
    }
    Ok(())
}

fn find_item_mut<'a>(items: &'a mut Vec<Value>, id: Option<&str>, expected: &str) -> Option<&'a mut Value> {
    for item in items.iter_mut() {
        let matches = item.get("id").and_then(Value::as_str) == id && item.get("type").and_then(Value::as_str) == Some(expected);
        if matches {
            return Some(item);
        }
        if item.get("type").and_then(Value::as_str) == Some("folder") {
            if let Some(sub) = item.get_mut("items").and_then(Value::as_array_mut) {
                if let Some(found) = find_item_mut(sub, id, expected) {
                    return Some(found);
                }
            }
        }
    }
    None
}

#[derive(Clone, Debug)]
pub struct Repository {
    pub path: PathBuf,
}

impl Repository {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    fn connect(&self) -> Result<Connection, RepoError> {
        let db = Connection::open(&self.path)?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch("PRAGMA foreign_keys = ON")?;
        Ok(db)
    }

    pub fn initialize(&self) -> Result<(), RepoError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| RepoError::Db(e.to_string()))?;
        }
        let db = self.connect()?;
        let _ = db.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()));
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS shared_projects (
                project_id TEXT PRIMARY KEY,
                owner_device_id TEXT NOT NULL,
                current_revision INTEGER NOT NULL,
                source_schema_version INTEGER NOT NULL,
                sharing_enabled INTEGER NOT NULL,
                source_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS project_revisions (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES shared_projects(project_id) ON DELETE CASCADE,
                revision INTEGER NOT NULL,
                base_revision INTEGER NOT NULL,
                mutation_id TEXT NOT NULL,
                actor_device_id TEXT NOT NULL,
                actor_device_name TEXT,
                actor_device_ip TEXT,
                operation TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT,
                summary TEXT NOT NULL,
                patch_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(project_id, revision),
                UNIQUE(project_id, mutation_id)
            );
            CREATE TABLE IF NOT EXISTS trusted_devices (
                project_id TEXT NOT NULL REFERENCES shared_projects(project_id) ON DELETE CASCADE,
                device_id TEXT NOT NULL,
                device_name TEXT NOT NULL,
                credential_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                device_ip TEXT,
                app_version TEXT,
                platform TEXT,
                protocol INTEGER,
                created_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                PRIMARY KEY (project_id, device_id)
            );
            CREATE TABLE IF NOT EXISTS sharing_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        for (table, column, def) in [
            ("project_revisions", "actor_device_name", "TEXT"),
            ("project_revisions", "actor_device_ip", "TEXT"),
            ("trusted_devices", "app_version", "TEXT"),
            ("trusted_devices", "platform", "TEXT"),
            ("trusted_devices", "protocol", "INTEGER"),
        ] {
            let mut stmt = db.prepare(&format!("PRAGMA table_info({table})"))?;
            let cols: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(1))?.filter_map(Result::ok).collect();
            if !cols.iter().any(|c| c == column) {
                db.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {def}"))?;
            }
        }
        Ok(())
    }

    /// Stable id for this device: the Python history db's `origin_device_id` when present,
    /// otherwise one generated and stored in `sharing_meta`.
    pub fn device_id(&self, data_dir: &Path) -> String {
        let history = data_dir.join("history.db");
        if history.exists() {
            if let Ok(db) = Connection::open_with_flags(&history, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) {
                if let Ok(Some(id)) = db
                    .query_row("SELECT value FROM history_meta WHERE key = 'origin_device_id'", [], |r| r.get::<_, String>(0))
                    .optional()
                {
                    return id;
                }
            }
        }
        let fallback = || Uuid::new_v4().to_string();
        let Ok(db) = self.connect() else { return "local".into() };
        if let Ok(Some(id)) = db.query_row("SELECT value FROM sharing_meta WHERE key = 'device_id'", [], |r| r.get::<_, String>(0)).optional() {
            return id;
        }
        let id = fallback();
        let _ = db.execute("INSERT OR IGNORE INTO sharing_meta(key, value) VALUES ('device_id', ?1)", params![id]);
        db.query_row("SELECT value FROM sharing_meta WHERE key = 'device_id'", [], |r| r.get::<_, String>(0)).unwrap_or(id)
    }

    pub fn import_project(&self, project: &Value, owner_device_id: &str) -> Result<Value, RepoError> {
        let project_id = project.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or_else(|| Uuid::new_v4().to_string());
        let mut with_id = project.clone();
        with_id["id"] = json!(project_id);
        let source = sanitize_project_source(&with_id);
        let ts = now();
        let db = self.connect()?;
        if let Some((rev, src)) = db
            .query_row("SELECT current_revision, source_json FROM shared_projects WHERE project_id = ?1", params![project_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .optional()?
        {
            return Ok(json!({"project_id": project_id, "revision": rev, "source": serde_json::from_str::<Value>(&src).unwrap_or(Value::Null)}));
        }
        db.execute(
            "INSERT INTO shared_projects VALUES (?1, ?2, 1, ?3, 0, ?4, ?5, ?5)",
            params![project_id, owner_device_id, SCHEMA_VERSION, source.to_string(), ts],
        )?;
        insert_revision(
            &db,
            &Revision {
                id: Uuid::new_v4().to_string(),
                project_id: project_id.clone(),
                revision: 1,
                base_revision: 0,
                mutation_id: format!("import:{project_id}"),
                actor_device_id: owner_device_id.to_string(),
                actor_device_name: None,
                actor_device_ip: None,
                operation: "project.imported".into(),
                target_type: "project".into(),
                target_id: Some(project_id.clone()),
                summary: format!("Imported {} for sharing", source.get("name").and_then(Value::as_str).unwrap_or("project")),
                patch: json!({"source": source}),
                created_at: ts,
            },
        )?;
        Ok(json!({"project_id": project_id, "revision": 1, "source": source}))
    }

    pub fn snapshot(&self, project_id: &str) -> Result<Option<Value>, RepoError> {
        let db = self.connect()?;
        Ok(db
            .query_row(
                "SELECT current_revision, source_schema_version, source_json FROM shared_projects WHERE project_id = ?1",
                params![project_id],
                |r| {
                    Ok(json!({
                        "project_id": project_id,
                        "revision": r.get::<_, i64>(0)?,
                        "source_schema_version": r.get::<_, i64>(1)?,
                        "source": serde_json::from_str::<Value>(&r.get::<_, String>(2)?).unwrap_or(Value::Null),
                    }))
                },
            )
            .optional()?)
    }

    pub fn status(&self, project_id: &str) -> Result<Option<Value>, RepoError> {
        let db = self.connect()?;
        Ok(db
            .query_row(
                "SELECT project_id, owner_device_id, current_revision, source_schema_version, sharing_enabled, created_at, updated_at
                 FROM shared_projects WHERE project_id = ?1",
                params![project_id],
                |r| {
                    Ok(json!({
                        "project_id": r.get::<_, String>(0)?,
                        "owner_device_id": r.get::<_, String>(1)?,
                        "revision": r.get::<_, i64>(2)?,
                        "source_schema_version": r.get::<_, i64>(3)?,
                        "sharing_enabled": r.get::<_, i64>(4)? != 0,
                        "created_at": r.get::<_, String>(5)?,
                        "updated_at": r.get::<_, String>(6)?,
                    }))
                },
            )
            .optional()?)
    }

    pub fn set_sharing_enabled(&self, project_id: &str, enabled: bool) -> Result<Value, RepoError> {
        let db = self.connect()?;
        let n = db.execute(
            "UPDATE shared_projects SET sharing_enabled = ?1, updated_at = ?2 WHERE project_id = ?3",
            params![enabled as i64, now(), project_id],
        )?;
        if n != 1 {
            return Err(RepoError::NotFound(format!("Project {project_id:?} not found")));
        }
        self.status(project_id)?.ok_or_else(|| RepoError::NotFound(format!("Project {project_id:?} not found")))
    }

    pub fn disable_all_sharing(&self) -> Result<(), RepoError> {
        self.connect()?.execute("UPDATE shared_projects SET sharing_enabled = 0 WHERE sharing_enabled = 1", [])?;
        Ok(())
    }

    pub fn trust_device(&self, project_id: &str, device: &Value, credential_hash: &str) -> Result<Option<Value>, RepoError> {
        let db = self.connect()?;
        let ts = now();
        let s = |k: &str| device.get(k).and_then(Value::as_str).map(str::to_string);
        db.execute(
            "INSERT INTO trusted_devices (project_id, device_id, device_name, credential_hash, role, device_ip, app_version, platform, protocol, created_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
             ON CONFLICT(project_id, device_id) DO UPDATE SET
                 device_name=excluded.device_name, credential_hash=excluded.credential_hash,
                 role=excluded.role, device_ip=excluded.device_ip,
                 app_version=excluded.app_version, platform=excluded.platform,
                 protocol=excluded.protocol, last_seen_at=excluded.last_seen_at",
            params![
                project_id,
                s("device_id").unwrap_or_default(),
                s("device_name").unwrap_or_default(),
                credential_hash,
                s("role").unwrap_or_else(|| "viewer".into()),
                s("device_ip"),
                s("app_version"),
                s("platform"),
                device.get("protocol").and_then(Value::as_i64),
                ts
            ],
        )?;
        self.trusted_device(project_id, &s("device_id").unwrap_or_default())
    }

    pub fn trusted_device(&self, project_id: &str, device_id: &str) -> Result<Option<Value>, RepoError> {
        let db = self.connect()?;
        Ok(db
            .query_row("SELECT * FROM trusted_devices WHERE project_id=?1 AND device_id=?2", params![project_id, device_id], row_to_json)
            .optional()?)
    }

    pub fn trusted_devices(&self, project_id: &str) -> Result<Vec<Value>, RepoError> {
        let db = self.connect()?;
        let mut stmt = db.prepare(
            "SELECT project_id, device_id, device_name, role, device_ip, app_version, platform, protocol, created_at, last_seen_at
             FROM trusted_devices WHERE project_id=?1 ORDER BY last_seen_at DESC",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_json)?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn touch_trusted_device(&self, project_id: &str, device_id: &str, device_ip: Option<&str>) -> Result<(), RepoError> {
        self.connect()?.execute(
            "UPDATE trusted_devices SET last_seen_at=?1, device_ip=COALESCE(?2, device_ip) WHERE project_id=?3 AND device_id=?4",
            params![now(), device_ip, project_id, device_id],
        )?;
        Ok(())
    }

    pub fn revoke_trusted_device(&self, project_id: &str, device_id: &str) -> Result<bool, RepoError> {
        Ok(self.connect()?.execute("DELETE FROM trusted_devices WHERE project_id=?1 AND device_id=?2", params![project_id, device_id])? == 1)
    }

    pub fn update_trusted_device_role(&self, project_id: &str, device_id: &str, role: &str) -> Result<bool, RepoError> {
        Ok(self.connect()?.execute(
            "UPDATE trusted_devices SET role=?1, last_seen_at=?2 WHERE project_id=?3 AND device_id=?4",
            params![role, now(), project_id, device_id],
        )? == 1)
    }

    pub fn apply_mutation(&self, mutation: &Mutation, actor: &Actor, summary: &str) -> Result<Revision, RepoError> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(dup) = tx
            .query_row(
                "SELECT * FROM project_revisions WHERE project_id = ?1 AND mutation_id = ?2",
                params![mutation.project_id, mutation.mutation_id],
                revision_from_row,
            )
            .optional()?
        {
            return Ok(dup);
        }
        let (current_revision, source_json) = tx
            .query_row(
                "SELECT current_revision, source_json FROM shared_projects WHERE project_id = ?1",
                params![mutation.project_id],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or_else(|| RepoError::NotFound(format!("Project {:?} not found", mutation.project_id)))?;
        let mut source: Value = serde_json::from_str(&source_json).map_err(|e| RepoError::Db(e.to_string()))?;
        if mutation.base_revision != current_revision {
            return Err(RepoError::Conflict {
                current_revision,
                target_id: mutation.target_id.clone(),
                latest_entity: find_entity(&source, target_type(&mutation.operation), mutation.target_id.as_deref()).unwrap_or(Value::Null),
            });
        }
        update_entity(&mut source, mutation)?;
        let source = sanitize_project_source(&source);
        let revision = Revision {
            id: Uuid::new_v4().to_string(),
            project_id: mutation.project_id.clone(),
            revision: current_revision + 1,
            base_revision: current_revision,
            mutation_id: mutation.mutation_id.clone(),
            actor_device_id: actor.device_id.clone(),
            actor_device_name: actor.device_name.clone(),
            actor_device_ip: actor.device_ip.clone(),
            operation: mutation.operation.clone(),
            target_type: target_type(&mutation.operation).to_string(),
            target_id: mutation.target_id.clone(),
            summary: summary.to_string(),
            patch: Value::Object(mutation.payload.clone()),
            created_at: now(),
        };
        tx.execute(
            "UPDATE shared_projects SET current_revision = ?1, source_json = ?2, updated_at = ?3 WHERE project_id = ?4",
            params![revision.revision, source.to_string(), revision.created_at, mutation.project_id],
        )?;
        insert_revision(&tx, &revision)?;
        tx.commit()?;
        Ok(revision)
    }

    pub fn revisions_after(&self, project_id: &str, revision: i64) -> Result<Vec<Revision>, RepoError> {
        let db = self.connect()?;
        let mut stmt = db.prepare("SELECT * FROM project_revisions WHERE project_id = ?1 AND revision > ?2 ORDER BY revision")?;
        let rows = stmt.query_map(params![project_id, revision], revision_from_row)?;
        Ok(rows.filter_map(Result::ok).collect())
    }
}

fn insert_revision(db: &Connection, r: &Revision) -> Result<(), RepoError> {
    db.execute(
        "INSERT INTO project_revisions (id, project_id, revision, base_revision, mutation_id, actor_device_id, actor_device_name, actor_device_ip,
             operation, target_type, target_id, summary, patch_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            r.id, r.project_id, r.revision, r.base_revision, r.mutation_id, r.actor_device_id, r.actor_device_name, r.actor_device_ip,
            r.operation, r.target_type, r.target_id, r.summary, r.patch.to_string(), r.created_at
        ],
    )?;
    Ok(())
}

fn revision_from_row(r: &Row<'_>) -> rusqlite::Result<Revision> {
    Ok(Revision {
        id: r.get("id")?,
        project_id: r.get("project_id")?,
        revision: r.get("revision")?,
        base_revision: r.get("base_revision")?,
        mutation_id: r.get("mutation_id")?,
        actor_device_id: r.get("actor_device_id")?,
        actor_device_name: r.get("actor_device_name")?,
        actor_device_ip: r.get("actor_device_ip")?,
        operation: r.get("operation")?,
        target_type: r.get("target_type")?,
        target_id: r.get("target_id")?,
        summary: r.get("summary")?,
        patch: serde_json::from_str(&r.get::<_, String>("patch_json")?).unwrap_or(Value::Null),
        created_at: r.get("created_at")?,
    })
}

fn row_to_json(r: &Row<'_>) -> rusqlite::Result<Value> {
    let mut obj = Map::new();
    for (i, name) in r.as_ref().column_names().iter().enumerate() {
        let v = match r.get_ref(i)? {
            rusqlite::types::ValueRef::Null => Value::Null,
            rusqlite::types::ValueRef::Integer(n) => json!(n),
            rusqlite::types::ValueRef::Real(f) => json!(f),
            rusqlite::types::ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
            rusqlite::types::ValueRef::Blob(b) => json!(hex::encode(b)),
        };
        obj.insert(name.to_string(), v);
    }
    Ok(Value::Object(obj))
}

/// Human summary of a full-source mutation without leaking source values.
pub fn change_summary(before: &Value, after: &Value) -> String {
    let mut changes = Vec::new();
    if before.get("name") != after.get("name") {
        changes.push(format!("Renamed project to {}", after.get("name").and_then(Value::as_str).unwrap_or("Untitled")));
    }
    fn indexed(source: &Value, key: &str) -> Map<String, Value> {
        let mut out = Map::new();
        fn walk(items: &[Value], out: &mut Map<String, Value>, nested: bool) {
            for item in items {
                if let Some(id) = item.get("id").and_then(Value::as_str) {
                    out.insert(id.to_string(), item.clone());
                    if nested {
                        if let Some(sub) = item.get("items").and_then(Value::as_array) {
                            walk(sub, out, true);
                        }
                    }
                }
            }
        }
        walk(source.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]), &mut out, key == "items");
        out
    }
    for (key, label) in [("items", "source item"), ("environments", "environment")] {
        let (old, new) = (indexed(before, key), indexed(after, key));
        let added = new.keys().filter(|k| !old.contains_key(*k)).count();
        let removed = old.keys().filter(|k| !new.contains_key(*k)).count();
        let changed: Vec<&String> = new.keys().filter(|k| old.get(*k).map(|o| o != &new[*k]).unwrap_or(false)).collect();
        if added > 0 {
            changes.push(format!("Added {added} {label}{}", if added == 1 { "" } else { "s" }));
        }
        if removed > 0 {
            changes.push(format!("Removed {removed} {label}{}", if removed == 1 { "" } else { "s" }));
        }
        if !changed.is_empty() {
            let names: Vec<String> = changed.iter().take(2).map(|id| new[*id].get("name").and_then(Value::as_str).unwrap_or(label).to_string()).collect();
            let extra = if changed.len() > 2 { format!(" +{}", changed.len() - 2) } else { String::new() };
            changes.push(format!("Updated {}{extra}", names.join(", ")));
        }
    }
    if changes.is_empty() { "Updated project source".into() } else { changes.join(" · ") }
}

/// Validate and apply a mutation request (the shape sent over `/beacon-share/.../mutations`).
pub fn mutate(repo: &Repository, data: &Value, actor: Actor) -> Result<Revision, RepoError> {
    let s = |k: &str| data.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let mutation = Mutation {
        mutation_id: s("mutation_id"),
        project_id: s("project_id"),
        base_revision: data.get("base_revision").and_then(Value::as_i64).unwrap_or(-1),
        operation: s("operation"),
        target_id: data.get("target_id").and_then(Value::as_str).map(str::to_string),
        payload: data.get("payload").and_then(Value::as_object).cloned().unwrap_or_default(),
    };
    if mutation.mutation_id.is_empty() {
        return Err(RepoError::Bad("mutation_id is required".into()));
    }
    if mutation.project_id.is_empty() {
        return Err(RepoError::Bad("project_id is required".into()));
    }
    if !OPERATIONS.contains(&mutation.operation.as_str()) {
        return Err(RepoError::Bad("Unsupported mutation operation".into()));
    }
    let status = repo.status(&mutation.project_id)?;
    if !status.as_ref().and_then(|s| s.get("sharing_enabled")).and_then(Value::as_bool).unwrap_or(false) {
        return Err(RepoError::Bad("Project sharing is not enabled".into()));
    }
    let mut summary = data.get("summary").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or_else(|| mutation.operation.clone());
    if mutation.operation == "project.updated" {
        if let Some(snapshot) = repo.snapshot(&mutation.project_id)? {
            let mut candidate = snapshot["source"].clone();
            apply_payload(&mut candidate, &mutation.payload);
            if let Some(obj) = candidate.as_object_mut() {
                for (k, v) in &mutation.payload {
                    obj.insert(k.clone(), v.clone());
                }
            }
            summary = change_summary(&snapshot["source"], &candidate);
        }
    }
    repo.apply_mutation(&mutation, &actor, &summary)
}
