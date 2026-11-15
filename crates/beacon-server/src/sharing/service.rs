//! Local application boundary for shared projects (port of `sharing/service.py`).
//! Host-side: enable/disable/status/members. Member-side: join, push/pull,
//! watch, conflict resolution against a fingerprint-pinned remote host.
use super::host::{self, LanHost, MIN_SHARING_PROTOCOL_VERSION, SHARING_PROTOCOL_VERSION};
use super::privacy::{localize_snapshot, sanitize_project_source, set_path, three_way_merge};
use super::repository::{self, Actor, RepoError, Repository};
use super::tls;
use axum::http::StatusCode;
use chrono::{SecondsFormat, Utc};
use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false)
}

/// Failure talking to a remote host; mirrors `requests.RequestException` handling.
#[derive(Debug)]
pub struct PeerError {
    pub status: Option<u16>,
    pub detail: Value,
    pub identity: bool,
}

impl PeerError {
    fn new(detail: impl Into<String>) -> Self {
        Self { status: None, detail: json!(detail.into()), identity: false }
    }
    fn identity(detail: impl Into<String>) -> Self {
        Self { status: None, detail: json!(detail.into()), identity: true }
    }
    pub fn message(&self) -> String {
        match &self.detail {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    }
    pub fn http_status(&self) -> StatusCode {
        StatusCode::BAD_GATEWAY
    }
    pub fn user_detail(&self) -> String {
        if self.status.is_some() || self.identity { self.message() } else { format!("Could not connect to that Beacon host ({})", self.message()) }
    }
}

impl From<reqwest::Error> for PeerError {
    fn from(e: reqwest::Error) -> Self {
        let msg = e.to_string();
        Self { status: None, detail: json!(msg.clone()), identity: msg.contains("fingerprint") || msg.contains("certificate") }
    }
}

async fn checked(resp: reqwest::Response) -> Result<Value, PeerError> {
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(body);
    }
    let detail = body.get("detail").cloned().filter(|d| !d.is_null()).unwrap_or_else(|| json!(format!("Beacon host returned HTTP {}", status.as_u16())));
    Err(PeerError { status: Some(status.as_u16()), detail, identity: false })
}

pub struct SharingService {
    pub repo: Repository,
    pub host: Arc<LanHost>,
    pub device_id: String,
    pending_fingerprints: Mutex<HashMap<String, String>>,
    /// Repo revision the hosting project was last reconciled with (see sync_host_project).
    host_synced_revision: Mutex<i64>,
    pub init_error: Option<String>,
}

impl SharingService {
    pub fn new(data_dir: &Path) -> Self {
        let repo = Repository::new(data_dir.join("workspace.db"));
        let init_error = repo.initialize().err().map(|e| e.message());
        // Host sessions are intentionally ephemeral and never survive an app
        // restart. The owner must explicitly expose the project again.
        let _ = repo.disable_all_sharing();
        let device_id = repo.device_id(data_dir);
        let identity = tls::ensure_device_certificate(&data_dir.join("sharing-identity"));
        let host = Arc::new(LanHost::new(repo.clone(), identity, device_id.clone()));
        Self { repo, host, device_id, pending_fingerprints: Mutex::new(HashMap::new()), host_synced_revision: Mutex::new(0), init_error }
    }

    pub fn data_dir(&self) -> PathBuf {
        self.repo.path.parent().map(Path::to_path_buf).unwrap_or_default()
    }

    fn local_actor(&self) -> Actor {
        Actor { device_id: self.device_id.clone(), device_name: Some(host::hostname()), device_ip: Some(host::local_ip_address()) }
    }

    // ---- host side -----------------------------------------------------

    pub async fn enable(&self, project: &Value) -> Result<Value, (StatusCode, String)> {
        let project_id = project["id"].as_str().unwrap_or("").to_string();
        self.repo.import_project(project, &self.device_id).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.message()))?;
        let status = self.repo.set_sharing_enabled(&project_id, true).map_err(|e| (StatusCode::NOT_FOUND, e.message()))?;
        *self.host_synced_revision.lock() = status["revision"].as_i64().unwrap_or(0);
        let name = project["name"].as_str().unwrap_or("Shared project");
        self.host.start(&project_id, name).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        Ok(self.merge_host(status, &project_id))
    }

    pub fn disable(&self, project_id: &str) -> Result<Value, (StatusCode, String)> {
        if self.host.hosted_project_id().as_deref() == Some(project_id) {
            self.host.stop();
        }
        let status = self.repo.set_sharing_enabled(project_id, false).map_err(|e| (StatusCode::NOT_FOUND, e.message()))?;
        Ok(self.merge_host(status, project_id))
    }

    fn merge_host(&self, mut status: Value, project_id: &str) -> Value {
        let host = self.host.status();
        let hosted = host["project_id"].as_str();
        status["host"] = if hosted.is_none() || hosted == Some(project_id) { host } else { json!({"hosting": false}) };
        status
    }

    /// Sharing status for a project: hosted (repo-backed) or joined (`shared_origin`).
    pub fn status(&self, project_id: &str, project: Option<&Value>) -> Option<Value> {
        let repo_status = self.repo.status(project_id).ok().flatten();
        let Some(mut status) = repo_status else {
            let origin = project.and_then(|p| p.get("shared_origin")).filter(|o| o.is_object())?;
            return Some(json!({
                "project_id": project_id, "sharing_enabled": true, "revision": origin["revision"],
                "member": {
                    "role": origin["role"], "host_address": origin["host_address"],
                    "connection_state": origin.get("connection_state").cloned().unwrap_or(json!("connected")),
                    "sync_error": origin["sync_error"], "conflict": origin["conflict"],
                    "last_seen_at": origin["last_seen_at"], "offline_since": origin["offline_since"],
                    "retry_count": origin.get("retry_count").cloned().unwrap_or(json!(0)),
                    "discovered_at": origin["discovered_at"],
                    "certificate_fingerprint": tls::format_fingerprint(origin["certificate_fingerprint"].as_str().unwrap_or("")),
                },
                "host": {"hosting": false},
            }));
        };
        status["trusted_devices"] = json!(self.repo.trusted_devices(project_id).unwrap_or_default());
        Some(self.merge_host(status, project_id))
    }

    pub fn refresh_pairing_code(&self, project_id: &str) -> Result<Value, (StatusCode, String)> {
        self.require_hosted(project_id)?;
        self.host.refresh_pairing_code().map_err(|e| (StatusCode::NOT_FOUND, e))
    }

    fn require_hosted(&self, project_id: &str) -> Result<(), (StatusCode, String)> {
        if self.host.hosted_project_id().as_deref() != Some(project_id) {
            return Err((StatusCode::NOT_FOUND, "Project is not currently hosted".into()));
        }
        Ok(())
    }

    pub fn update_member(&self, project_id: &str, device_id: &str, role: &str) -> Result<Value, (StatusCode, String)> {
        self.require_hosted(project_id)?;
        if role != "viewer" && role != "editor" {
            return Err((StatusCode::BAD_REQUEST, "Role must be viewer or editor".into()));
        }
        let trusted = self.repo.update_trusted_device_role(project_id, device_id, role).unwrap_or(false);
        match self.host.update_member(device_id, role) {
            Some(v) => Ok(v),
            None if trusted => Ok(json!({"device_id": device_id, "role": role, "connected": false})),
            None => Err((StatusCode::NOT_FOUND, "Connected member not found".into())),
        }
    }

    pub fn remove_member(&self, project_id: &str, device_id: &str) -> Result<Value, (StatusCode, String)> {
        self.require_hosted(project_id)?;
        let trusted = self.repo.revoke_trusted_device(project_id, device_id).unwrap_or(false);
        match self.host.remove_member(device_id) {
            Some(v) => Ok(v),
            None if trusted => Ok(json!({"device_id": device_id, "removed": true, "connected": false})),
            None => Err((StatusCode::NOT_FOUND, "Connected member not found".into())),
        }
    }

    /// Reconcile the hosted project with the canonical repo source. Returns the
    /// replacement project when teammates changed it; records local edits otherwise.
    // shortcut: the host only publishes local edits when the UI polls /sync (every ~1.5s)
    // instead of on every save; upgrade to a Store save hook if edits must be instant.
    pub fn sync_host_project(&self, project: &Value) -> Option<Value> {
        let project_id = project["id"].as_str().unwrap_or("");
        if self.host.hosted_project_id().as_deref() != Some(project_id) {
            return None;
        }
        let status = self.repo.status(project_id).ok().flatten()?;
        if !status["sharing_enabled"].as_bool().unwrap_or(false) {
            return None;
        }
        let snapshot = self.repo.snapshot(project_id).ok().flatten()?;
        let revision = snapshot["revision"].as_i64().unwrap_or(0);
        let source = sanitize_project_source(project);
        if snapshot["source"] == source {
            *self.host_synced_revision.lock() = revision;
            return None;
        }
        let last = *self.host_synced_revision.lock();
        if revision > last {
            // Teammates moved the canonical source: adopt it locally.
            *self.host_synced_revision.lock() = revision;
            let mut updated = localize_snapshot(&snapshot["source"], Some(project));
            if let Some(n) = project.get("notifications").filter(|n| !n.is_null()) {
                updated["notifications"] = n.clone();
            }
            return Some(updated);
        }
        let payload: Map<String, Value> = source.as_object().cloned().unwrap_or_default().into_iter().filter(|(k, _)| k != "id").collect();
        let mutation = repository::Mutation {
            mutation_id: uuid::Uuid::new_v4().to_string(),
            project_id: project_id.to_string(),
            base_revision: revision,
            operation: "project.updated".into(),
            target_id: Some(project_id.to_string()),
            payload,
        };
        let summary = repository::change_summary(&snapshot["source"], &source);
        if let Ok(rev) = self.repo.apply_mutation(&mutation, &self.local_actor(), &summary) {
            *self.host_synced_revision.lock() = rev.revision;
            self.host.notify_revision();
        }
        None
    }

    pub fn revisions_after(&self, project_id: &str, after: i64) -> Result<Vec<repository::Revision>, RepoError> {
        self.repo.revisions_after(project_id, after)
    }

    // ---- member side ---------------------------------------------------

    fn clean_address(address: &str) -> String {
        address.trim().trim_start_matches("http://").trim_start_matches("https://").trim_end_matches('/').to_string()
    }

    async fn read_fingerprint(address: &str) -> Result<String, PeerError> {
        tls::remote_fingerprint(address).await.map_err(|e| if e.contains("TLS") { PeerError::identity(e) } else { PeerError::new(e) })
    }

    pub async fn request_join(&self, address: &str, code: &str, device_name: &str) -> Result<Value, PeerError> {
        let address = Self::clean_address(address);
        let fingerprint = Self::read_fingerprint(&address).await?;
        let client = tls::pinned_client(&fingerprint).map_err(PeerError::new)?;
        let info = checked(client.get(format!("https://{address}/beacon-share/info")).timeout(Duration::from_secs(4)).send().await?).await?;
        let host_protocol = info["protocol"].as_i64().unwrap_or(1);
        let host_minimum = info["min_protocol"].as_i64().unwrap_or(host_protocol);
        if host_protocol < MIN_SHARING_PROTOCOL_VERSION || SHARING_PROTOCOL_VERSION < host_minimum {
            return Err(PeerError { status: Some(400), identity: false, detail: json!(format!(
                "Update required: host uses sharing protocol {host_protocol}, this Beacon uses protocol {SHARING_PROTOCOL_VERSION}. Install compatible Beacon versions on both devices."
            )) });
        }
        let advertised = tls::normalize_fingerprint(info["certificate_fingerprint"].as_str().unwrap_or(""));
        if !advertised.is_empty() && advertised != fingerprint {
            return Err(PeerError::identity("Host certificate fingerprint did not match its advertised identity"));
        }
        let mut body = json!({"project_id": info["project_id"], "code": code, "device_id": self.device_id, "device_name": device_name});
        body.as_object_mut().unwrap().extend(host::local_client_info());
        let pairing = checked(client.post(format!("https://{address}/beacon-share/pair")).timeout(Duration::from_secs(6)).json(&body).send().await?).await?;
        let request_id = pairing["request_id"].as_str().unwrap_or("").to_string();
        self.pending_fingerprints.lock().insert(request_id.clone(), fingerprint.clone());
        Ok(json!({
            "address": address, "request_id": request_id, "status": pairing["status"],
            "project_name": pairing.get("project_name").filter(|v| !v.is_null()).cloned().unwrap_or_else(|| info["project_name"].clone()),
            "certificate_fingerprint": tls::format_fingerprint(&fingerprint),
        }))
    }

    /// Poll the pairing decision. On approval returns `{"status": "approved", "project": {...}}`.
    pub async fn complete_join(&self, address: &str, request_id: &str) -> Result<Value, PeerError> {
        let address = Self::clean_address(address);
        let fingerprint = Self::read_fingerprint(&address).await?;
        let expected = self.pending_fingerprints.lock().get(request_id).cloned();
        if expected.as_deref() != Some(fingerprint.as_str()) {
            return Err(PeerError { status: Some(400), identity: true, detail: json!("Host identity changed while pairing; start again") });
        }
        let client = tls::pinned_client(&fingerprint).map_err(PeerError::new)?;
        let paired = checked(client.get(format!("https://{address}/beacon-share/pair/{request_id}")).timeout(Duration::from_secs(4)).send().await?).await?;
        if paired["status"] != "approved" {
            return Ok(json!({"status": paired.get("status").cloned().unwrap_or(json!("pending"))}));
        }
        let snapshot = &paired["snapshot"];
        let source = &snapshot["source"];
        if !source.is_object() {
            return Err(PeerError { status: Some(400), identity: false, detail: json!("Host returned an invalid project snapshot") });
        }
        let mut joined = localize_snapshot(source, None);
        joined["shared_origin"] = json!({
            "host_address": address, "host_device_id": paired["host_device_id"],
            "role": paired.get("role").cloned().unwrap_or(json!("viewer")), "revision": snapshot["revision"],
            "session_token": paired["session_token"], "trusted_credential": paired["trusted_credential"],
            "certificate_fingerprint": fingerprint, "connection_state": "connected",
            "last_synced_source": sanitize_project_source(source), "last_seen_at": now_iso(),
            "offline_since": null, "retry_count": 0,
        });
        Ok(json!({"status": "approved", "project": joined}))
    }

    fn mark_connected(origin: &mut Value) {
        origin["connection_state"] = json!("connected");
        origin["sync_error"] = Value::Null;
        origin["last_seen_at"] = json!(now_iso());
        origin["offline_since"] = Value::Null;
        origin["retry_count"] = json!(0);
    }

    fn mark_offline(origin: &mut Value, error: &PeerError) {
        let state = if error.identity { "identity_changed" } else if error.status == Some(401) { "access_expired" } else { "host_offline" };
        origin["connection_state"] = json!(state);
        origin["sync_error"] = json!(error.message());
        if origin["offline_since"].is_null() {
            origin["offline_since"] = json!(now_iso());
        }
        origin["retry_count"] = json!(origin["retry_count"].as_i64().unwrap_or(0) + 1);
    }

    fn pinned(origin: &Value) -> Result<(reqwest::Client, String), PeerError> {
        let fingerprint = tls::normalize_fingerprint(origin["certificate_fingerprint"].as_str().unwrap_or(""));
        if fingerprint.is_empty() {
            return Err(PeerError::identity("This shared project has no pinned host fingerprint; pair again"));
        }
        let client = tls::pinned_client(&fingerprint).map_err(PeerError::new)?;
        let base = format!("https://{}", origin["host_address"].as_str().unwrap_or(""));
        Ok((client, base))
    }

    fn auth(origin: &Value) -> String {
        format!("Bearer {}", origin["session_token"].as_str().unwrap_or(""))
    }

    fn payload_without_id(source: &Value) -> Value {
        Value::Object(source.as_object().cloned().unwrap_or_default().into_iter().filter(|(k, _)| k != "id").collect())
    }

    fn adopt_source(project: &mut Value, source: &Value) {
        let localized = localize_snapshot(source, Some(project));
        if let (Some(po), Some(lo)) = (project.as_object_mut(), localized.as_object()) {
            for (k, v) in lo {
                if k != "shared_origin" {
                    po.insert(k.clone(), v.clone());
                }
            }
        }
    }

    async fn reconnect_if_trusted(&self, project: &mut Value, error: &PeerError, adopt_snapshot: bool) -> bool {
        if error.status != Some(401) {
            return false;
        }
        let origin = project["shared_origin"].clone();
        let Some(credential) = origin["trusted_credential"].as_str().filter(|c| !c.is_empty()).map(str::to_string) else { return false };
        let Ok((client, base)) = Self::pinned(&origin) else { return false };
        let mut body = json!({"project_id": project["id"], "device_id": self.device_id, "trusted_credential": credential});
        body.as_object_mut().unwrap().extend(host::local_client_info());
        let result: Result<Value, PeerError> = async {
            checked(client.post(format!("{base}/beacon-share/reconnect")).timeout(Duration::from_secs(4)).json(&body).send().await?).await
        }
        .await;
        let Ok(data) = result else { return false };
        let source = data["snapshot"]["source"].clone();
        if adopt_snapshot && source.is_object() {
            Self::adopt_source(project, &source);
        }
        let origin = &mut project["shared_origin"];
        origin["session_token"] = data["session_token"].clone();
        if !data["role"].is_null() {
            origin["role"] = data["role"].clone();
        }
        if !data["snapshot"]["revision"].is_null() {
            origin["revision"] = data["snapshot"]["revision"].clone();
        }
        if source.is_object() {
            origin["last_synced_source"] = sanitize_project_source(&source);
        }
        Self::mark_connected(origin);
        true
    }

    /// Locate this shared project on the LAN via UDP broadcast; updates `host_address` on success.
    pub async fn discover_host(&self, project: &mut Value) -> bool {
        let origin = project["shared_origin"].clone();
        if origin["trusted_credential"].as_str().unwrap_or("").is_empty() {
            return false;
        }
        let Ok(socket) = tokio::net::UdpSocket::bind("0.0.0.0:0").await else { return false };
        let _ = socket.set_broadcast(true);
        let query = json!({"type": "beacon-project-discovery", "project_id": project["id"], "device_id": self.device_id}).to_string();
        for target in [("255.255.255.255", host::DISCOVERY_PORT), ("127.0.0.1", host::DISCOVERY_PORT)] {
            let _ = socket.send_to(query.as_bytes(), target).await;
        }
        let deadline = tokio::time::Instant::now() + Duration::from_millis(800);
        let mut buf = [0u8; 4096];
        while let Ok(Ok((n, sender))) = tokio::time::timeout_at(deadline, socket.recv_from(&mut buf)).await {
            let Ok(answer) = serde_json::from_slice::<Value>(&buf[..n]) else { continue };
            if answer["type"] != "beacon-project-host" || answer["project_id"] != project["id"] {
                continue;
            }
            let discovered = tls::normalize_fingerprint(answer["certificate_fingerprint"].as_str().unwrap_or(""));
            let expected = tls::normalize_fingerprint(origin["certificate_fingerprint"].as_str().unwrap_or(""));
            let o = &mut project["shared_origin"];
            if expected.is_empty() || discovered != expected {
                o["connection_state"] = json!("identity_changed");
                o["sync_error"] = json!("A host answered for this project, but its certificate fingerprint changed");
                return false;
            }
            o["host_address"] = json!(format!("{}:{}", sender.ip(), answer["port"].as_u64().unwrap_or(0)));
            o["discovered_at"] = json!(now_iso());
            if !answer["host_device_id"].is_null() {
                o["host_device_id"] = answer["host_device_id"].clone();
            }
            return true;
        }
        false
    }

    /// Push local edits to the host. Returns true when the project changed (merge adopted) or synced.
    pub async fn push_if_joined(&self, project: &mut Value) -> bool {
        if !project["shared_origin"].is_object() {
            return false;
        }
        let source = sanitize_project_source(project);
        let origin_snapshot = project["shared_origin"].clone();
        let (client, base) = match Self::pinned(&origin_snapshot) {
            Ok(v) => v,
            Err(e) => {
                Self::mark_offline(&mut project["shared_origin"], &e);
                return false;
            }
        };
        let base = format!("{base}/beacon-share/projects/{}", project["id"].as_str().unwrap_or(""));
        let auth = Self::auth(&origin_snapshot);
        let result: Result<bool, PeerError> = async {
            let remote = checked(client.get(format!("{base}/snapshot")).header("authorization", &auth).timeout(Duration::from_secs(3)).send().await?).await?;
            if remote["source"] == source {
                let origin = &mut project["shared_origin"];
                Self::mark_connected(origin);
                origin["revision"] = remote["revision"].clone();
                origin["last_synced_source"] = source.clone();
                return Ok(false);
            }
            if origin_snapshot["role"] != "editor" {
                let origin = &mut project["shared_origin"];
                origin["connection_state"] = json!("read_only");
                origin["sync_error"] = json!("Viewer role cannot edit shared source");
                return Ok(false);
            }
            let payload = json!({
                "mutation_id": uuid::Uuid::new_v4().to_string(), "base_revision": origin_snapshot["revision"].as_i64().unwrap_or(0),
                "operation": "project.updated", "target_id": project["id"], "payload": Self::payload_without_id(&source),
                "summary": format!("Updated {}", project["name"].as_str().unwrap_or("project")),
            });
            let response = client.post(format!("{base}/mutations")).header("authorization", &auth).timeout(Duration::from_secs(5)).json(&payload).send().await?;
            if response.status() == reqwest::StatusCode::CONFLICT {
                let detail = response.json::<Value>().await.unwrap_or(Value::Null)["detail"].clone();
                let team_source = detail["latest_entity"].clone();
                let base_source = if origin_snapshot["last_synced_source"].is_object() { origin_snapshot["last_synced_source"].clone() } else { remote["source"].clone() };
                let (merged, fields) = three_way_merge(Some(&base_source), Some(&team_source), Some(&source), &[]);
                let merged_source = merged.unwrap_or(Value::Null);
                if fields.is_empty() {
                    let merged_payload = json!({
                        "mutation_id": uuid::Uuid::new_v4().to_string(), "base_revision": detail["current_revision"].as_i64().unwrap_or(0),
                        "operation": "project.updated", "target_id": project["id"], "payload": Self::payload_without_id(&merged_source),
                        "summary": format!("Auto-merged non-overlapping changes from {}", host::hostname()),
                    });
                    let merged_resp = checked(client.post(format!("{base}/mutations")).header("authorization", &auth).timeout(Duration::from_secs(5)).json(&merged_payload).send().await?).await?;
                    // Make the in-memory project match the canonical merge so
                    // the subsequent save persists both teammates' edits.
                    Self::adopt_source(project, &merged_source);
                    let origin = &mut project["shared_origin"];
                    origin["revision"] = merged_resp["revision"].clone();
                    Self::mark_connected(origin);
                    origin["conflict"] = Value::Null;
                    origin["last_synced_source"] = merged_source;
                    return Ok(true);
                }
                let origin = &mut project["shared_origin"];
                origin["connection_state"] = json!("conflict");
                origin["sync_error"] = json!("Team source changed before this edit could sync");
                origin["conflict"] = json!({
                    "current_revision": detail["current_revision"], "local_source": source, "team_source": team_source,
                    "base_source": base_source, "merged_source": merged_source, "fields": fields, "detected_at": now_iso(),
                });
                return Ok(false);
            }
            let data = checked(response).await?;
            let origin = &mut project["shared_origin"];
            Self::mark_connected(origin);
            origin["revision"] = data["revision"].clone();
            origin["conflict"] = Value::Null;
            origin["last_synced_source"] = source.clone();
            Ok(true)
        }
        .await;
        match result {
            Ok(changed) => changed,
            Err(e) => {
                if self.reconnect_if_trusted(project, &e, false).await {
                    return Box::pin(self.push_if_joined(project)).await;
                }
                Self::mark_offline(&mut project["shared_origin"], &e);
                false
            }
        }
    }

    /// Pull a newer snapshot from the host. Returns true when the project was replaced.
    pub async fn pull_if_joined(&self, project: &mut Value) -> bool {
        let origin_snapshot = project["shared_origin"].clone();
        if !origin_snapshot.is_object() || origin_snapshot["conflict"].is_object() {
            return false;
        }
        let (client, base) = match Self::pinned(&origin_snapshot) {
            Ok(v) => v,
            Err(e) => {
                Self::mark_offline(&mut project["shared_origin"], &e);
                return false;
            }
        };
        let base = format!("{base}/beacon-share/projects/{}", project["id"].as_str().unwrap_or(""));
        let auth = Self::auth(&origin_snapshot);
        let result: Result<bool, PeerError> = async {
            let after = origin_snapshot["revision"].as_i64().unwrap_or(0);
            let revisions = checked(client.get(format!("{base}/revisions")).query(&[("after", after)]).header("authorization", &auth).timeout(Duration::from_secs(3)).send().await?).await?;
            if revisions["items"].as_array().map(Vec::is_empty).unwrap_or(true) {
                Self::mark_connected(&mut project["shared_origin"]);
                return Ok(false);
            }
            let snapshot = checked(client.get(format!("{base}/snapshot")).header("authorization", &auth).timeout(Duration::from_secs(3)).send().await?).await?;
            Self::adopt_source(project, &snapshot["source"]);
            let origin = &mut project["shared_origin"];
            origin["revision"] = snapshot["revision"].clone();
            origin["last_synced_source"] = sanitize_project_source(&snapshot["source"]);
            Self::mark_connected(origin);
            Ok(true)
        }
        .await;
        match result {
            Ok(changed) => changed,
            Err(e) => {
                if self.reconnect_if_trusted(project, &e, true).await {
                    return true;
                }
                Self::mark_offline(&mut project["shared_origin"], &e);
                false
            }
        }
    }

    /// Wait for the host to announce a revision, then pull its snapshot.
    pub async fn watch_updates(&self, project: &mut Value, timeout: f64, presence: &[(&str, Option<String>)], allow_discovery: bool) -> bool {
        let origin_snapshot = project["shared_origin"].clone();
        if !origin_snapshot.is_object() || origin_snapshot["conflict"].is_object() {
            return false;
        }
        let (client, base) = match Self::pinned(&origin_snapshot) {
            Ok(v) => v,
            Err(e) => {
                if allow_discovery && self.discover_host(project).await {
                    return Box::pin(self.watch_updates(project, timeout, presence, false)).await;
                }
                Self::mark_offline(&mut project["shared_origin"], &e);
                return false;
            }
        };
        let base = format!("{base}/beacon-share/projects/{}", project["id"].as_str().unwrap_or(""));
        let mut query: Vec<(String, String)> = vec![("after".into(), origin_snapshot["revision"].as_i64().unwrap_or(0).to_string()), ("timeout".into(), timeout.to_string())];
        for (k, v) in presence {
            if let Some(v) = v {
                query.push((k.to_string(), v.clone()));
            }
        }
        let result: Result<Option<bool>, PeerError> = async {
            let events = checked(
                client.get(format!("{base}/events")).query(&query).header("authorization", Self::auth(&origin_snapshot)).timeout(Duration::from_secs_f64(timeout + 3.0)).send().await?,
            )
            .await?;
            Self::mark_connected(&mut project["shared_origin"]);
            Ok(events["items"].as_array().map(|a| !a.is_empty()).unwrap_or(false).then_some(true))
        }
        .await;
        match result {
            Ok(Some(_)) => self.pull_if_joined(project).await,
            Ok(None) => false,
            Err(e) => {
                if self.reconnect_if_trusted(project, &e, true).await {
                    return true;
                }
                if allow_discovery && self.discover_host(project).await {
                    return Box::pin(self.watch_updates(project, timeout, presence, false)).await;
                }
                Self::mark_offline(&mut project["shared_origin"], &e);
                false
            }
        }
    }

    pub async fn resolve_conflict(&self, project: &mut Value, resolution: &str, choices: Option<&Value>) -> Result<(), (StatusCode, String)> {
        let origin = project["shared_origin"].clone();
        let conflict = origin["conflict"].clone();
        if !conflict.is_object() {
            return Err((StatusCode::BAD_REQUEST, "This project has no unresolved sharing conflict".into()));
        }
        let team_source = conflict["team_source"].clone();
        let local_source = conflict["local_source"].clone();
        let revision = conflict["current_revision"].as_i64().unwrap_or(0);
        if resolution == "team" {
            if !team_source.is_object() {
                return Err((StatusCode::BAD_REQUEST, "Team source is unavailable; sync again".into()));
            }
            Self::adopt_source(project, &team_source);
            let o = &mut project["shared_origin"];
            o["revision"] = json!(revision);
            o["connection_state"] = json!("connected");
            o["sync_error"] = Value::Null;
            o["conflict"] = Value::Null;
            o["last_synced_source"] = team_source;
            return Ok(());
        }
        if resolution != "mine" && resolution != "merge" {
            return Err((StatusCode::BAD_REQUEST, "Resolution must be team, mine, or merge".into()));
        }
        if origin["role"] != "editor" || !local_source.is_object() {
            return Err((StatusCode::BAD_REQUEST, "Local source cannot be applied with this role".into()));
        }
        let mut resolved = local_source;
        if resolution == "merge" {
            resolved = conflict["merged_source"].clone();
            if !resolved.is_object() {
                return Err((StatusCode::BAD_REQUEST, "Merged source is unavailable".into()));
            }
            let fields = conflict["fields"].as_array().cloned().unwrap_or_default();
            let choice = |label: &str| choices.and_then(|c| c.get(label)).and_then(Value::as_str).map(str::to_string);
            if fields.iter().any(|f| !matches!(choice(f["label"].as_str().unwrap_or("")).as_deref(), Some("team") | Some("mine"))) {
                return Err((StatusCode::BAD_REQUEST, "Choose team or mine for every conflicting field".into()));
            }
            for f in &fields {
                let label = f["label"].as_str().unwrap_or("");
                let selected = if choice(label).as_deref() == Some("team") { f["team_value"].clone() } else { f["local_value"].clone() };
                let path = f["path"].as_array().cloned().unwrap_or_default();
                set_path(&mut resolved, &path, selected).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
            }
        }
        let (client, base) = Self::pinned(&origin).map_err(|e| (StatusCode::BAD_GATEWAY, e.message()))?;
        let payload = json!({
            "mutation_id": uuid::Uuid::new_v4().to_string(), "base_revision": revision, "operation": "project.updated",
            "target_id": project["id"], "payload": Self::payload_without_id(&resolved),
            "summary": format!("Resolved conflict from {} ({resolution})", host::hostname()),
        });
        let url = format!("{base}/beacon-share/projects/{}/mutations", project["id"].as_str().unwrap_or(""));
        let response: Result<Value, PeerError> = async {
            checked(client.post(url).header("authorization", Self::auth(&origin)).timeout(Duration::from_secs(5)).json(&payload).send().await?).await
        }
        .await;
        let data = response.map_err(|e| (StatusCode::BAD_GATEWAY, format!("Could not reach sharing host: {}", e.message())))?;
        Self::adopt_source(project, &resolved);
        let o = &mut project["shared_origin"];
        o["revision"] = data["revision"].clone();
        o["connection_state"] = json!("connected");
        o["sync_error"] = Value::Null;
        o["conflict"] = Value::Null;
        o["last_synced_source"] = resolved;
        Ok(())
    }
}
