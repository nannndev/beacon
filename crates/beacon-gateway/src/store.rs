use crate::cipher::Cipher;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const KEY_PREFIX: &str = "gw-sk-";

fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

pub fn hash_key(secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountRecord {
    pub id: String,
    pub provider: String,
    pub label: Option<String>,
    pub email: Option<String>,
    pub connected_at: f64,
    pub refreshed_at: Option<f64>,
    pub last_error: Option<String>,
    pub sort_order: i64,
    pub cred: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderRecord {
    pub id: String,
    pub enabled: bool,
    pub base_url: Option<String>,
    pub default_model: Option<String>,
    pub models: Vec<String>,
    pub verified_at: Option<f64>,
    pub latency_ms: Option<i64>,
    pub error: Option<String>,
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualKeyRecord {
    pub id: String,
    pub name: String,
    pub key_prefix: String,
    pub enabled: bool,
    pub allowed_providers: Option<Vec<String>>,
    pub rate_limit_per_min: Option<i64>,
    pub created_at: f64,
    pub last_used_at: Option<f64>,
    pub total_requests: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewaySettings {
    pub routing_strategy: String,
    pub gemini_oauth_client_id: String,
    pub gemini_oauth_client_secret_masked: Option<String>,
    pub gemini_oauth_configured: bool,
}

pub struct GatewayStore {
    conn: Arc<Mutex<Connection>>,
    pub cipher: Cipher,
    pub directory: PathBuf,
}

impl GatewayStore {
    pub fn new<P: AsRef<Path>>(directory: P) -> Result<Self, String> {
        let dir = directory.as_ref();
        let _ = fs::create_dir_all(dir);
        let db_path = dir.join("gateway.db");
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open gateway.db: {}", e))?;

        let cipher = Cipher::new(dir)?;
        let store = Self {
            conn: Arc::new(Mutex::new(conn)),
            cipher,
            directory: dir.to_path_buf(),
        };
        store.init_tables()?;
        Ok(store)
    }

    fn init_tables(&self) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS keys (
              id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
              key_prefix TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
              allowed_providers TEXT, rate_limit_per_min INTEGER,
              created_at REAL NOT NULL, last_used_at REAL,
              total_requests INTEGER NOT NULL DEFAULT 0,
              total_input_tokens INTEGER NOT NULL DEFAULT 0,
              total_output_tokens INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS providers (
              id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,
              api_key TEXT, base_url TEXT, default_model TEXT, models TEXT,
              verified_at REAL, latency_ms INTEGER, error TEXT
            );
            CREATE TABLE IF NOT EXISTS combos (name TEXT PRIMARY KEY, targets TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS usage (
              id TEXT PRIMARY KEY, ts REAL NOT NULL, key_id TEXT, key_name TEXT,
              provider TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
              duration_ms INTEGER, status TEXT, status_code INTEGER, error TEXT, streaming INTEGER
            );
            CREATE INDEX IF NOT EXISTS usage_ts ON usage(ts);
            CREATE TABLE IF NOT EXISTS accounts (
              id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT, email TEXT,
              connected_at REAL NOT NULL, refreshed_at REAL, last_error TEXT,
              sort_order INTEGER NOT NULL DEFAULT 0, secret TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS accounts_provider ON accounts(provider, sort_order);
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY, value TEXT NOT NULL
            );
            "#,
        )
        .map_err(|e| format!("Failed to init gateway schema: {}", e))?;
        Ok(())
    }

    // ---- Accounts (OAuth) -------------------------------------------
    pub fn list_accounts(&self) -> Vec<AccountRecord> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT id, provider, label, email, connected_at, refreshed_at, last_error, sort_order, secret FROM accounts ORDER BY provider, sort_order, connected_at")
            .unwrap();

        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let provider: String = row.get(1)?;
                let label: Option<String> = row.get(2)?;
                let email: Option<String> = row.get(3)?;
                let connected_at: f64 = row.get(4)?;
                let refreshed_at: Option<f64> = row.get(5)?;
                let last_error: Option<String> = row.get(6)?;
                let sort_order: i64 = row.get(7)?;
                let secret: String = row.get(8)?;
                Ok((id, provider, label, email, connected_at, refreshed_at, last_error, sort_order, secret))
            })
            .unwrap();

        let mut out = Vec::new();
        for item in rows.flatten() {
            let (id, provider, label, email, connected_at, refreshed_at, last_error, sort_order, secret) = item;
            let cred = if let Ok(dec) = self.cipher.decrypt(&secret) {
                serde_json::from_str::<Value>(&dec).unwrap_or(json!({}))
            } else {
                json!({})
            };
            out.push(AccountRecord {
                id,
                provider,
                label,
                email,
                connected_at,
                refreshed_at,
                last_error,
                sort_order,
                cred,
            });
        }
        out
    }

    pub fn save_account(&self, provider: &str, cred: &Value, label: Option<&str>, email: Option<&str>) -> Result<String, String> {
        let cred_str = serde_json::to_string(cred).map_err(|e| e.to_string())?;
        let encrypted = self.cipher.encrypt(&cred_str)?;
        let id = Uuid::new_v4().to_string();
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO accounts (id, provider, label, email, connected_at, secret) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, provider, label, email, now(), encrypted],
        )
        .map_err(|e| format!("Failed to insert account: {}", e))?;
        Ok(id)
    }

    pub fn remove_account(&self, provider: &str, account_id: Option<&str>) -> Result<bool, String> {
        let conn = self.conn.lock();
        let rows = if let Some(id) = account_id {
            conn.execute("DELETE FROM accounts WHERE provider = ?1 AND id = ?2", params![provider, id])
        } else {
            conn.execute("DELETE FROM accounts WHERE provider = ?1", params![provider])
        }
        .map_err(|e| e.to_string())?;
        Ok(rows > 0)
    }

    // ---- Providers (API Keys) ---------------------------------------
    pub fn list_providers(&self) -> Vec<ProviderRecord> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT id, enabled, api_key, base_url, default_model, models, verified_at, latency_ms, error FROM providers")
            .unwrap();

        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let enabled: bool = row.get(1)?;
                let api_key: Option<String> = row.get(2)?;
                let base_url: Option<String> = row.get(3)?;
                let default_model: Option<String> = row.get(4)?;
                let models_json: Option<String> = row.get(5)?;
                let verified_at: Option<f64> = row.get(6)?;
                let latency_ms: Option<i64> = row.get(7)?;
                let error: Option<String> = row.get(8)?;

                let models = models_json
                    .and_then(|j| serde_json::from_str::<Vec<String>>(&j).ok())
                    .unwrap_or_default();

                Ok(ProviderRecord {
                    id,
                    enabled,
                    base_url,
                    default_model,
                    models,
                    verified_at,
                    latency_ms,
                    error,
                    has_key: api_key.is_some() && !api_key.unwrap().is_empty(),
                })
            })
            .unwrap();

        rows.flatten().collect()
    }

    pub fn save_provider_key(&self, provider_id: &str, raw_key: &str) -> Result<(), String> {
        let encrypted = self.cipher.encrypt(raw_key)?;
        let conn = self.conn.lock();
        conn.execute(
            r#"
            INSERT INTO providers (id, api_key, enabled) VALUES (?1, ?2, 1)
            ON CONFLICT(id) DO UPDATE SET api_key = ?2, enabled = 1
            "#,
            params![provider_id, encrypted],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_provider_key(&self, provider_id: &str) -> Option<String> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT api_key FROM providers WHERE id = ?1")
            .ok()?;
        let enc: Option<String> = stmt.query_row(params![provider_id], |r| r.get(0)).ok()?;
        enc.and_then(|blob| self.cipher.decrypt(&blob).ok())
    }

    // ---- Combos -----------------------------------------------------
    pub fn list_combos(&self) -> HashMap<String, Vec<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT name, targets FROM combos").unwrap();
        let rows = stmt
            .query_map([], |row| {
                let name: String = row.get(0)?;
                let targets_json: String = row.get(1)?;
                let targets: Vec<String> = serde_json::from_str(&targets_json).unwrap_or_default();
                Ok((name, targets))
            })
            .unwrap();

        let mut out = HashMap::new();
        for item in rows.flatten() {
            out.insert(item.0, item.1);
        }
        out
    }

    pub fn save_combo(&self, name: &str, targets: &[String]) -> Result<(), String> {
        let targets_json = serde_json::to_string(targets).map_err(|e| e.to_string())?;
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO combos (name, targets) VALUES (?1, ?2)",
            params![name, targets_json],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_combo(&self, name: &str) -> Result<bool, String> {
        let conn = self.conn.lock();
        let count = conn
            .execute("DELETE FROM combos WHERE name = ?1", params![name])
            .map_err(|e| e.to_string())?;
        Ok(count > 0)
    }

    // ---- Account Reordering ----------------------------------------
    pub fn reorder_accounts(&self, provider: &str, account_ids: &[String]) -> Result<(), String> {
        let conn = self.conn.lock();
        for (i, id) in account_ids.iter().enumerate() {
            let _ = conn.execute(
                "UPDATE accounts SET sort_order = ?1 WHERE provider = ?2 AND id = ?3",
                params![i as i64, provider, id],
            );
        }
        Ok(())
    }

    // ---- Provider Connect / Disconnect -----------------------------
    pub fn connect_provider(&self, provider_id: &str, api_key: &str, base_url: Option<&str>) -> Result<(), String> {
        let encrypted = self.cipher.encrypt(api_key)?;
        let conn = self.conn.lock();
        conn.execute(
            r#"
            INSERT INTO providers (id, api_key, base_url, enabled, verified_at)
            VALUES (?1, ?2, ?3, 1, ?4)
            ON CONFLICT(id) DO UPDATE SET api_key = ?2, base_url = coalesce(?3, base_url), enabled = 1, verified_at = ?4
            "#,
            params![provider_id, encrypted, base_url, now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn disconnect_provider(&self, provider_id: &str) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE providers SET api_key = NULL, enabled = 0 WHERE id = ?1",
            params![provider_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ---- Virtual Keys ----------------------------------------------
    pub fn list_virtual_keys(&self) -> Vec<VirtualKeyRecord> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT id, name, key_prefix, enabled, allowed_providers, rate_limit_per_min, created_at, last_used_at, total_requests, total_input_tokens, total_output_tokens FROM keys ORDER BY created_at DESC")
            .unwrap();
        let rows = stmt
            .query_map([], |r| {
                let allowed_providers_json: Option<String> = r.get(4)?;
                let allowed_providers = allowed_providers_json.and_then(|j| serde_json::from_str(&j).ok());
                Ok(VirtualKeyRecord {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    key_prefix: r.get(2)?,
                    enabled: r.get::<_, i64>(3)? != 0,
                    allowed_providers,
                    rate_limit_per_min: r.get(5)?,
                    created_at: r.get(6)?,
                    last_used_at: r.get(7)?,
                    total_requests: r.get(8)?,
                    total_input_tokens: r.get(9)?,
                    total_output_tokens: r.get(10)?,
                })
            })
            .unwrap();
        rows.flatten().collect()
    }

    pub fn create_virtual_key(
        &self,
        name: &str,
        allowed_providers: Option<Vec<String>>,
        rate_limit_per_min: Option<i64>,
    ) -> Result<(VirtualKeyRecord, String), String> {
        let id = Uuid::new_v4().to_string();
        let random_hex: String = (0..32).map(|_| format!("{:x}", rand::random::<u8>() % 16)).collect();
        let secret = format!("{}{}", KEY_PREFIX, random_hex);
        let key_hash = hash_key(&secret);
        let key_prefix = format!("{}...", &secret[..std::cmp::min(12, secret.len())]);
        let created_at = now();
        let allowed_json = allowed_providers.as_ref().and_then(|p| serde_json::to_string(p).ok());

        let conn = self.conn.lock();
        conn.execute(
            r#"
            INSERT INTO keys (id, name, key_hash, key_prefix, enabled, allowed_providers, rate_limit_per_min, created_at)
            VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7)
            "#,
            params![id, name, key_hash, key_prefix, allowed_json, rate_limit_per_min, created_at],
        )
        .map_err(|e| e.to_string())?;

        let record = VirtualKeyRecord {
            id,
            name: name.to_string(),
            key_prefix,
            enabled: true,
            allowed_providers,
            rate_limit_per_min,
            created_at,
            last_used_at: None,
            total_requests: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
        };
        Ok((record, secret))
    }

    pub fn toggle_virtual_key(&self, id: &str) -> Result<VirtualKeyRecord, String> {
        let conn = self.conn.lock();
        conn.execute("UPDATE keys SET enabled = 1 - enabled WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        drop(conn);
        self.list_virtual_keys()
            .into_iter()
            .find(|k| k.id == id)
            .ok_or_else(|| "Key not found".to_string())
    }

    pub fn delete_virtual_key(&self, id: &str) -> Result<bool, String> {
        let conn = self.conn.lock();
        let rows = conn.execute("DELETE FROM keys WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        Ok(rows > 0)
    }

    // ---- Settings --------------------------------------------------
    pub fn get_setting(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1").ok()?;
        stmt.query_row(params![key], |r| r.get(0)).ok()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_gateway_settings(&self) -> GatewaySettings {
        let strategy = self.get_setting("routing_strategy").unwrap_or_else(|| "ordered".to_string());
        let client_id = self.get_setting("gemini_oauth_client_id").unwrap_or_default();
        let client_secret = self.get_setting("gemini_oauth_client_secret");
        let secret_masked = client_secret.as_ref().filter(|s| !s.is_empty()).map(|s| {
            if s.len() > 4 {
                format!("••••{}", &s[s.len() - 4..])
            } else {
                "••••".to_string()
            }
        });
        let configured = !client_id.is_empty() && client_secret.is_some();
        GatewaySettings {
            routing_strategy: if strategy == "round_robin" { "round_robin".to_string() } else { "ordered".to_string() },
            gemini_oauth_client_id: client_id,
            gemini_oauth_client_secret_masked: secret_masked,
            gemini_oauth_configured: configured,
        }
    }

    // ---- Usage & Stats ---------------------------------------------
    pub fn list_usage(&self, limit: i64) -> Vec<Value> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT id, ts, key_id, key_name, provider, model, input_tokens, output_tokens, duration_ms, status, status_code, error, streaming FROM usage ORDER BY ts DESC LIMIT ?1")
            .unwrap();
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "ts": r.get::<_, f64>(1)?,
                    "key_id": r.get::<_, Option<String>>(2)?,
                    "key_name": r.get::<_, Option<String>>(3)?,
                    "provider": r.get::<_, Option<String>>(4)?,
                    "model": r.get::<_, Option<String>>(5)?,
                    "input_tokens": r.get::<_, Option<i64>>(6)?.unwrap_or(0),
                    "output_tokens": r.get::<_, Option<i64>>(7)?.unwrap_or(0),
                    "duration_ms": r.get::<_, Option<i64>>(8)?.unwrap_or(0),
                    "status": r.get::<_, Option<String>>(9)?.unwrap_or_else(|| "ok".to_string()),
                    "status_code": r.get::<_, Option<i64>>(10)?.unwrap_or(200),
                    "error": r.get::<_, Option<String>>(11)?,
                    "streaming": r.get::<_, Option<i64>>(12)?.unwrap_or(0) != 0,
                }))
            })
            .unwrap();
        rows.flatten().collect()
    }

    pub fn clear_usage(&self) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM usage", []).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_stats(&self) -> Value {
        let conn = self.conn.lock();
        let mut stats = json!({
            "requests": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "errors": 0,
            "active_keys": 0,
            "connected_providers": 0,
        });

        let _ = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(CASE WHEN status != 'ok' OR status_code >= 400 THEN 1 ELSE 0 END), 0) FROM usage",
            [],
            |r| {
                stats["requests"] = json!(r.get::<_, i64>(0)?);
                stats["input_tokens"] = json!(r.get::<_, i64>(1)?);
                stats["output_tokens"] = json!(r.get::<_, i64>(2)?);
                stats["errors"] = json!(r.get::<_, i64>(3)?);
                Ok(())
            },
        );

        let active_keys: i64 = conn
            .query_row("SELECT COUNT(*) FROM keys WHERE enabled = 1", [], |r| r.get(0))
            .unwrap_or(0);
        stats["active_keys"] = json!(active_keys);

        let mut connected_count: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT id) FROM providers WHERE api_key IS NOT NULL AND api_key != '' AND enabled = 1",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let accounts_count: i64 = conn
            .query_row("SELECT COUNT(DISTINCT provider) FROM accounts", [], |r| r.get(0))
            .unwrap_or(0);
        connected_count += accounts_count;
        stats["connected_providers"] = json!(connected_count);

        stats
    }
}
