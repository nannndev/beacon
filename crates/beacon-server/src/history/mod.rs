//! Run history in `history.db`, the same SQLite file and schema the Python
//! backend wrote. Tables are only ever created `IF NOT EXISTS`; existing rows
//! are read and extended, never migrated away.

pub mod report;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use beacon_core::percentile;
use chrono::{DateTime, SecondsFormat, Utc};
use parking_lot::Mutex;
use rusqlite::{params, params_from_iter, types::ValueRef, Connection, Params};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const SCHEMA_VERSION: i64 = 1;
const SAMPLE_CAP: usize = 300;
const EVENT_CAP: usize = 200;
const CORRUPT_MARKERS: [&str; 4] = ["malformed", "corrupt", "not a database", "encrypted"];

/// Execution controls safe to keep in a run's config snapshot (no request data).
pub const RUN_CONFIG_KEYS: &[&str] = &[
    "mode", "dataset_rows", "dataset_mode", "concurrency", "delay", "max_requests",
    "use_min_delay", "ramp_start", "ramp_end", "ramp_step_duration", "baseline_workers",
    "peak_workers", "baseline_requests", "peak_requests", "recovery_requests", "duration_s",
    "rps", "start_rps", "step_rps", "step_requests", "max_rps", "p95_limit_ms",
    "error_limit_pct", "success_min_pct", "n_samples", "warmup",
];

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
    project_name TEXT NOT NULL, origin_device_id TEXT NOT NULL, source_type TEXT NOT NULL,
    target_id TEXT, target_name TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
    label TEXT, is_pinned INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL,
    completed_at TEXT, duration_ms INTEGER, config_snapshot_json TEXT NOT NULL,
    schema_version INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS run_steps (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, sequence INTEGER NOT NULL,
    endpoint_id TEXT NOT NULL, endpoint_name TEXT NOT NULL, method TEXT NOT NULL,
    url_template TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0, success INTEGER NOT NULL DEFAULT 0,
    rate_limited INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
    average_rps REAL NOT NULL DEFAULT 0, peak_rps REAL NOT NULL DEFAULT 0,
    min_latency_ms REAL, average_latency_ms REAL, p50_ms REAL, p95_ms REAL, p99_ms REAL,
    max_latency_ms REAL, PRIMARY KEY (run_id, sequence)
);
CREATE TABLE IF NOT EXISTS run_metrics (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0, success INTEGER NOT NULL DEFAULT 0,
    rate_limited INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
    average_rps REAL NOT NULL DEFAULT 0, peak_rps REAL NOT NULL DEFAULT 0,
    min_latency_ms REAL, average_latency_ms REAL, p50_ms REAL, p95_ms REAL, p99_ms REAL,
    max_latency_ms REAL
);
CREATE TABLE IF NOT EXISTS run_samples (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, sequence INTEGER NOT NULL,
    elapsed_ms INTEGER NOT NULL, attempts INTEGER NOT NULL, success INTEGER NOT NULL,
    rate_limited INTEGER NOT NULL, errors INTEGER NOT NULL, instantaneous_rps REAL NOT NULL,
    latency_ms REAL, PRIMARY KEY (run_id, sequence)
);
CREATE TABLE IF NOT EXISTS run_events (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, sequence INTEGER NOT NULL,
    elapsed_ms INTEGER NOT NULL, outcome TEXT NOT NULL, status_code INTEGER, latency_ms REAL,
    error_category TEXT, message TEXT, PRIMARY KEY (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_runs_project_started ON runs(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_project_pin_started ON runs(project_id, is_pinned, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_mode_started ON runs(mode, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_workspace_revision ON runs(workspace_id, revision);
"#;

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false)
}

#[derive(Debug, PartialEq)]
pub enum HistoryError {
    Unavailable,
    BadCursor,
}

pub struct RunStart {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub source_type: String,
    pub target_id: Option<String>,
    pub target_name: String,
    pub mode: String,
    pub config_snapshot: Value,
}

pub struct StepStart {
    pub sequence: i64,
    pub endpoint_id: String,
    pub endpoint_name: String,
    pub method: String,
    pub url_template: String,
}

struct Sample {
    sequence: i64,
    elapsed_ms: i64,
    stats: [i64; 4],
    rps: f64,
    latency_ms: Option<f64>,
}

struct Event {
    elapsed_ms: i64,
    outcome: &'static str,
    status_code: Option<i64>,
    latency_ms: Option<f64>,
    error_category: Option<&'static str>,
}

#[derive(Default)]
struct StepBuf {
    stats: [i64; 4],
    latencies: Vec<f64>,
    status: Option<String>,
}

struct RunBuf {
    project_id: String,
    started: Instant,
    steps: BTreeMap<i64, StepBuf>,
    samples: Vec<Sample>,
    events: Vec<Event>,
    last_sample: Option<(i64, i64)>,
    next_sequence: i64,
}

struct Metrics {
    stats: [i64; 4],
    average_rps: f64,
    peak_rps: f64,
    min: Option<f64>,
    avg: Option<f64>,
    p50: Option<f64>,
    p95: Option<f64>,
    p99: Option<f64>,
    max: Option<f64>,
}

struct Health {
    available: bool,
    error_code: Option<&'static str>,
    fatal: bool,
    workspace_id: String,
    origin_device_id: String,
}

pub struct History {
    path: PathBuf,
    health: Mutex<Health>,
    active: Mutex<HashMap<String, RunBuf>>,
}

/// Halve a buffer once it exceeds `cap`, always keeping the newest value.
fn push_downsampled<T>(values: &mut Vec<T>, value: T, cap: usize) {
    values.push(value);
    if values.len() > cap {
        let last = values.len() - 1;
        let mut i = 0;
        values.retain(|_| {
            let keep = i % 2 == 0 || i == last;
            i += 1;
            keep
        });
    }
}

/// Average rps over the run and the busiest one-second window.
fn throughput(samples: &[Sample]) -> (f64, f64) {
    let Some(last) = samples.last() else { return (0.0, 0.0) };
    let average = last.stats[0] as f64 / (last.elapsed_ms as f64 / 1000.0).max(1.0);
    let mut by_second: BTreeMap<i64, i64> = BTreeMap::new();
    for s in samples {
        let e = by_second.entry(s.elapsed_ms / 1000).or_insert(0);
        *e = (*e).max(s.stats[0]);
    }
    let (mut peak, mut prev_s, mut prev_a) = (0.0f64, -1i64, 0i64);
    for (second, attempts) in by_second {
        peak = peak.max((attempts - prev_a) as f64 / (second - prev_s).max(1) as f64);
        prev_s = second;
        prev_a = attempts;
    }
    (average, peak)
}

fn pct(sorted: &[f64], q: f64) -> Option<f64> {
    (!sorted.is_empty()).then(|| percentile(sorted, q))
}

fn metrics_of(buf: &RunBuf, only: Option<i64>) -> Metrics {
    let steps: Vec<&StepBuf> = match only {
        Some(i) => buf.steps.get(&i).into_iter().collect(),
        None => buf.steps.values().collect(),
    };
    let mut stats = [0i64; 4];
    for s in &steps {
        for k in 0..4 {
            stats[k] += s.stats[k];
        }
    }
    let mut lat: Vec<f64> = steps.iter().flat_map(|s| s.latencies.iter().copied()).filter(|v| v.is_finite()).collect();
    lat.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let (average_rps, peak_rps) = throughput(&buf.samples);
    Metrics {
        stats,
        average_rps,
        peak_rps,
        min: lat.first().copied(),
        avg: (!lat.is_empty()).then(|| lat.iter().sum::<f64>() / lat.len() as f64),
        p50: pct(&lat, 50.0),
        p95: pct(&lat, 95.0),
        p99: pct(&lat, 99.0),
        max: lat.last().copied(),
    }
}

fn error_category(error: Option<&str>) -> &'static str {
    let t = error.unwrap_or("").to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| t.contains(w));
    if has(&["timeout", "timed out"]) {
        "timeout"
    } else if has(&["ssl", "tls", "certificate"]) {
        "tls"
    } else if has(&["connect", "network", "dns"]) {
        "connection"
    } else if has(&["json", "decode"]) {
        "invalid_response"
    } else {
        "request_error"
    }
}

fn query_maps<P: Params>(c: &Connection, sql: &str, p: P) -> rusqlite::Result<Vec<Map<String, Value>>> {
    let mut stmt = c.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map(p, |row| {
        let mut m = Map::new();
        for (i, name) in names.iter().enumerate() {
            let v = match row.get_ref(i)? {
                ValueRef::Null | ValueRef::Blob(_) => Value::Null,
                ValueRef::Integer(n) => json!(n),
                ValueRef::Real(f) => json!(f),
                ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
            };
            m.insert(name.clone(), v);
        }
        Ok(m)
    })?;
    rows.collect()
}

fn project_run(mut m: Map<String, Value>) -> Map<String, Value> {
    let pinned = m.get("is_pinned").and_then(|v| v.as_i64()).unwrap_or(0) != 0;
    m.insert("is_pinned".into(), json!(pinned));
    if let Some(raw) = m.remove("config_snapshot_json") {
        let snap = raw.as_str().and_then(|s| serde_json::from_str(s).ok()).unwrap_or(json!({}));
        m.insert("config_snapshot".into(), snap);
    }
    m
}

fn encode_cursor(started_at: &str, id: &str) -> String {
    URL_SAFE_NO_PAD.encode(serde_json::to_string(&json!([started_at, id])).unwrap())
}

fn decode_cursor(cursor: &str) -> Option<(String, String)> {
    let raw = URL_SAFE_NO_PAD.decode(cursor.trim_end_matches('=')).ok()?;
    let v: Vec<String> = serde_json::from_slice(&raw).ok()?;
    (v.len() == 2).then(|| (v[0].clone(), v[1].clone()))
}

impl History {
    pub fn open(path: impl AsRef<Path>) -> Self {
        let history = Self {
            path: path.as_ref().to_path_buf(),
            health: Mutex::new(Health {
                available: false,
                error_code: None,
                fatal: false,
                workspace_id: "local".into(),
                origin_device_id: "local".into(),
            }),
            active: Mutex::new(HashMap::new()),
        };
        history.initialize();
        // A run still "running" from an earlier process can never finish now.
        let device = history.health.lock().origin_device_id.clone();
        let ts = now();
        let _ = history.with_db(|c| {
            c.execute(
                "UPDATE runs SET status='interrupted', completed_at=?1, updated_at=?1, revision=revision+1 WHERE status='running' AND origin_device_id=?2",
                params![ts, device],
            )
        });
        history
    }

    fn connect(&self) -> rusqlite::Result<Connection> {
        let c = Connection::open(&self.path)?;
        c.busy_timeout(Duration::from_secs(5))?;
        c.pragma_update(None, "foreign_keys", "ON")?;
        c.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
        Ok(c)
    }

    fn record_failure(&self, err: &rusqlite::Error) {
        let msg = err.to_string().to_lowercase();
        if msg.contains("locked") || msg.contains("busy") {
            return; // transient contention: keep history alive, the next call retries
        }
        let fatal = CORRUPT_MARKERS.iter().any(|m| msg.contains(m));
        let mut h = self.health.lock();
        h.available = false;
        h.fatal = fatal;
        h.error_code = Some(if fatal { "history_corrupt" } else { "history_unavailable" });
    }

    fn initialize(&self) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let result = self.connect().and_then(|c| {
            c.execute_batch(SCHEMA)?;
            let ts = now();
            c.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?1, ?2)", params![SCHEMA_VERSION, ts])?;
            for (k, v) in [
                ("workspace_id", uuid::Uuid::new_v4().to_string()),
                ("origin_device_id", uuid::Uuid::new_v4().to_string()),
                ("created_at", ts.clone()),
                ("schema_version", SCHEMA_VERSION.to_string()),
            ] {
                c.execute("INSERT OR IGNORE INTO history_meta(key, value) VALUES (?1, ?2)", params![k, v])?;
            }
            let get = |k: &str| c.query_row("SELECT value FROM history_meta WHERE key=?1", [k], |r| r.get::<_, String>(0));
            Ok((get("workspace_id")?, get("origin_device_id")?))
        });
        match result {
            Ok((ws, dev)) => {
                let mut h = self.health.lock();
                *h = Health { available: true, error_code: None, fatal: false, workspace_id: ws, origin_device_id: dev };
            }
            Err(e) => {
                self.record_failure(&e);
                let mut h = self.health.lock();
                if h.available {
                    h.available = false;
                    h.error_code = Some("history_unavailable");
                }
            }
        }
    }

    /// True when history can serve now, re-opening after a non-fatal outage.
    fn ready(&self) -> bool {
        {
            let h = self.health.lock();
            if h.available {
                return true;
            }
            if h.fatal {
                return false;
            }
        }
        self.initialize();
        self.health.lock().available
    }

    fn with_db<T>(&self, op: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> Result<T, HistoryError> {
        if !self.ready() {
            return Err(HistoryError::Unavailable);
        }
        self.connect().and_then(|mut c| op(&mut c)).map_err(|e| {
            self.record_failure(&e);
            HistoryError::Unavailable
        })
    }

    pub fn is_available(&self) -> bool {
        self.health.lock().available
    }

    pub fn health(&self) -> Value {
        self.ready();
        let h = self.health.lock();
        json!({ "available": h.available, "error_code": h.error_code, "backup_available": self.backup_exists() })
    }

    fn backup_prefix(&self) -> String {
        format!("{}.backup-", self.path.file_name().unwrap_or_default().to_string_lossy())
    }

    fn backup_exists(&self) -> bool {
        let prefix = self.backup_prefix();
        let dir = self.path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
        std::fs::read_dir(dir).map_or(false, |entries| {
            entries.flatten().any(|e| {
                let n = e.file_name().to_string_lossy().into_owned();
                n.starts_with(&prefix) && n.ends_with(".db")
            })
        })
    }

    /// Move the current database aside as a backup and start a fresh schema.
    pub fn rebuild(&self) -> bool {
        if self.path.exists() {
            if let Ok(c) = self.connect() {
                let _ = c.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
            }
            let stamp = Utc::now().format("%Y%m%dT%H%M%SZ");
            let backup = PathBuf::from(format!("{}.backup-{stamp}.db", self.path.display()));
            if std::fs::rename(&self.path, &backup).is_err() {
                let mut h = self.health.lock();
                h.available = false;
                h.fatal = true;
                h.error_code = Some("history_corrupt");
                return false;
            }
            for suffix in ["-wal", "-shm"] {
                let sibling = PathBuf::from(format!("{}{suffix}", self.path.display()));
                if sibling.exists() {
                    let _ = std::fs::rename(&sibling, format!("{}{suffix}", backup.display()));
                }
            }
        }
        self.active.lock().clear();
        self.initialize();
        self.is_available()
    }

    pub fn start(&self, run: RunStart, steps: Vec<StepStart>) -> bool {
        let (ws, dev) = {
            let h = self.health.lock();
            (h.workspace_id.clone(), h.origin_device_id.clone())
        };
        let ts = now();
        let created = self.with_db(|c| {
            let tx = c.transaction()?;
            tx.execute(
                "INSERT INTO runs(id, workspace_id, project_id, project_name, origin_device_id, source_type, target_id, target_name, mode, status, label, is_pinned, started_at, config_snapshot_json, schema_version, revision, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'running', NULL, 0, ?10, ?11, ?12, 1, ?10, ?10)",
                params![run.id, ws, run.project_id, run.project_name, dev, run.source_type, run.target_id, run.target_name, run.mode, ts, run.config_snapshot.to_string(), SCHEMA_VERSION],
            )?;
            for s in &steps {
                tx.execute(
                    "INSERT INTO run_steps(run_id, sequence, endpoint_id, endpoint_name, method, url_template) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![run.id, s.sequence, s.endpoint_id, s.endpoint_name, s.method, s.url_template],
                )?;
            }
            tx.commit()
        });
        if created.is_err() {
            return false;
        }
        self.active.lock().insert(
            run.id,
            RunBuf {
                project_id: run.project_id,
                started: Instant::now(),
                steps: steps.iter().map(|s| (s.sequence, StepBuf::default())).collect(),
                samples: Vec::new(),
                events: Vec::new(),
                last_sample: None,
                next_sequence: 0,
            },
        );
        true
    }

    /// Record a step's cumulative counters (attempts, success, rate_limited, errors).
    pub fn record_stats(&self, run_id: &str, step: i64, stats: [i64; 4]) {
        let mut active = self.active.lock();
        let Some(buf) = active.get_mut(run_id) else { return };
        let elapsed = buf.started.elapsed().as_millis() as i64;
        let entry = buf.steps.entry(step).or_default();
        entry.stats = stats;
        let latency = entry.latencies.last().copied();
        let mut totals = [0i64; 4];
        for s in buf.steps.values() {
            for k in 0..4 {
                totals[k] += s.stats[k];
            }
        }
        let (last_elapsed, last_attempts) = buf.last_sample.unwrap_or((0, 0));
        let dt = elapsed - last_elapsed;
        let rps = if dt > 0 { (totals[0] - last_attempts) as f64 * 1000.0 / dt as f64 } else { 0.0 };
        let sample = Sample { sequence: buf.next_sequence, elapsed_ms: elapsed, stats: totals, rps, latency_ms: latency };
        buf.next_sequence += 1;
        push_downsampled(&mut buf.samples, sample, SAMPLE_CAP);
        buf.last_sample = Some((elapsed, totals[0]));
    }

    /// Record one response as a bounded, body-free event.
    pub fn record_response(&self, run_id: &str, step: i64, status: Option<u16>, latency_ms: Option<f64>, rate_limited: bool, success: bool, error: Option<&str>) {
        let mut active = self.active.lock();
        let Some(buf) = active.get_mut(run_id) else { return };
        let elapsed = buf.started.elapsed().as_millis() as i64;
        if let Some(l) = latency_ms {
            buf.steps.entry(step).or_default().latencies.push(l);
        }
        let outcome = if rate_limited || status == Some(429) {
            "rate_limited"
        } else if success || status.map_or(false, |s| (200..300).contains(&s)) {
            "success"
        } else {
            "error"
        };
        let event = Event {
            elapsed_ms: elapsed,
            outcome,
            status_code: status.map(i64::from),
            latency_ms,
            error_category: (outcome == "error").then(|| error_category(error)),
        };
        push_downsampled(&mut buf.events, event, EVENT_CAP);
    }

    pub fn finish_step(&self, run_id: &str, step: i64, status: &str) {
        let (metrics, statuses) = {
            let mut active = self.active.lock();
            let Some(buf) = active.get_mut(run_id) else { return };
            buf.steps.entry(step).or_default().status = Some(status.to_string());
            let statuses: Vec<Option<String>> = buf.steps.values().map(|s| s.status.clone()).collect();
            (metrics_of(buf, Some(step)), statuses)
        };
        let m = &metrics;
        let saved = self.with_db(|c| {
            c.execute(
                "UPDATE run_steps SET status=?1, attempts=?2, success=?3, rate_limited=?4, errors=?5, average_rps=?6, peak_rps=?7, min_latency_ms=?8, average_latency_ms=?9, p50_ms=?10, p95_ms=?11, p99_ms=?12, max_latency_ms=?13 WHERE run_id=?14 AND sequence=?15",
                params![status, m.stats[0], m.stats[1], m.stats[2], m.stats[3], m.average_rps, m.peak_rps, m.min, m.avg, m.p50, m.p95, m.p99, m.max, run_id, step],
            )
        });
        if saved.is_ok() && statuses.iter().all(|s| s.is_some()) {
            let has = |v: &str| statuses.iter().any(|s| s.as_deref() == Some(v));
            let final_status = if has("failed") { "failed" } else if has("stopped") { "stopped" } else { "completed" };
            self.finish_run(run_id, final_status);
        }
    }

    pub fn finish_run(&self, run_id: &str, status: &str) {
        let Some(buf) = self.active.lock().remove(run_id) else { return };
        let m = metrics_of(&buf, None);
        let ts = now();
        let saved = self.with_db(|c| {
            let tx = c.transaction()?;
            let started: Option<String> = tx
                .query_row("SELECT started_at FROM runs WHERE id=?1", [run_id], |r| r.get(0))
                .ok();
            let Some(started) = started else { return Ok(()) };
            let duration = DateTime::parse_from_rfc3339(&started)
                .map(|s| (Utc::now() - s.with_timezone(&Utc)).num_milliseconds().max(0))
                .ok();
            tx.execute(
                "UPDATE runs SET status=?1, completed_at=?2, duration_ms=?3, updated_at=?2, revision=revision+1 WHERE id=?4",
                params![status, ts, duration, run_id],
            )?;
            tx.execute(
                "INSERT INTO run_metrics VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(run_id) DO UPDATE SET attempts=excluded.attempts, success=excluded.success, rate_limited=excluded.rate_limited, errors=excluded.errors, average_rps=excluded.average_rps, peak_rps=excluded.peak_rps, min_latency_ms=excluded.min_latency_ms, average_latency_ms=excluded.average_latency_ms, p50_ms=excluded.p50_ms, p95_ms=excluded.p95_ms, p99_ms=excluded.p99_ms, max_latency_ms=excluded.max_latency_ms",
                params![run_id, m.stats[0], m.stats[1], m.stats[2], m.stats[3], m.average_rps, m.peak_rps, m.min, m.avg, m.p50, m.p95, m.p99, m.max],
            )?;
            tx.execute("DELETE FROM run_samples WHERE run_id=?1", [run_id])?;
            for s in &buf.samples {
                tx.execute(
                    "INSERT INTO run_samples VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![run_id, s.sequence, s.elapsed_ms, s.stats[0], s.stats[1], s.stats[2], s.stats[3], s.rps, s.latency_ms],
                )?;
            }
            tx.execute("DELETE FROM run_events WHERE run_id=?1", [run_id])?;
            for (i, e) in buf.events.iter().enumerate() {
                tx.execute(
                    "INSERT INTO run_events VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
                    params![run_id, i as i64, e.elapsed_ms, e.outcome, e.status_code, e.latency_ms, e.error_category],
                )?;
            }
            tx.commit()
        });
        if saved.is_ok() && status == "completed" {
            // Retention: keep the newest 100 unpinned runs per project.
            let _ = self.with_db(|c| {
                c.execute(
                    "DELETE FROM runs WHERE id IN (SELECT id FROM runs WHERE project_id=?1 AND is_pinned=0 ORDER BY started_at DESC, id DESC LIMIT -1 OFFSET 100)",
                    [&buf.project_id],
                )
            });
        }
    }

    pub fn list_runs(&self, filters: &HashMap<String, String>) -> Result<Value, HistoryError> {
        let mut clauses = vec!["r.deleted_at IS NULL".to_string()];
        let mut args: Vec<String> = Vec::new();
        for key in ["project_id", "mode", "status", "source_type"] {
            if let Some(v) = filters.get(key) {
                clauses.push(format!("r.{key}=?"));
                args.push(v.clone());
            }
        }
        if let Some(p) = filters.get("pinned").or_else(|| filters.get("is_pinned")) {
            clauses.push("r.is_pinned=?".into());
            args.push(if matches!(p.to_lowercase().as_str(), "true" | "1" | "yes" | "on") { "1" } else { "0" }.into());
        }
        if let Some(v) = filters.get("date_from").filter(|v| !v.is_empty()) {
            clauses.push("r.started_at>=?".into());
            args.push(v.clone());
        }
        if let Some(v) = filters.get("date_to").filter(|v| !v.is_empty()) {
            clauses.push("r.started_at<=?".into());
            args.push(v.clone());
        }
        if let Some(v) = filters.get("search").filter(|v| !v.is_empty()) {
            clauses.push("(r.target_name LIKE ? OR COALESCE(r.label, '') LIKE ? OR r.project_name LIKE ?)".into());
            args.extend(std::iter::repeat(format!("%{v}%")).take(3));
        }
        if let Some(cursor) = filters.get("cursor").filter(|v| !v.is_empty()) {
            let (started, id) = decode_cursor(cursor).ok_or(HistoryError::BadCursor)?;
            clauses.push("(r.started_at < ? OR (r.started_at = ? AND r.id < ?))".into());
            args.extend([started.clone(), started, id]);
        }
        let limit = filters.get("limit").and_then(|v| v.parse::<i64>().ok()).unwrap_or(30).clamp(1, 100);
        let sql = format!(
            "SELECT r.*, m.attempts, m.success, m.rate_limited, m.errors, m.average_rps, m.peak_rps, m.p50_ms, m.p95_ms, m.p99_ms
             FROM runs r LEFT JOIN run_metrics m ON m.run_id=r.id WHERE {} ORDER BY r.started_at DESC, r.id DESC LIMIT {}",
            clauses.join(" AND "),
            limit + 1
        );
        let mut rows = self.with_db(|c| query_maps(c, &sql, params_from_iter(args.iter())))?;
        let has_more = rows.len() as i64 > limit;
        rows.truncate(limit as usize);
        let next_cursor = rows.last().filter(|_| has_more).map(|r| {
            encode_cursor(r["started_at"].as_str().unwrap_or(""), r["id"].as_str().unwrap_or(""))
        });
        let items: Vec<Value> = rows.into_iter().map(|r| Value::Object(project_run(r))).collect();
        Ok(json!({ "items": items, "next_cursor": next_cursor }))
    }

    pub fn get_run(&self, run_id: &str) -> Result<Option<Value>, HistoryError> {
        self.with_db(|c| {
            let Some(run) = query_maps(c, "SELECT * FROM runs WHERE id=?1 AND deleted_at IS NULL", [run_id])?.pop() else {
                return Ok(None);
            };
            let mut result = project_run(run);
            let metrics = match query_maps(c, "SELECT * FROM run_metrics WHERE run_id=?1", [run_id])?.pop() {
                Some(mut m) => {
                    m.remove("run_id");
                    Value::Object(m)
                }
                None => json!({
                    "attempts": 0, "success": 0, "rate_limited": 0, "errors": 0, "average_rps": 0.0,
                    "peak_rps": 0.0, "min_latency_ms": null, "average_latency_ms": null, "p50_ms": null,
                    "p95_ms": null, "p99_ms": null, "max_latency_ms": null,
                }),
            };
            result.insert("metrics".into(), metrics);
            for (key, table) in [("steps", "run_steps"), ("samples", "run_samples"), ("events", "run_events")] {
                let rows = query_maps(c, &format!("SELECT * FROM {table} WHERE run_id=?1 ORDER BY sequence"), [run_id])?;
                let rows: Vec<Value> = rows
                    .into_iter()
                    .map(|mut r| {
                        r.remove("run_id");
                        Value::Object(r)
                    })
                    .collect();
                result.insert(key.into(), Value::Array(rows));
            }
            Ok(Some(Value::Object(result)))
        })
    }

    pub fn update_run(&self, run_id: &str, label: Option<&str>, is_pinned: Option<bool>) -> Result<bool, HistoryError> {
        let mut sets = Vec::new();
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(l) = label {
            sets.push("label=?");
            args.push(l.chars().take(120).collect::<String>().into());
        }
        if let Some(p) = is_pinned {
            sets.push("is_pinned=?");
            args.push((p as i64).into());
        }
        if sets.is_empty() {
            return Ok(false);
        }
        sets.extend(["updated_at=?", "revision=revision+1"]);
        args.push(now().into());
        args.push(run_id.to_string().into());
        let sql = format!("UPDATE runs SET {} WHERE id=?", sets.join(", "));
        self.with_db(|c| c.execute(&sql, params_from_iter(args.iter()))).map(|n| n > 0)
    }

    pub fn delete_run(&self, run_id: &str) -> Result<bool, HistoryError> {
        self.with_db(|c| c.execute("DELETE FROM runs WHERE id=?1", [run_id])).map(|n| n > 0)
    }
}

// ---------------------------------------------------------------- compare --

fn delta(metric: &str, base: &Value, cand: &Value) -> Value {
    let (Some(b), Some(c)) = (base.as_f64(), cand.as_f64()) else {
        return json!({ "value": cand, "change": null, "percent_change": null, "improved": null });
    };
    let change = c - b;
    let lower = ["min_latency_ms", "average_latency_ms", "p50_ms", "p95_ms", "p99_ms", "max_latency_ms", "errors", "rate_limited"];
    let higher = ["success", "average_rps", "peak_rps", "rps"];
    let improved = if lower.contains(&metric) {
        json!(change < 0.0)
    } else if higher.contains(&metric) {
        json!(change > 0.0)
    } else {
        Value::Null
    };
    let percent = if b != 0.0 { json!(change / b * 100.0) } else { Value::Null };
    // Integer metrics stay integers, like Python's int arithmetic.
    let change = if base.is_i64() && cand.is_i64() { json!(change as i64) } else { json!(change) };
    json!({ "value": cand, "change": change, "percent_change": percent, "improved": improved })
}

fn align_series(base: &[Value], cand: &[Value]) -> Vec<Value> {
    let elapsed = |s: &Value| s["elapsed_ms"].as_i64().unwrap_or(0);
    if base.is_empty() || cand.is_empty() {
        return Vec::new();
    }
    let mut base = base.to_vec();
    let mut cand = cand.to_vec();
    base.sort_by_key(elapsed);
    cand.sort_by_key(elapsed);
    let (b_end, c_end) = (elapsed(base.last().unwrap()), elapsed(cand.last().unwrap()));
    let cutoff = b_end.min(c_end);
    let nearest = |samples: &[Value], at: i64, field: &str| {
        samples.iter().filter(|s| elapsed(s) <= at).last().map_or(Value::Null, |s| s[field].clone())
    };
    let source = if b_end <= c_end { &base } else { &cand };
    source
        .iter()
        .map(elapsed)
        .take_while(|&e| e <= cutoff)
        .map(|e| {
            json!({
                "elapsed_ms": e,
                "baseline_rps": nearest(&base, e, "instantaneous_rps"),
                "candidate_rps": nearest(&cand, e, "instantaneous_rps"),
                "baseline_latency_ms": nearest(&base, e, "latency_ms"),
                "candidate_latency_ms": nearest(&cand, e, "latency_ms"),
            })
        })
        .collect()
}

pub fn compare_details(baseline: Value, candidate: Value) -> Value {
    let empty = Map::new();
    let obj = |v: &Value, k: &str| v.get(k).and_then(|x| x.as_object()).cloned().unwrap_or_else(|| empty.clone());
    let (bm, cm) = (obj(&baseline, "metrics"), obj(&candidate, "metrics"));
    let mut deltas = Map::new();
    for k in bm.keys().chain(cm.keys()).collect::<std::collections::BTreeSet<_>>() {
        if k != "run_id" {
            deltas.insert(k.clone(), delta(k, bm.get(k).unwrap_or(&Value::Null), cm.get(k).unwrap_or(&Value::Null)));
        }
    }
    let (bc, cc) = (obj(&baseline, "config_snapshot"), obj(&candidate, "config_snapshot"));
    let mut changes = Map::new();
    for k in bc.keys().chain(cc.keys()).collect::<std::collections::BTreeSet<_>>() {
        let (b, c) = (bc.get(k).unwrap_or(&Value::Null), cc.get(k).unwrap_or(&Value::Null));
        if b != c {
            changes.insert(k.clone(), json!({ "baseline": b, "candidate": c }));
        }
    }
    let arr = |v: &Value| v["samples"].as_array().cloned().unwrap_or_default();
    let series = align_series(&arr(&baseline), &arr(&candidate));
    json!({
        "same_mode": baseline["mode"] == candidate["mode"],
        "deltas": deltas,
        "config_changes": changes,
        "series": series,
        "baseline": baseline,
        "candidate": candidate,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downsample_keeps_newest_and_cursor_roundtrips() {
        let mut v = Vec::new();
        for i in 0..10 {
            push_downsampled(&mut v, i, 4);
        }
        assert!(v.len() <= 5 && *v.last().unwrap() == 9);
        let c = encode_cursor("2026-01-01T00:00:00+00:00", "abc");
        assert_eq!(decode_cursor(&c), Some(("2026-01-01T00:00:00+00:00".into(), "abc".into())));
        assert_eq!(decode_cursor("!!"), None);
    }
}
