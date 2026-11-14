//! Project-scoped LAN host (port of `sharing/lan_host.py`): HTTPS with the
//! device identity cert, pairing codes, member sessions, long-poll revision
//! events and UDP discovery. It exposes no ordinary Beacon routes.
use super::repository::{self, Actor, RepoError, Repository};
use super::tls::{self, DeviceIdentity};
use axum::{
    extract::{Extension, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::{get, post},
    Router,
};
use parking_lot::Mutex;
use rand::Rng;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Notify;

pub const PAIRING_TTL_SECONDS: f64 = 300.0;
pub const DEFAULT_SHARE_PORT: u16 = 47821;
pub const DISCOVERY_PORT: u16 = 47820;
pub const SHARING_PROTOCOL_VERSION: i64 = 2;
pub const MIN_SHARING_PROTOCOL_VERSION: i64 = 2;
pub const SHARING_CAPABILITIES: [&str; 5] = ["live_revision_events", "conflict_resolution", "device_presence", "trusted_reconnect", "lan_discovery"];

pub type ApiError = (StatusCode, Json<Value>);

pub fn err(status: StatusCode, detail: impl Into<Value>) -> ApiError {
    (status, Json(json!({ "detail": detail.into() })))
}

pub fn now_secs() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

pub fn hostname() -> String {
    #[cfg(unix)]
    {
        let mut buf = [0u8; 256];
        // SAFETY: buffer is valid for its length; gethostname NUL-terminates on success.
        if unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) } == 0 {
            let end = buf.iter().position(|b| *b == 0).unwrap_or(buf.len());
            let name = String::from_utf8_lossy(&buf[..end]).to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "Beacon device".into())
}

pub fn local_ip_address() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| s.connect("8.8.8.8:80").and_then(|_| s.local_addr()))
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".into())
}

pub fn local_client_info() -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("app_version".into(), json!(std::env::var("BEACON_APP_VERSION").unwrap_or_else(|_| "dev".into())));
    m.insert("platform".into(), json!(std::env::consts::OS));
    m.insert("protocol".into(), json!(SHARING_PROTOCOL_VERSION));
    m.insert("min_protocol".into(), json!(MIN_SHARING_PROTOCOL_VERSION));
    m.insert("capabilities".into(), json!(SHARING_CAPABILITIES));
    m
}

pub fn new_pairing_code() -> String {
    format!("{:06}", rand::thread_rng().gen_range(0..1_000_000u32))
}

pub fn random_token() -> String {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    hex::encode(bytes)
}

pub fn sha256_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

fn constant_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[derive(Default)]
struct Running {
    project_id: String,
    project_name: String,
    port: u16,
    pairing_code: String,
    pairing_expires_at: f64,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

#[derive(Default)]
pub struct HostState {
    running: Option<Running>,
    /// session token -> member record
    sessions: HashMap<String, Value>,
    /// request id -> pending pairing request
    pending: HashMap<String, Value>,
}

pub struct LanHost {
    pub repo: Repository,
    pub identity: Option<DeviceIdentity>,
    pub identity_error: Option<String>,
    pub device_id: String,
    state: Mutex<HostState>,
    pub revision_notify: Notify,
}

impl LanHost {
    pub fn new(repo: Repository, identity: Result<DeviceIdentity, String>, device_id: String) -> Self {
        let (identity, identity_error) = match identity {
            Ok(i) => (Some(i), None),
            Err(e) => (None, Some(e)),
        };
        Self { repo, identity, identity_error, device_id, state: Mutex::new(HostState::default()), revision_notify: Notify::new() }
    }

    pub fn certificate_fingerprint(&self) -> String {
        self.identity.as_ref().map(|i| i.fingerprint.clone()).unwrap_or_default()
    }

    pub fn hosted_project_id(&self) -> Option<String> {
        self.state.lock().running.as_ref().map(|r| r.project_id.clone())
    }

    pub fn hosted_port(&self) -> Option<u16> {
        self.state.lock().running.as_ref().map(|r| r.port)
    }

    pub fn pairing_code(&self) -> Option<String> {
        self.state.lock().running.as_ref().map(|r| r.pairing_code.clone())
    }

    pub fn notify_revision(&self) {
        self.revision_notify.notify_waiters();
    }

    pub fn status(&self) -> Value {
        let st = self.state.lock();
        let now = now_secs();
        let members: Vec<Value> = st
            .sessions
            .values()
            .map(|m| {
                let mut m = m.clone();
                let seen = m.get("last_seen").and_then(Value::as_f64).unwrap_or(0.0);
                m["connection_state"] = json!(if now - seen <= 8.0 { "online" } else { "offline" });
                m
            })
            .collect();
        let pending: Vec<Value> = st
            .pending
            .iter()
            .filter(|(_, r)| r["status"] == "pending")
            .map(|(id, r)| {
                let mut r = r.clone();
                r["request_id"] = json!(id);
                r
            })
            .collect();
        let r = st.running.as_ref();
        let ip = local_ip_address();
        json!({
            "hosting": r.is_some(),
            "project_id": r.map(|r| r.project_id.clone()),
            "project_name": r.map(|r| r.project_name.clone()),
            "host_device_name": hostname(),
            "host_device_id": self.device_id,
            "host_device_ip": ip,
            "certificate_fingerprint": tls::format_fingerprint(&self.certificate_fingerprint()),
            "address": r.map(|r| format!("{ip}:{}", r.port)),
            "pairing_code": r.map(|r| r.pairing_code.clone()),
            "pairing_expires_at": r.map(|r| r.pairing_expires_at),
            "connected_members": members,
            "pending_requests": pending,
            "transport": r.map(|_| "https-pinned"),
        })
    }

    pub async fn start(self: &Arc<Self>, project_id: &str, project_name: &str) -> Result<Value, String> {
        if let Some(current) = self.hosted_project_id() {
            if current != project_id {
                return Err("Another project is already hosted by this Beacon instance".into());
            }
            return self.refresh_pairing_code();
        }
        let identity = self.identity.as_ref().ok_or_else(|| self.identity_error.clone().unwrap_or_else(|| "Sharing identity unavailable".into()))?;
        let server_config = Arc::new(tls::server_config(identity)?);
        let preferred: u16 = std::env::var("BEACON_SHARE_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(DEFAULT_SHARE_PORT);
        let listener = match tokio::net::TcpListener::bind(("0.0.0.0", preferred)).await {
            Ok(l) => l,
            Err(_) => tokio::net::TcpListener::bind(("0.0.0.0", 0)).await.map_err(|e| e.to_string())?,
        };
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let acceptor = tokio_rustls::TlsAcceptor::from(server_config);
        let router = share_router(Arc::clone(self));
        let serve = tokio::spawn(async move {
            loop {
                let Ok((stream, addr)) = listener.accept().await else { continue };
                let acceptor = acceptor.clone();
                let app = router.clone().layer(Extension(addr));
                tokio::spawn(async move {
                    let Ok(tls) = acceptor.accept(stream).await else { return };
                    let svc = hyper_util::service::TowerToHyperService::new(app);
                    let _ = hyper_util::server::conn::auto::Builder::new(hyper_util::rt::TokioExecutor::new())
                        .serve_connection_with_upgrades(hyper_util::rt::TokioIo::new(tls), svc)
                        .await;
                });
            }
        });
        let mut tasks = vec![serve];
        if let Some(discovery) = self.start_discovery(project_id, project_name, port).await {
            tasks.push(discovery);
        }
        let mut st = self.state.lock();
        st.running = Some(Running {
            project_id: project_id.into(),
            project_name: project_name.into(),
            port,
            pairing_code: new_pairing_code(),
            pairing_expires_at: now_secs() + PAIRING_TTL_SECONDS,
            tasks,
        });
        drop(st);
        Ok(self.status())
    }

    async fn start_discovery(self: &Arc<Self>, project_id: &str, project_name: &str, port: u16) -> Option<tokio::task::JoinHandle<()>> {
        let socket = socket2::reuse_udp(DISCOVERY_PORT).ok()?;
        let socket = tokio::net::UdpSocket::from_std(socket).ok()?;
        let (project_id, project_name, device_id, fp) = (project_id.to_string(), project_name.to_string(), self.device_id.clone(), self.certificate_fingerprint());
        Some(tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            loop {
                let Ok((n, sender)) = socket.recv_from(&mut buf).await else { break };
                let Ok(msg) = serde_json::from_slice::<Value>(&buf[..n]) else { continue };
                if msg["type"] != "beacon-project-discovery" || msg["project_id"] != project_id.as_str() {
                    continue;
                }
                let answer = json!({
                    "type": "beacon-project-host", "project_id": project_id, "project_name": project_name,
                    "host_device_id": device_id, "port": port, "certificate_fingerprint": fp,
                });
                let _ = socket.send_to(answer.to_string().as_bytes(), sender).await;
            }
        }))
    }

    pub fn stop(&self) {
        let mut st = self.state.lock();
        if let Some(r) = st.running.take() {
            for t in r.tasks {
                t.abort();
            }
        }
        st.sessions.clear();
        st.pending.clear();
    }

    pub fn refresh_pairing_code(&self) -> Result<Value, String> {
        {
            let mut st = self.state.lock();
            let r = st.running.as_mut().ok_or("LAN host is not running")?;
            r.pairing_code = new_pairing_code();
            r.pairing_expires_at = now_secs() + PAIRING_TTL_SECONDS;
        }
        Ok(self.status())
    }

    pub fn decide_pairing(&self, request_id: &str, approved: bool, role: &str) -> Result<Value, ApiError> {
        if role != "viewer" && role != "editor" {
            return Err(err(StatusCode::BAD_REQUEST, "Role must be viewer or editor"));
        }
        let mut st = self.state.lock();
        let project_id = st.running.as_ref().map(|r| r.project_id.clone());
        let request = st.pending.get_mut(request_id).ok_or_else(|| err(StatusCode::NOT_FOUND, "Pairing request not found"))?;
        if !approved {
            request["status"] = json!("rejected");
            return Ok(json!({"request_id": request_id, "status": "rejected"}));
        }
        let token = random_token();
        let trusted_credential = random_token();
        request["status"] = json!("approved");
        request["role"] = json!(role);
        request["session_token"] = json!(token);
        request["trusted_credential"] = json!(trusted_credential);
        let member = json!({
            "device_id": request["device_id"], "device_name": request["device_name"], "device_ip": request["device_ip"],
            "created_at": request["created_at"], "last_seen": now_secs(), "connection_state": "online", "role": role,
            "app_version": request["app_version"], "platform": request["platform"], "protocol": request["protocol"],
            "capabilities": request["capabilities"],
        });
        st.sessions.insert(token, member.clone());
        drop(st);
        if let Some(pid) = project_id {
            let _ = self.repo.trust_device(&pid, &member, &sha256_hex(&trusted_credential));
        }
        Ok(json!({"request_id": request_id, "status": "approved", "role": role}))
    }

    pub fn update_member(&self, device_id: &str, role: &str) -> Option<Value> {
        let mut st = self.state.lock();
        let mut found = false;
        for m in st.sessions.values_mut().filter(|m| m["device_id"] == device_id) {
            m["role"] = json!(role);
            found = true;
        }
        found.then(|| json!({"device_id": device_id, "role": role}))
    }

    pub fn remove_member(&self, device_id: &str) -> Option<Value> {
        let mut st = self.state.lock();
        let before = st.sessions.len();
        st.sessions.retain(|_, m| m["device_id"] != device_id);
        (st.sessions.len() != before).then(|| json!({"device_id": device_id, "removed": true}))
    }

    fn session(&self, headers: &HeaderMap) -> Result<Value, ApiError> {
        let token = headers.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or("").trim_start_matches("Bearer ").trim().to_string();
        let mut st = self.state.lock();
        let member = st.sessions.get_mut(&token).ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Invalid sharing session"))?;
        member["last_seen"] = json!(now_secs());
        member["connection_state"] = json!("online");
        Ok(member.clone())
    }

    fn touch_member(&self, headers: &HeaderMap, patch: Value) {
        let token = headers.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or("").trim_start_matches("Bearer ").trim().to_string();
        if let Some(m) = self.state.lock().sessions.get_mut(&token) {
            if let (Some(mo), Some(po)) = (m.as_object_mut(), patch.as_object()) {
                for (k, v) in po {
                    mo.insert(k.clone(), v.clone());
                }
            }
        }
    }
}

/// Minimal SO_REUSEADDR UDP bind so a restarted host can reclaim the discovery port.
mod socket2 {
    pub fn reuse_udp(port: u16) -> std::io::Result<std::net::UdpSocket> {
        let socket = std::net::UdpSocket::bind(("0.0.0.0", port))?;
        socket.set_nonblocking(true)?;
        Ok(socket)
    }
}

type HostRef = Arc<LanHost>;

fn share_router(host: HostRef) -> Router {
    Router::new()
        .route("/beacon-share/info", get(info))
        .route("/beacon-share/pair", post(pair))
        .route("/beacon-share/pair/:request_id", get(pairing_status))
        .route("/beacon-share/reconnect", post(reconnect))
        .route("/beacon-share/projects/:project_id/snapshot", get(snapshot))
        .route("/beacon-share/projects/:project_id/revisions", get(revisions))
        .route("/beacon-share/projects/:project_id/events", get(events))
        .route("/beacon-share/projects/:project_id/mutations", post(mutations))
        .with_state(host)
}

fn merged(mut a: Value, b: Map<String, Value>) -> Value {
    if let Some(o) = a.as_object_mut() {
        o.extend(b);
    }
    a
}

async fn info(State(host): State<HostRef>) -> Json<Value> {
    Json(merged(host.status(), local_client_info()))
}

fn check_project(host: &LanHost, project_id: &str) -> Result<(), ApiError> {
    if host.hosted_project_id().as_deref() != Some(project_id) {
        return Err(err(StatusCode::NOT_FOUND, "Shared project not found"));
    }
    Ok(())
}

async fn pair(State(host): State<HostRef>, Extension(addr): Extension<SocketAddr>, Json(data): Json<Value>) -> Result<Json<Value>, ApiError> {
    let project_id = data["project_id"].as_str().unwrap_or("").to_string();
    check_project(&host, &project_id)?;
    let (code, expires, project_name) = {
        let st = host.state.lock();
        let r = st.running.as_ref().ok_or_else(|| err(StatusCode::NOT_FOUND, "Shared project not found"))?;
        (r.pairing_code.clone(), r.pairing_expires_at, r.project_name.clone())
    };
    if code.is_empty() || now_secs() >= expires {
        return Err(err(StatusCode::GONE, "Pairing code expired"));
    }
    if !constant_eq(data["code"].as_str().unwrap_or(""), &code) {
        return Err(err(StatusCode::FORBIDDEN, "Invalid pairing code"));
    }
    let request_id = uuid::Uuid::new_v4().to_string();
    let trunc = |v: &Value, n: usize, d: &str| v.as_str().filter(|s| !s.is_empty()).unwrap_or(d).chars().take(n).collect::<String>();
    let request = json!({
        "device_id": trunc(&data["device_id"], 200, "unknown"),
        "device_name": trunc(&data["device_name"], 80, "Beacon device"),
        "device_ip": addr.ip().to_string(),
        "created_at": now_secs(), "status": "pending", "role": null,
        "app_version": trunc(&data["app_version"], 32, "unknown"),
        "platform": trunc(&data["platform"], 32, "unknown"),
        "protocol": data["protocol"].as_i64().unwrap_or(1),
        "capabilities": data["capabilities"].as_array().map(|a| a.iter().take(32).map(|c| json!(c.as_str().unwrap_or(""))).collect::<Vec<_>>()).unwrap_or_default(),
    });
    host.state.lock().pending.insert(request_id.clone(), request);
    Ok(Json(json!({"request_id": request_id, "status": "pending", "project_name": project_name})))
}

async fn pairing_status(State(host): State<HostRef>, Path(request_id): Path<String>) -> Result<Json<Value>, ApiError> {
    let (request, project_id) = {
        let st = host.state.lock();
        let r = st.pending.get(&request_id).cloned().ok_or_else(|| err(StatusCode::NOT_FOUND, "Pairing request not found"))?;
        (r, st.running.as_ref().map(|r| r.project_id.clone()).unwrap_or_default())
    };
    if request["status"] != "approved" {
        return Ok(Json(json!({"status": request["status"]})));
    }
    let snapshot = host.repo.snapshot(&project_id).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.message()))?;
    Ok(Json(merged(
        json!({
            "status": "approved", "session_token": request["session_token"], "role": request["role"],
            "host_device_id": host.device_id, "trusted_credential": request["trusted_credential"], "snapshot": snapshot,
        }),
        local_client_info(),
    )))
}

async fn reconnect(State(host): State<HostRef>, Extension(addr): Extension<SocketAddr>, Json(data): Json<Value>) -> Result<Json<Value>, ApiError> {
    let project_id = data["project_id"].as_str().unwrap_or("").to_string();
    check_project(&host, &project_id)?;
    let device_id = data["device_id"].as_str().unwrap_or("").to_string();
    let credential = data["trusted_credential"].as_str().unwrap_or("");
    let trusted = host.repo.trusted_device(&project_id, &device_id).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.message()))?;
    let trusted = match trusted {
        Some(t) if constant_eq(&sha256_hex(credential), t["credential_hash"].as_str().unwrap_or("")) => t,
        _ => return Err(err(StatusCode::UNAUTHORIZED, "Trusted device credential is invalid")),
    };
    let token = random_token();
    let pick = |k: &str| data[k].as_str().filter(|s| !s.is_empty()).map(str::to_string).or_else(|| trusted[k].as_str().map(str::to_string)).unwrap_or_else(|| "unknown".into());
    let member = json!({
        "device_id": device_id, "device_name": trusted["device_name"], "device_ip": addr.ip().to_string(),
        "created_at": now_secs(), "last_seen": now_secs(), "connection_state": "online", "role": trusted["role"],
        "app_version": pick("app_version"), "platform": pick("platform"),
        "protocol": data["protocol"].as_i64().or_else(|| trusted["protocol"].as_i64()).unwrap_or(1),
        "capabilities": data["capabilities"].as_array().map(|a| a.iter().take(32).cloned().collect::<Vec<_>>()).unwrap_or_default(),
    });
    let role = member["role"].clone();
    host.state.lock().sessions.insert(token.clone(), member);
    let _ = host.repo.touch_trusted_device(&project_id, &device_id, Some(&addr.ip().to_string()));
    let snapshot = host.repo.snapshot(&project_id).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.message()))?;
    Ok(Json(merged(json!({"session_token": token, "role": role, "snapshot": snapshot}), local_client_info())))
}

async fn snapshot(State(host): State<HostRef>, Path(project_id): Path<String>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    host.session(&headers)?;
    check_project(&host, &project_id)?;
    Ok(Json(host.repo.snapshot(&project_id).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.message()))?.unwrap_or(Value::Null)))
}

#[derive(serde::Deserialize)]
pub struct EventsQuery {
    #[serde(default)]
    pub after: i64,
    pub timeout: Option<f64>,
    pub active_target_id: Option<String>,
    pub active_target_name: Option<String>,
    pub activity: Option<String>,
}

async fn revisions(State(host): State<HostRef>, Path(project_id): Path<String>, Query(q): Query<EventsQuery>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    host.session(&headers)?;
    check_project(&host, &project_id)?;
    let items = host.repo.revisions_after(&project_id, q.after).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.message()))?;
    Ok(Json(json!({"items": items})))
}

async fn events(State(host): State<HostRef>, Path(project_id): Path<String>, Query(q): Query<EventsQuery>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    host.session(&headers)?;
    check_project(&host, &project_id)?;
    let timeout = q.timeout.unwrap_or(5.0).clamp(0.1, 10.0);
    let activity = q.activity.filter(|a| a == "viewing" || a == "editing");
    let name: Option<String> = q.active_target_name.map(|n| n.chars().take(120).collect()).filter(|n: &String| !n.is_empty());
    host.touch_member(&headers, json!({"active_target_id": q.active_target_id, "active_target_name": name, "activity": activity}));
    let deadline = tokio::time::Instant::now() + Duration::from_secs_f64(timeout);
    loop {
        let items = host.repo.revisions_after(&project_id, q.after).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.message()))?;
        if !items.is_empty() {
            host.touch_member(&headers, json!({"last_seen": now_secs()}));
            return Ok(Json(json!({"items": items, "timed_out": false})));
        }
        let notified = host.revision_notify.notified();
        if tokio::time::timeout_at(deadline, notified).await.is_err() {
            host.touch_member(&headers, json!({"last_seen": now_secs()}));
            return Ok(Json(json!({"items": [], "timed_out": true})));
        }
    }
}

async fn mutations(State(host): State<HostRef>, Path(project_id): Path<String>, headers: HeaderMap, Json(mut data): Json<Value>) -> Result<Json<Value>, ApiError> {
    let member = host.session(&headers)?;
    if member["role"] != "editor" {
        return Err(err(StatusCode::FORBIDDEN, "Viewer role cannot edit shared source"));
    }
    check_project(&host, &project_id)?;
    data["project_id"] = json!(project_id);
    let actor = Actor {
        device_id: member["device_id"].as_str().unwrap_or("unknown").into(),
        device_name: member["device_name"].as_str().map(str::to_string),
        device_ip: member["device_ip"].as_str().map(str::to_string),
    };
    match repository::mutate(&host.repo, &data, actor) {
        Ok(revision) => {
            host.notify_revision();
            Ok(Json(serde_json::to_value(revision).unwrap_or(Value::Null)))
        }
        Err(e @ RepoError::Conflict { .. }) => Err(err(StatusCode::CONFLICT, e.conflict_json().unwrap_or(Value::Null))),
        Err(RepoError::NotFound(m)) => Err(err(StatusCode::NOT_FOUND, m)),
        Err(RepoError::Bad(m)) => Err(err(StatusCode::BAD_REQUEST, m)),
        Err(RepoError::Db(m)) => Err(err(StatusCode::INTERNAL_SERVER_ERROR, m)),
    }
}
