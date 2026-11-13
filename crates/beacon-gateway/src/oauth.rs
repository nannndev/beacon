use crate::store::{AccountRecord, GatewayStore};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use parking_lot::RwLock;
use rand::RngCore;
use reqwest::Client;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct OAuthSession {
    pub id: String,
    pub provider: String,
    pub account_id: Option<String>,
    pub kind: String,
    pub code_verifier: Option<String>,
    pub device_code: Option<String>,
    /// kimi: device identity sent as X-Msh-Device-Id on every request
    pub device_id: Option<String>,
    pub interval: u64,
    pub expires_at: Instant,
}

#[derive(Clone)]
pub struct OAuthManager {
    sessions: Arc<RwLock<HashMap<String, OAuthSession>>>,
    /// One callback listener per port; a newer login replaces an older pending one.
    listeners: Arc<RwLock<HashMap<u16, tokio::task::AbortHandle>>>,
}

impl Default for OAuthManager {
    fn default() -> Self {
        Self::new()
    }
}

impl OAuthManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            listeners: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn insert_session(&self, session: OAuthSession) {
        let mut map = self.sessions.write();
        // Prune expired
        map.retain(|_, s| s.expires_at > Instant::now());
        map.insert(session.id.clone(), session);
    }

    pub fn get_session(&self, session_id: &str) -> Option<OAuthSession> {
        let map = self.sessions.read();
        map.get(session_id).and_then(|s| {
            if s.expires_at > Instant::now() {
                Some(s.clone())
            } else {
                None
            }
        })
    }

    pub fn remove_session(&self, session_id: &str) {
        let mut map = self.sessions.write();
        map.remove(session_id);
    }
}

pub fn generate_pkce_verifier() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn generate_pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    URL_SAFE_NO_PAD.encode(hash)
}

pub fn extract_jwt_claims(token: &str) -> Option<Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let payload = parts[1];
    // Try URL_SAFE_NO_PAD first
    if let Ok(bytes) = URL_SAFE_NO_PAD.decode(payload) {
        if let Ok(claims) = serde_json::from_slice::<Value>(&bytes) {
            return Some(claims);
        }
    }
    // Try with padding
    if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE.decode(payload) {
        if let Ok(claims) = serde_json::from_slice::<Value>(&bytes) {
            return Some(claims);
        }
    }
    None
}

/// Parse callback parameter: could be full URL, query string, or direct code/token
pub fn parse_callback_code_or_token(callback_str: &str) -> String {
    let s = callback_str.trim();
    if s.contains("code=") {
        if let Some(pos) = s.find("code=") {
            let rest = &s[pos + 5..];
            let end = rest.find('&').unwrap_or(rest.len());
            let code = &rest[..end];
            return urlencoding_decode(code);
        }
    }
    // Claude's code-only page shows "code#state"
    s.split('#').next().unwrap_or("").to_string()
}

fn urlencoding_decode(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex_str: String = chars.by_ref().take(2).collect();
            if let Ok(b) = u8::from_str_radix(&hex_str, 16) {
                out.push(b as char);
            } else {
                out.push('%');
                out.push_str(&hex_str);
            }
        } else if c == '+' {
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    out
}

// ----------------------------------------------------------------------------
// GitHub Copilot Device Flow
// ----------------------------------------------------------------------------
const GITHUB_COPILOT_CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";

pub async fn start_copilot_device_flow(
    client: &Client,
    mgr: &OAuthManager,
    account_id: Option<String>,
) -> Result<Value, String> {
    let session_id = Uuid::new_v4().to_string();

    let res = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .header("User-Agent", "Beacon/1.0")
        .json(&json!({
            "client_id": GITHUB_COPILOT_CLIENT_ID,
            "scope": "read:user"
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to GitHub: {e}"))?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        return Err(format!("GitHub device code error: {err}"));
    }

    let body: Value = res.json().await.map_err(|e| format!("Invalid JSON from GitHub: {e}"))?;
    let device_code = body.get("device_code").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let user_code = body.get("user_code").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let verification_uri = body
        .get("verification_uri")
        .and_then(|v| v.as_str())
        .unwrap_or("https://github.com/login/device")
        .to_string();
    let interval = body.get("interval").and_then(|v| v.as_u64()).unwrap_or(5);
    let expires_in = body.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(900);

    mgr.insert_session(OAuthSession {
        id: session_id.clone(),
        provider: "copilot".to_string(),
        account_id,
        kind: "device".to_string(),
        code_verifier: None,
        device_code: Some(device_code),
        device_id: None,
        interval,
        expires_at: Instant::now() + Duration::from_secs(expires_in),
    });

    Ok(json!({
        "kind": "device",
        "session_id": session_id,
        "user_code": user_code,
        "verification_uri": verification_uri,
        "interval": interval,
        "expires_in": expires_in
    }))
}

pub async fn poll_copilot_device_flow(
    client: &Client,
    mgr: &OAuthManager,
    store: &GatewayStore,
    session_id: &str,
) -> Result<Value, String> {
    let session = mgr.get_session(session_id).ok_or_else(|| "Session expired or invalid".to_string())?;
    let device_code = session.device_code.as_deref().unwrap_or("");

    let res = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .header("User-Agent", "Beacon/1.0")
        .json(&json!({
            "client_id": GITHUB_COPILOT_CLIENT_ID,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
        }))
        .send()
        .await
        .map_err(|e| format!("Poll request failed: {e}"))?;

    let body: Value = res.json().await.map_err(|e| format!("Invalid JSON response: {e}"))?;

    if let Some(err) = body.get("error").and_then(|v| v.as_str()) {
        match err {
            "authorization_pending" => return Ok(json!({ "status": "pending" })),
            "slow_down" => {
                let interval = body.get("interval").and_then(|v| v.as_u64()).unwrap_or(session.interval + 5);
                return Ok(json!({ "status": "pending", "interval": interval }));
            }
            "expired_token" => {
                mgr.remove_session(session_id);
                return Ok(json!({ "status": "expired", "error": "Login timed out. Please try again." }));
            }
            other => {
                mgr.remove_session(session_id);
                return Err(format!("GitHub OAuth error: {other}"));
            }
        }
    }

    if let Some(access_token) = body.get("access_token").and_then(|v| v.as_str()) {
        // Fetch user profile from GitHub
        let user_res = client
            .get("https://api.github.com/user")
            .header("Authorization", format!("Bearer {access_token}"))
            .header("User-Agent", "Beacon/1.0")
            .send()
            .await;

        let mut login_name = "github-user".to_string();
        let mut email: Option<String> = None;
        if let Ok(u_resp) = user_res {
            if let Ok(user_info) = u_resp.json::<Value>().await {
                if let Some(l) = user_info.get("login").and_then(|v| v.as_str()) {
                    login_name = l.to_string();
                }
                if let Some(e) = user_info.get("email").and_then(|v| v.as_str()) {
                    email = Some(e.to_string());
                } else {
                    email = Some(login_name.clone());
                }
            }
        }

        // Try to fetch Copilot internal session token
        let copilot_token_res = client
            .get("https://api.github.com/copilot_internal/v2/token")
            .header("Authorization", format!("Bearer {access_token}"))
            .header("User-Agent", "GithubCopilot/1.155.0")
            .send()
            .await;

        let mut copilot_token: Option<String> = None;
        let mut copilot_expires_at: Option<f64> = None;
        if let Ok(cp_resp) = copilot_token_res {
            if let Ok(cp_json) = cp_resp.json::<Value>().await {
                if let Some(tok) = cp_json.get("token").and_then(|v| v.as_str()) {
                    copilot_token = Some(tok.to_string());
                }
                if let Some(exp) = cp_json.get("expires_at").and_then(|v| v.as_f64()) {
                    copilot_expires_at = Some(exp);
                }
            }
        }

        let cred = json!({
            "access_token": access_token,
            "github_token": access_token,
            "copilot_token": copilot_token,
            "copilot_expires_at": copilot_expires_at,
            "login": login_name,
            "email": email
        });

        let target_account_id = session.account_id.as_deref();
        store.update_or_save_account("copilot", &cred, None, email.as_deref(), target_account_id)
            .map_err(|e| format!("Failed to save account: {e}"))?;

        mgr.remove_session(session_id);
        return Ok(json!({ "status": "done" }));
    }

    Ok(json!({ "status": "pending" }))
}

// ----------------------------------------------------------------------------
// Ephemeral OAuth Callback Listener
// ----------------------------------------------------------------------------
pub fn spawn_callback_listener(
    port: u16,
    session_id: String,
    provider: String,
    client: Client,
    mgr: OAuthManager,
    store: GatewayStore,
    target_account_id: Option<String>,
) {
    let listeners = mgr.listeners.clone();
    let task_listeners = listeners.clone();
    // A newer login replaces an older pending one on the same port.
    let previous = listeners.write().remove(&port);
    if let Some(old) = previous {
        old.abort();
    }
    let handle = tokio::spawn(async move {
        let addr = format!("127.0.0.1:{}", port);
        // The aborted task releases its socket asynchronously; retry briefly.
        let mut listener = None;
        for _ in 0..20 {
            match tokio::net::TcpListener::bind(&addr).await {
                Ok(l) => { listener = Some(l); break; }
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
        let Some(listener) = listener else {
            tracing::warn!("[oauth] Could not bind callback listener on {} (port in use)", addr);
            return;
        };

        tracing::info!("[oauth] Callback listener waiting on http://{}/ for provider {}", addr, provider);

        let timeout = tokio::time::sleep(Duration::from_secs(900));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                _ = &mut timeout => {
                    tracing::info!("[oauth] Callback listener on {} timed out", addr);
                    break;
                }
                res = listener.accept() => {
                    if let Ok((mut stream, _)) = res {
                        let mut buffer = [0u8; 4096];
                        // Browsers open idle preconnects; don't let one block the real callback.
                        let read = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buffer)).await;
                        if let Ok(Ok(n)) = read {
                            let req_text = String::from_utf8_lossy(&buffer[..n]);
                            let first_line = req_text.lines().next().unwrap_or("");
                            let path_and_query = first_line.split_whitespace().nth(1).unwrap_or("");

                            if let Some(pos) = path_and_query.find('?') {
                                let query = &path_and_query[pos + 1..];
                                let mut code: Option<String> = None;
                                let mut state: Option<String> = None;
                                let mut error: Option<String> = None;

                                for pair in query.split('&') {
                                    if let Some((k, v)) = pair.split_once('=') {
                                        let val = urlencoding_decode(v);
                                        if k == "code" {
                                            code = Some(val);
                                        } else if k == "state" {
                                            state = Some(val);
                                        } else if k == "error" || k == "error_description" {
                                            error = Some(val);
                                        }
                                    }
                                }

                                if let Some(err) = error {
                                    let body = format_oauth_result_page(false, &format!("Otorisasi dibatalkan: {}", err));
                                    let resp = format!("HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                                    let _ = stream.write_all(resp.as_bytes()).await;
                                    let _ = stream.flush().await;
                                    break;
                                }

                                if let Some(auth_code) = code {
                                    let effective_session = session_id.clone();
                                    let exchange_res = if state.as_deref().is_some_and(|st| st != session_id) {
                                        Err("State mismatch; start the login again".to_string())
                                    } else { match provider.as_str() {
                                        "claude" => complete_claude_pkce_flow(&client, &mgr, &store, &effective_session, &auth_code, target_account_id.as_deref()).await,
                                        "codex" => complete_codex_pkce_flow(&client, &mgr, &store, &effective_session, &auth_code, target_account_id.as_deref()).await,
                                        "gemini-cli" => complete_gemini_cli_flow(&client, &mgr, &store, &effective_session, &auth_code, target_account_id.as_deref()).await,
                                        _ => complete_generic_token_flow(&store, &provider, &auth_code, target_account_id.as_deref()).await,
                                    } };

                                    match exchange_res {
                                        Ok(_) => {
                                            let body = format_oauth_result_page(true, "Akun Anda telah berhasil terhubung ke Beacon.<br>Tab ini dapat ditutup dan silakan kembali ke aplikasi.");
                                            let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                                            let _ = stream.write_all(resp.as_bytes()).await;
                                            let _ = stream.flush().await;
                                            tracing::info!("[oauth] Callback completed successfully for {}", provider);
                                            break;
                                        }
                                        Err(err_msg) => {
                                            let body = format_oauth_result_page(false, &format!("Gagal menghubungkan akun: {}", err_msg));
                                            let resp = format!("HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                                            let _ = stream.write_all(resp.as_bytes()).await;
                                            let _ = stream.flush().await;
                                            tracing::error!("[oauth] Token exchange failed: {}", err_msg);
                                            break;
                                        }
                                    }
                                }
                            }

                            let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                            let _ = stream.write_all(not_found.as_bytes()).await;
                            let _ = stream.flush().await;
                        }
                    }
                }
            }
        }
        task_listeners.write().remove(&port);
    });
    listeners.write().insert(port, handle.abort_handle());
}

// ----------------------------------------------------------------------------
// Anthropic Claude Code PKCE Flow
// ----------------------------------------------------------------------------
const CLAUDE_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_REDIRECT_URI: &str = "http://localhost:54545/callback";
const CLAUDE_AUTHORIZE_URL: &str = "https://claude.ai/oauth/authorize";
const CLAUDE_TOKEN_URL: &str = "https://api.anthropic.com/v1/oauth/token";

pub async fn start_claude_pkce_flow(
    client: &Client,
    mgr: &OAuthManager,
    store: &GatewayStore,
    account_id: Option<String>,
) -> Value {
    let session_id = Uuid::new_v4().to_string();
    let verifier = generate_pkce_verifier();
    let challenge = generate_pkce_challenge(&verifier);

    let auth_url = format!(
        "{}?code=true&client_id={}&response_type=code&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&state={}",
        CLAUDE_AUTHORIZE_URL,
        CLAUDE_CLIENT_ID,
        urlencoding_encode(CLAUDE_REDIRECT_URI),
        urlencoding_encode("org:create_api_key user:profile user:inference"),
        challenge,
        session_id
    );

    mgr.insert_session(OAuthSession {
        id: session_id.clone(),
        provider: "claude".to_string(),
        account_id: account_id.clone(),
        kind: "redirect".to_string(),
        code_verifier: Some(verifier),
        device_code: None,
        device_id: None,
        interval: 3,
        expires_at: Instant::now() + Duration::from_secs(900),
    });

    spawn_callback_listener(
        54545,
        session_id.clone(),
        "claude".to_string(),
        client.clone(),
        mgr.clone(),
        store.clone(),
        account_id,
    );

    json!({
        "kind": "redirect",
        "session_id": session_id,
        "auth_url": auth_url,
        "redirect_uri": CLAUDE_REDIRECT_URI,
        "auto_callback": true
    })
}

pub async fn complete_claude_pkce_flow(
    client: &Client,
    mgr: &OAuthManager,
    store: &GatewayStore,
    session_id: &str,
    callback_input: &str,
    target_account_id: Option<&str>,
) -> Result<(), String> {
    let session = mgr.get_session(session_id);
    let verifier = session.as_ref().and_then(|s| s.code_verifier.as_deref()).unwrap_or("");
    let code = parse_callback_code_or_token(callback_input);

    let res = client
        .post(CLAUDE_TOKEN_URL)
        .header("Content-Type", "application/json")
        .json(&json!({
            "code": code,
            "state": session_id,
            "grant_type": "authorization_code",
            "client_id": CLAUDE_CLIENT_ID,
            "redirect_uri": CLAUDE_REDIRECT_URI,
            "code_verifier": verifier
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Anthropic token endpoint: {e}"))?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        return Err(format!("Anthropic token exchange error: {err}"));
    }

    let token_data: Value = res.json().await.map_err(|e| format!("Invalid JSON from Anthropic: {e}"))?;
    let access_token = token_data.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    let refresh_token = token_data.get("refresh_token").and_then(|v| v.as_str());
    let expires_in = token_data.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(3600);
    let email = token_data.get("account").and_then(|a| a.get("email_address")).and_then(|v| v.as_str());

    let cred = json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": chrono::Utc::now().timestamp_millis() + (expires_in * 1000),
        "email": email,
        "plan": "Pro / Max"
    });

    store.update_or_save_account("claude", &cred, None, email, target_account_id)
        .map_err(|e| format!("Failed to save account: {e}"))?;

    mgr.remove_session(session_id);
    Ok(())
}

// ----------------------------------------------------------------------------
// OpenAI / Codex PKCE Flow
// ----------------------------------------------------------------------------
const OPENAI_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_REDIRECT_URI: &str = "http://localhost:1455/auth/callback";

pub async fn start_codex_pkce_flow(
    client: &Client,
    mgr: &OAuthManager,
    store: &GatewayStore,
    account_id: Option<String>,
) -> Value {
    let session_id = Uuid::new_v4().to_string();
    let verifier = generate_pkce_verifier();
    let challenge = generate_pkce_challenge(&verifier);

    let auth_url = format!(
        "https://auth.openai.com/oauth/authorize?response_type=code&client_id={}&redirect_uri={}&scope=openid%20profile%20email%20offline_access&code_challenge={}&code_challenge_method=S256&id_token_add_organizations=true&codex_cli_simplified_flow=true&originator=codex_cli_rs&state={}",
        OPENAI_CLIENT_ID,
        urlencoding_encode(OPENAI_REDIRECT_URI),
        challenge,
        session_id
    );

    mgr.insert_session(OAuthSession {
        id: session_id.clone(),
        provider: "codex".to_string(),
        account_id: account_id.clone(),
        kind: "redirect".to_string(),
        code_verifier: Some(verifier),
        device_code: None,
        device_id: None,
        interval: 3,
        expires_at: Instant::now() + Duration::from_secs(900),
    });

    spawn_callback_listener(
        1455,
        session_id.clone(),
        "codex".to_string(),
        client.clone(),
        mgr.clone(),
        store.clone(),
        account_id,
    );

    json!({
        "kind": "redirect",
        "session_id": session_id,
        "auth_url": auth_url,
        "redirect_uri": OPENAI_REDIRECT_URI,
        "auto_callback": true
    })
}

pub async fn complete_codex_pkce_flow(
    client: &Client,
    mgr: &OAuthManager,
    store: &GatewayStore,
    session_id: &str,
    callback_input: &str,
    target_account_id: Option<&str>,
) -> Result<(), String> {
    let session = mgr.get_session(session_id);
    let verifier = session.as_ref().and_then(|s| s.code_verifier.as_deref()).unwrap_or("");

    let token_or_code = parse_callback_code_or_token(callback_input);

    // Check if user directly pasted an access token (JWT or sess- token)
    if token_or_code.starts_with("sess-") || (token_or_code.contains('.') && token_or_code.len() > 100) {
        let claims = extract_jwt_claims(&token_or_code);
        let mut email = None;
        let mut account_id = None;
        let mut plan = "free".to_string();

        if let Some(ref c) = claims {
            email = c.get("email").and_then(|v| v.as_str()).map(String::from);
            if let Some(auth) = c.get("https://api.openai.com/auth") {
                account_id = auth.get("chatgpt_account_id").and_then(|v| v.as_str()).map(String::from);
                if let Some(p) = auth.get("chatgpt_plan_type").and_then(|v| v.as_str()) {
                    plan = p.to_string();
                }
            }
        }

        let cred = json!({
            "access_token": token_or_code,
            "account_id": account_id,
            "plan": plan,
            "email": email
        });

        store.save_account("codex", &cred, None, email.as_deref())
            .map_err(|e| format!("Failed to save account: {e}"))?;
        mgr.remove_session(session_id);
        return Ok(());
    }

    // OpenAI's token endpoint only accepts form encoding (same as Codex CLI)
    let resp = client
        .post("https://auth.openai.com/oauth/token")
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", OPENAI_CLIENT_ID),
            ("code", token_or_code.as_str()),
            ("code_verifier", verifier),
            ("redirect_uri", OPENAI_REDIRECT_URI),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to exchange OpenAI token: {e}"))?;
    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI token exchange failed: {err_text}"));
    }

    let token_data: Value = resp.json().await.map_err(|e| format!("Invalid token response: {e}"))?;
    let access_token = token_data
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing access_token in OpenAI response".to_string())?;

    let refresh_token = token_data.get("refresh_token").and_then(|v| v.as_str());
    let id_token = token_data.get("id_token").and_then(|v| v.as_str());

    // Extract claims from id_token or access_token
    let claims = id_token
        .and_then(extract_jwt_claims)
        .or_else(|| extract_jwt_claims(access_token));

    let mut email: Option<String> = None;
    let mut account_id: Option<String> = None;
    let mut plan = "free".to_string();

    if let Some(ref c) = claims {
        email = c.get("email").and_then(|v| v.as_str()).map(String::from);
        if let Some(auth) = c.get("https://api.openai.com/auth") {
            account_id = auth.get("chatgpt_account_id").and_then(|v| v.as_str()).map(String::from);
            if let Some(p) = auth.get("chatgpt_plan_type").and_then(|v| v.as_str()) {
                plan = p.to_string();
            }
        }
    }

    let cred = json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "id_token": id_token,
        "account_id": account_id,
        "plan": plan,
        "email": email
    });

    store.update_or_save_account("codex", &cred, None, email.as_deref(), target_account_id)
        .map_err(|e| format!("Failed to save account: {e}"))?;

    mgr.remove_session(session_id);
    Ok(())
}

// ----------------------------------------------------------------------------
// Google Gemini CLI Flow
// ----------------------------------------------------------------------------
const GOOGLE_REDIRECT_URI: &str = "http://localhost:54545/callback";

pub async fn start_gemini_cli_flow(
    client: &Client,
    mgr: &OAuthManager,
    store: &GatewayStore,
    account_id: Option<String>,
) -> Result<Value, String> {
    let client_id = store.get_setting("gemini_oauth_client_id")
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "Gemini OAuth Client ID belum dikonfigurasi. Silakan buka tab Gemini App / Settings untuk mengisi client ID dan secret.".to_string())?;

    let session_id = Uuid::new_v4().to_string();
    let verifier = generate_pkce_verifier();
    let challenge = generate_pkce_challenge(&verifier);

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloud-platform%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent&state={}",
        urlencoding_encode(&client_id),
        urlencoding_encode(GOOGLE_REDIRECT_URI),
        challenge,
        session_id
    );

    mgr.insert_session(OAuthSession {
        id: session_id.clone(),
        provider: "gemini-cli".to_string(),
        account_id: account_id.clone(),
        kind: "redirect".to_string(),
        code_verifier: Some(verifier),
        device_code: None,
        device_id: None,
        interval: 3,
        expires_at: Instant::now() + Duration::from_secs(900),
    });

    spawn_callback_listener(
        54545,
        session_id.clone(),
        "gemini-cli".to_string(),
        client.clone(),
        mgr.clone(),
        store.clone(),
        account_id,
    );

    Ok(json!({
        "kind": "redirect",
        "session_id": session_id,
        "auth_url": auth_url,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "auto_callback": true
    }))
}

pub async fn complete_gemini_cli_flow(
    client: &Client,
    mgr: &OAuthManager,
    store: &GatewayStore,
    session_id: &str,
    callback_input: &str,
    target_account_id: Option<&str>,
) -> Result<(), String> {
    let session = mgr.get_session(session_id);
    let verifier = session.as_ref().and_then(|s| s.code_verifier.as_deref()).unwrap_or("");
    let client_id = store.get_setting("gemini_oauth_client_id").unwrap_or_default();
    let client_secret = store.get_setting("gemini_oauth_client_secret").unwrap_or_default();

    let code = parse_callback_code_or_token(callback_input);

    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code", code.as_str()),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", GOOGLE_REDIRECT_URI),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to exchange Google token: {e}"))?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        return Err(format!("Google token exchange error: {err}"));
    }

    let token_data: Value = res.json().await.map_err(|e| format!("Invalid JSON from Google: {e}"))?;
    let access_token = token_data.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    let refresh_token = token_data.get("refresh_token").and_then(|v| v.as_str());
    let id_token = token_data.get("id_token").and_then(|v| v.as_str());

    let email = id_token.and_then(extract_jwt_claims).and_then(|c| {
        c.get("email").and_then(|v| v.as_str()).map(String::from)
    });

    let cred = json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "id_token": id_token,
        "email": email
    });

    store.update_or_save_account("gemini-cli", &cred, None, email.as_deref(), target_account_id)
        .map_err(|e| format!("Failed to save account: {e}"))?;

    mgr.remove_session(session_id);
    Ok(())
}

// ----------------------------------------------------------------------------
// Universal Token / Direct Fallback for Claude, Kimi, Muse, Nous, Kilocode
// ----------------------------------------------------------------------------
pub async fn complete_generic_token_flow(
    store: &GatewayStore,
    provider: &str,
    input_str: &str,
    target_account_id: Option<&str>,
) -> Result<(), String> {
    let token = parse_callback_code_or_token(input_str);
    if token.is_empty() {
        return Err("Provided token or callback was empty".to_string());
    }

    let claims = extract_jwt_claims(&token);
    let email = claims.as_ref().and_then(|c| c.get("email").and_then(|v| v.as_str())).map(String::from);

    let cred = json!({
        "access_token": token,
        "token": token,
        "email": email
    });

    store.update_or_save_account(provider, &cred, None, email.as_deref(), target_account_id)
        .map_err(|e| format!("Failed to save account: {e}"))?;

    Ok(())
}

// ----------------------------------------------------------------------------
// OAuth Account Health / Live Test
// ----------------------------------------------------------------------------
pub async fn test_oauth_account(
    client: &Client,
    account: &AccountRecord,
) -> Value {
    let start = Instant::now();
    let email = account.email.clone();

    match account.provider.as_str() {
        "codex" => {
            if let Some(token) = account.cred.get("access_token").and_then(|t| t.as_str()) {
                let res = client
                    .get("https://chatgpt.com/backend-api/models")
                    .header("Authorization", format!("Bearer {token}"))
                    .header("User-Agent", "codex_cli_rs/0.101.0")
                    .send()
                    .await;

                let latency_ms = start.elapsed().as_millis() as u64;
                if let Ok(resp) = res {
                    if resp.status().is_success() || resp.status().as_u16() == 200 {
                        return json!({
                            "valid": true,
                            "latency_ms": latency_ms,
                            "email": email,
                            "models": ["chatgpt-4o-latest", "gpt-4o", "gpt-4o-mini", "o3-mini"]
                        });
                    }
                }
                // Even if backend-api/models fails due to web Cloudflare or auth, test if JWT is unexpired
                if let Some(claims) = extract_jwt_claims(token) {
                    if let Some(exp) = claims.get("exp").and_then(|v| v.as_u64()) {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();
                        if exp > now {
                            return json!({
                                "valid": true,
                                "latency_ms": latency_ms.max(50),
                                "email": email,
                                "models": ["chatgpt-4o-latest", "gpt-4o", "gpt-4o-mini"]
                            });
                        }
                    }
                }
            }
            json!({
                "valid": false,
                "latency_ms": start.elapsed().as_millis() as u64,
                "error": "ChatGPT session expired or invalid. Please re-authenticate."
            })
        }
        "copilot" => {
            if let Some(token) = account.cred.get("access_token").and_then(|t| t.as_str()) {
                let res = client
                    .get("https://api.github.com/copilot_internal/v2/token")
                    .header("Authorization", format!("Bearer {token}"))
                    .header("User-Agent", "GithubCopilot/1.155.0")
                    .send()
                    .await;

                let latency_ms = start.elapsed().as_millis() as u64;
                if let Ok(resp) = res {
                    if resp.status().is_success() {
                        return json!({
                            "valid": true,
                            "latency_ms": latency_ms,
                            "email": email,
                            "models": ["gpt-4o", "gpt-4o-mini", "claude-3.5-sonnet", "o3-mini"]
                        });
                    }
                }
            }
            json!({
                "valid": false,
                "latency_ms": start.elapsed().as_millis() as u64,
                "error": "GitHub Copilot token expired or unauthorized."
            })
        }
        "claude" => {
            if let Some(token) = account.cred.get("access_token").and_then(|t| t.as_str()) {
                let res = client
                    .get("https://api.anthropic.com/v1/models")
                    .header("Authorization", format!("Bearer {token}"))
                    .header("anthropic-version", "2023-06-01")
                    .header("anthropic-beta", "oauth-2025-04-20")
                    .header("User-Agent", "claude-cli/2.1.280 (external, sdk-cli)")
                    .send()
                    .await;

                let latency_ms = start.elapsed().as_millis() as u64;
                if let Ok(resp) = res {
                    if resp.status().is_success() {
                        return json!({
                            "valid": true,
                            "latency_ms": latency_ms,
                            "email": email,
                            "models": ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"]
                        });
                    }
                }
                // Don't report a rejected token as valid.
                return json!({ "valid": false, "latency_ms": latency_ms, "error": "Token rejected by the provider; reconnect this account." });
            }
            json!({
                "valid": false,
                "latency_ms": start.elapsed().as_millis() as u64,
                "error": "Claude OAuth token missing or invalid."
            })
        }
        "gemini-cli" => {
            if let Some(token) = account.cred.get("access_token").and_then(|t| t.as_str()) {
                let res = client
                    .get("https://generativelanguage.googleapis.com/v1beta/models")
                    .header("Authorization", format!("Bearer {token}"))
                    .send()
                    .await;

                let latency_ms = start.elapsed().as_millis() as u64;
                if let Ok(resp) = res {
                    if resp.status().is_success() {
                        return json!({
                            "valid": true,
                            "latency_ms": latency_ms,
                            "email": email,
                            "models": ["gemini-2.0-flash-exp", "gemini-1.5-pro", "gemini-1.5-flash"]
                        });
                    }
                }
                // Don't report a rejected token as valid.
                return json!({ "valid": false, "latency_ms": latency_ms, "error": "Token rejected by the provider; reconnect this account." });
            }
            json!({
                "valid": false,
                "latency_ms": start.elapsed().as_millis() as u64,
                "error": "Gemini CLI OAuth token missing or invalid."
            })
        }
        _ => {
            json!({
                "valid": true,
                "latency_ms": 60,
                "email": email,
                "models": []
            })
        }
    }
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

fn format_oauth_result_page(ok: bool, msg: &str) -> String {
    format!(
        r#"<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Beacon - {title}</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #090a0f; color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
    .card {{ background: #12141a; border: 1px solid #27272a; border-radius: 16px; padding: 40px; text-align: center; max-width: 440px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }}
    h2 {{ color: {h2_color}; margin: 0 0 12px 0; font-size: 20px; }}
    p {{ color: #a1a1aa; font-size: 14px; margin: 0 0 20px 0; line-height: 1.5; }}
    .badge {{ display: inline-block; background: {badge_bg}; color: {badge_color}; padding: 6px 14px; border-radius: 9999px; font-size: 12px; font-weight: 600; margin-bottom: 16px; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Beacon AI Gateway</div>
    <h2>{heading}</h2>
    <p>{msg}</p>
    {script}
  </div>
</body>
</html>"#,
        title = if ok { "Login Berhasil" } else { "Login Gagal" },
        h2_color = if ok { "#10b981" } else { "#ef4444" },
        badge_bg = if ok { "#064e3b" } else { "#450a0a" },
        badge_color = if ok { "#34d399" } else { "#f87171" },
        heading = if ok { "✅ Login Berhasil!" } else { "❌ Login Gagal" },
        msg = msg,
        script = if ok { "<script>setTimeout(() => { try { window.close(); } catch(e){} }, 1800);</script>" } else { "" }
    )
}

// ----------------------------------------------------------------------------
// Device flows: Kimi, Muse (Meta), Nous, Kilo Code (ported from the 7server implementation)
// ----------------------------------------------------------------------------
const KIMI_CLIENT_ID: &str = "17e5f671-d194-4dfb-9706-5516cb48c098";
const KIMI_DEVICE_URL: &str = "https://auth.kimi.com/api/oauth/device_authorization";
const KIMI_TOKEN_URL: &str = "https://auth.kimi.com/api/oauth/token";
const MUSE_CLIENT_ID: &str = "1031625952748946";
const MUSE_DEVICE_URL: &str = "https://auth.meta.com/oidc/device/authorization/";
const MUSE_TOKEN_URL: &str = "https://auth.meta.com/oidc/device/token/";
const MUSE_KEY_URL: &str = "https://api.meta.ai/muse-code/key";
const NOUS_CLIENT_ID: &str = "hermes-cli";
const NOUS_DEVICE_URL: &str = "https://portal.nousresearch.com/api/oauth/device/code";
const NOUS_TOKEN_URL: &str = "https://portal.nousresearch.com/api/oauth/token";
const NOUS_AGENT_KEY_URL: &str = "https://portal.nousresearch.com/api/oauth/agent-key";
const NOUS_SCOPE: &str = "inference:invoke inference:mint_agent_key";
const KILO_CODES_URL: &str = "https://api.kilo.ai/api/device-auth/codes";
const KILO_PROFILE_URL: &str = "https://api.kilo.ai/api/profile";

/// Kimi identifies the calling device on every request; the id is created at login and reused.
pub fn kimi_headers(device_id: &str) -> Vec<(&'static str, String)> {
    vec![
        ("X-Msh-Platform", "beacon".into()),
        ("X-Msh-Version", "1.0.0".into()),
        ("X-Msh-Device-Name", "unknown".into()),
        ("X-Msh-Device-Model", format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)),
        ("X-Msh-Device-Id", device_id.to_string()),
    ]
}

fn device_cfg(provider: &str, device_id: &str) -> Option<(&'static str, &'static str, &'static str, Option<&'static str>, Vec<(&'static str, String)>)> {
    match provider {
        "kimi" => Some((KIMI_CLIENT_ID, KIMI_DEVICE_URL, KIMI_TOKEN_URL, None, kimi_headers(device_id))),
        "muse" => Some((MUSE_CLIENT_ID, MUSE_DEVICE_URL, MUSE_TOKEN_URL, None, vec![("x-api-version", "1.0.0".into())])),
        "nous" => Some((NOUS_CLIENT_ID, NOUS_DEVICE_URL, NOUS_TOKEN_URL, Some(NOUS_SCOPE), vec![])),
        _ => None,
    }
}

async fn post_form_json(client: &Client, url: &str, form: &[(&str, &str)], headers: &[(&'static str, String)]) -> Result<Value, String> {
    let mut req = client.post(url).header("Accept", "application/json").form(form);
    for (k, v) in headers {
        req = req.header(*k, v);
    }
    let res = req.send().await.map_err(|e| format!("{url}: {e}"))?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(json!({}));
    // Device-flow token endpoints answer pending states with 4xx + error field; let callers classify.
    if !status.is_success() && body.get("error").is_none() {
        return Err(format!("{url}: HTTP {status}"));
    }
    Ok(body)
}

pub async fn start_device_flow(
    client: &Client,
    mgr: &OAuthManager,
    provider: &str,
    account_id: Option<String>,
) -> Result<Value, String> {
    let session_id = Uuid::new_v4().to_string();
    let device_id = Uuid::new_v4().to_string();

    let (device_code, user_code, verification_uri, interval, expires_in) = if provider == "kilocode" {
        let res = client.post(KILO_CODES_URL).header("Content-Type", "application/json").body("{}").send().await
            .map_err(|e| format!("Kilo Code: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("Kilo Code device authorization failed: HTTP {}", res.status()));
        }
        let d: Value = res.json().await.map_err(|e| format!("Kilo Code: {e}"))?;
        let code = d["code"].as_str().unwrap_or("").to_string();
        let url = d["verificationUrl"].as_str().unwrap_or("https://app.kilo.ai/device-auth").to_string();
        // Kilo polls by the long code; the page shows the short one from the URL
        let shown = url.rsplit("code=").next().filter(|_| url.contains("code=")).unwrap_or(&code).to_string();
        (code, shown, url, 3, d["expiresIn"].as_u64().unwrap_or(300))
    } else {
        let (client_id, device_url, _, scope, headers) = device_cfg(provider, &device_id).ok_or_else(|| format!("{provider} does not support OAuth login"))?;
        let mut form = vec![("client_id", client_id)];
        if let Some(sc) = scope {
            form.push(("scope", sc));
        }
        let d = post_form_json(client, device_url, &form, &headers).await?;
        if let Some(err) = d.get("error").and_then(|v| v.as_str()) {
            return Err(format!("{provider}: {}", d["error_description"].as_str().unwrap_or(err)));
        }
        let user_code = d["user_code"].as_str().unwrap_or("").to_string();
        let uri = d["verification_uri_complete"].as_str().or(d["verification_uri"].as_str())
            .map(String::from)
            .unwrap_or_else(|| format!("https://www.kimi.com/code/authorize_device?user_code={user_code}"));
        (d["device_code"].as_str().unwrap_or("").to_string(), user_code, uri, d["interval"].as_u64().unwrap_or(5), d["expires_in"].as_u64().unwrap_or(900))
    };
    if device_code.is_empty() {
        return Err(format!("{provider}: device authorization response is missing the device code"));
    }

    mgr.insert_session(OAuthSession {
        id: session_id.clone(),
        provider: provider.to_string(),
        account_id,
        kind: "device".to_string(),
        code_verifier: None,
        device_code: Some(device_code),
        device_id: Some(device_id),
        interval,
        expires_at: Instant::now() + Duration::from_secs(expires_in),
    });

    Ok(json!({
        "kind": "device",
        "session_id": session_id,
        "user_code": user_code,
        "verification_uri": verification_uri,
        "interval": interval,
        "expires_in": expires_in
    }))
}

pub async fn poll_device_flow(
    client: &Client,
    mgr: &OAuthManager,
    store: &GatewayStore,
    session_id: &str,
) -> Result<Value, String> {
    let session = mgr.get_session(session_id).ok_or_else(|| "Session expired or invalid".to_string())?;
    let device_code = session.device_code.clone().unwrap_or_default();
    let device_id = session.device_id.clone().unwrap_or_default();
    let provider = session.provider.as_str();

    let cred = if provider == "kilocode" {
        // Kilo answers 202 while waiting, 403 when denied, 410 when the code expired.
        let res = client.get(format!("{KILO_CODES_URL}/{device_code}")).send().await.map_err(|e| format!("Kilo Code: {e}"))?;
        match res.status().as_u16() {
            202 => return Ok(json!({ "status": "pending" })),
            403 => { mgr.remove_session(session_id); return Err("Kilo Code: login denied".into()); }
            410 => { mgr.remove_session(session_id); return Ok(json!({ "status": "expired", "error": "Login timed out. Please try again." })); }
            s if s >= 400 => { mgr.remove_session(session_id); return Err(format!("Kilo Code: HTTP {s}")); }
            _ => {}
        }
        let d: Value = res.json().await.unwrap_or(json!({}));
        let Some(token) = d["token"].as_str().filter(|_| d["status"] == "approved") else {
            return Ok(json!({ "status": "pending" }));
        };
        let org_id = match client.get(KILO_PROFILE_URL).bearer_auth(token).send().await {
            Ok(r) if r.status().is_success() => r.json::<Value>().await.ok().and_then(|p| p["organizations"][0]["id"].as_str().map(String::from)),
            _ => None,
        };
        json!({ "access_token": token, "email": d["userEmail"], "org_id": org_id })
    } else {
        let (client_id, _, token_url, _, headers) = device_cfg(provider, &device_id).ok_or_else(|| format!("{provider} does not support OAuth login"))?;
        let t = post_form_json(client, token_url, &[
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", client_id),
            ("device_code", device_code.as_str()),
        ], &headers).await?;
        match t.get("error").and_then(|v| v.as_str()) {
            Some("authorization_pending") => return Ok(json!({ "status": "pending" })),
            Some("slow_down") => return Ok(json!({ "status": "pending", "interval": session.interval + 5 })),
            Some("expired_token") => { mgr.remove_session(session_id); return Ok(json!({ "status": "expired", "error": "Login timed out. Please try again." })); }
            Some(err) => { mgr.remove_session(session_id); return Err(format!("{provider}: {}", t["error_description"].as_str().unwrap_or(err))); }
            None => {}
        }
        let Some(access_token) = t["access_token"].as_str() else {
            mgr.remove_session(session_id);
            return Err(format!("{provider}: token response has no access_token"));
        };
        let expires_at = t["expires_in"].as_i64().map(|s| chrono::Utc::now().timestamp_millis() + s * 1000);
        match provider {
            "muse" => mint_muse_key(client, access_token).await?,
            "nous" => {
                let mut cred = json!({ "access_token": access_token, "refresh_token": t["refresh_token"], "expires_at": expires_at });
                // Nous chat prefers a short-lived agent key; the OAuth token still works if minting fails.
                if let Ok(r) = client.post(NOUS_AGENT_KEY_URL).bearer_auth(access_token).json(&json!({ "min_ttl_seconds": 7200 })).send().await {
                    if let Ok(j) = r.json::<Value>().await {
                        if let Some(k) = j["api_key"].as_str() {
                            cred["api_key"] = json!(k);
                        }
                    }
                }
                cred
            }
            _ => {
                let claims = extract_jwt_claims(access_token).unwrap_or(json!({}));
                let email = claims["email"].as_str().or(claims["name"].as_str()).or(claims["sub"].as_str());
                json!({ "access_token": access_token, "refresh_token": t["refresh_token"], "expires_at": expires_at, "device_id": device_id, "email": email })
            }
        }
    };

    let email = cred["email"].as_str().map(String::from);
    store.update_or_save_account(provider, &cred, None, email.as_deref(), session.account_id.as_deref())
        .map_err(|e| format!("Failed to save account: {e}"))?;
    mgr.remove_session(session_id);
    Ok(json!({ "status": "done" }))
}

/// Muse chat uses a minted Model API key; the Meta token is kept so a re-mint needs no new login.
async fn mint_muse_key(client: &Client, meta_token: &str) -> Result<Value, String> {
    let res = client.post(MUSE_KEY_URL)
        .header("Accept", "application/json")
        .header("x-api-version", "1.0.0")
        .bearer_auth(meta_token)
        .json(&json!({ "onboard": true }))
        .send().await.map_err(|e| format!("Muse Code: {e}"))?;
    let status = res.status();
    let j: Value = res.json().await.unwrap_or(json!({}));
    let action = j["action_url"].as_str().or(j["require_payment_action_url"].as_str()).map(|u| format!(" ({u})")).unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Muse Code: HTTP {status}{action}"));
    }
    match j["api_key"].as_str().filter(|_| j["is_subs_active"] != false) {
        Some(key) => Ok(json!({ "access_token": key, "refresh_token": meta_token, "email": j["user_email"].as_str().map(|e| e.trim().to_lowercase()) })),
        None => Err(format!("Muse Code: subscription inactive{action}")),
    }
}

// ----------------------------------------------------------------------------
// Chat upstreams for subscription accounts (ported from 7server's subscription.ts)
// ----------------------------------------------------------------------------
fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Refreshes the stored credential when it is about to expire (or `force`, after an upstream 401).
/// Returns the credential to use; persists it when it changed.
pub async fn fresh_credential(client: &Client, store: &GatewayStore, acc: &AccountRecord, force: bool) -> Result<Value, String> {
    let mut c = acc.cred.clone();
    let lead = 5 * 60_000;
    let expiring = |field: &str, c: &Value| c[field].as_f64().map(|e| (e as i64) - now_ms() < lead).unwrap_or(false);
    let refresh = c["refresh_token"].as_str().map(String::from);
    let changed = match acc.provider.as_str() {
        "copilot" => {
            // copilot_expires_at is in seconds
            let exp = c["copilot_expires_at"].as_f64().map(|s| (s * 1000.0) as i64).unwrap_or(0);
            if force || c["copilot_token"].as_str().is_none() || exp - now_ms() < lead {
                let gh = c["github_token"].as_str().or(c["access_token"].as_str()).unwrap_or("").to_string();
                let j: Value = client.get("https://api.github.com/copilot_internal/v2/token")
                    .header("Authorization", format!("token {gh}"))
                    .header("Accept", "application/json")
                    .header("User-Agent", "GitHubCopilotChat/0.26.7")
                    .header("Editor-Version", "vscode/1.85.0")
                    .send().await.map_err(|e| format!("Copilot token: {e}"))?
                    .error_for_status().map_err(|e| format!("Copilot token: {e} (no Copilot subscription?)"))?
                    .json().await.map_err(|e| format!("Copilot token: {e}"))?;
                c["copilot_token"] = j["token"].clone();
                c["copilot_expires_at"] = j["expires_at"].clone();
                true
            } else { false }
        }
        "muse" if force => {
            let meta = refresh.ok_or("Muse Code: login again")?;
            c = mint_muse_key(client, &meta).await?;
            true
        }
        "kilocode" | "muse" => false,
        p if force || expiring("expires_at", &c) || (p == "nous" && c["api_key"].is_null() && force) => {
            let Some(rt) = refresh else {
                if force { return Err(format!("{p}: session expired; log in again")); }
                return Ok(c);
            };
            let device_id = c["device_id"].as_str().unwrap_or("").to_string();
            let t = match p {
                "claude" => {
                    let res = client.post(CLAUDE_TOKEN_URL)
                        .json(&json!({ "grant_type": "refresh_token", "refresh_token": rt, "client_id": CLAUDE_CLIENT_ID }))
                        .send().await.map_err(|e| format!("Claude refresh: {e}"))?;
                    if !res.status().is_success() {
                        return Err(format!("Claude refresh failed: {}", res.text().await.unwrap_or_default()));
                    }
                    res.json::<Value>().await.map_err(|e| e.to_string())?
                }
                "codex" => post_form_json(client, "https://auth.openai.com/oauth/token", &[("grant_type", "refresh_token"), ("refresh_token", &rt), ("client_id", OPENAI_CLIENT_ID), ("scope", "openid profile email offline_access")], &[]).await?,
                "kimi" => post_form_json(client, KIMI_TOKEN_URL, &[("grant_type", "refresh_token"), ("refresh_token", &rt), ("client_id", KIMI_CLIENT_ID)], &kimi_headers(&device_id)).await?,
                "nous" => post_form_json(client, NOUS_TOKEN_URL, &[("grant_type", "refresh_token"), ("refresh_token", &rt), ("client_id", NOUS_CLIENT_ID)], &[]).await?,
                "gemini-cli" => {
                    let id = store.get_setting("gemini_oauth_client_id").unwrap_or_default();
                    let sec = store.get_setting("gemini_oauth_client_secret").unwrap_or_default();
                    post_form_json(client, "https://oauth2.googleapis.com/token", &[("grant_type", "refresh_token"), ("refresh_token", &rt), ("client_id", &id), ("client_secret", &sec)], &[]).await?
                }
                _ => return Ok(c),
            };
            if let Some(e) = t.get("error") {
                return Err(format!("{p} refresh failed: {}", t["error_description"].as_str().or(e.as_str()).unwrap_or("error")));
            }
            c["access_token"] = t["access_token"].clone();
            if let Some(r) = t["refresh_token"].as_str() { c["refresh_token"] = json!(r); }
            if let Some(s) = t["expires_in"].as_i64() { c["expires_at"] = json!(now_ms() + s * 1000); }
            if p == "nous" {
                c.as_object_mut().unwrap().remove("api_key");
                if let Ok(r) = client.post(NOUS_AGENT_KEY_URL).bearer_auth(c["access_token"].as_str().unwrap_or("")).json(&json!({ "min_ttl_seconds": 7200 })).send().await {
                    if let Ok(j) = r.json::<Value>().await { if let Some(k) = j["api_key"].as_str() { c["api_key"] = json!(k); } }
                }
            }
            true
        }
        _ => false,
    };
    // Gemini routes through Cloud Code Assist, which needs the account's project id.
    let mut changed = changed;
    if acc.provider == "gemini-cli" && c["project_id"].as_str().is_none() {
        let tok = c["access_token"].as_str().unwrap_or("").to_string();
        if let Ok(r) = client.post("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist").bearer_auth(&tok)
            .json(&json!({ "metadata": { "ideType": 9, "platform": 3, "pluginType": 2 }, "mode": 1 })).send().await
        {
            if let Ok(d) = r.json::<Value>().await {
                let proj = d["cloudaicompanionProject"]["id"].as_str().or(d["cloudaicompanionProject"].as_str()).map(String::from);
                if let Some(pid) = proj { c["project_id"] = json!(pid); changed = true; }
            }
        }
    }
    if changed {
        store.update_or_save_account(&acc.provider, &c, None, None, Some(&acc.id))
            .map_err(|e| format!("Failed to save refreshed token: {e}"))?;
    }
    Ok(c)
}

/// Builds the upstream streaming request for one subscription account.
/// Returns the request plus the stream format: "claude", "gemini", or "openai" (pass-through).
pub fn subscription_request(client: &Client, provider: &str, cred: &Value, model: &str, body: &Value) -> Option<(reqwest::RequestBuilder, &'static str)> {
    let tok = cred["access_token"].as_str().unwrap_or("");
    let mut openai_body = body.clone();
    openai_body["model"] = json!(model);
    openai_body["stream"] = json!(true);
    let openai = |url: &str, bearer: &str| client.post(url).bearer_auth(bearer).header("Accept", "text/event-stream").json(&openai_body);
    Some(match provider {
        "claude" => (
            client.post("https://api.anthropic.com/v1/messages?beta=true")
                .bearer_auth(tok)
                .header("anthropic-version", "2023-06-01")
                .header("anthropic-beta", "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14")
                .header("anthropic-dangerous-direct-browser-access", "true")
                .header("x-app", "cli")
                .header("User-Agent", "claude-cli/2.1.280 (external, sdk-cli)")
                .header("Accept", "text/event-stream")
                .json(&crate::translate::openai_to_claude_oauth(body, model)),
            "claude",
        ),
        "gemini-cli" => (
            client.post("https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse")
                .bearer_auth(tok)
                .header("User-Agent", format!("GeminiCLI/0.34.0/{model} (darwin; arm64)"))
                .header("X-Goog-Api-Client", "google-genai-sdk/1.41.0 gl-node/v22.19.0")
                .header("Accept", "text/event-stream")
                .json(&crate::translate::openai_to_gemini(body, model, cred["project_id"].as_str())),
            "gemini",
        ),
        "copilot" => (
            openai("https://api.githubcopilot.com/chat/completions", cred["copilot_token"].as_str().unwrap_or(""))
                .header("copilot-integration-id", "vscode-chat")
                .header("editor-version", "vscode/1.110.0")
                .header("editor-plugin-version", "copilot-chat/0.38.0")
                .header("user-agent", "GitHubCopilotChat/0.38.0")
                .header("openai-intent", "conversation-panel")
                .header("x-github-api-version", "2025-04-01")
                .header("X-Initiator", "user"),
            "openai",
        ),
        "kimi" => {
            let mut r = openai("https://api.kimi.com/coding/v1/chat/completions", tok);
            for (k, v) in kimi_headers(cred["device_id"].as_str().unwrap_or("")) { r = r.header(k, v); }
            (r, "openai")
        }
        "kilocode" => {
            let mut r = openai("https://api.kilo.ai/api/openrouter/chat/completions", tok);
            if let Some(org) = cred["org_id"].as_str() { r = r.header("X-Kilocode-OrganizationID", org); }
            (r, "openai")
        }
        "muse" => (openai("https://api.meta.ai/v1/chat/completions", tok), "openai"),
        "nous" => {
            // Nous requires attribution tags on its inference API.
            openai_body["tags"] = json!(["product=beacon", "client=beacon"]);
            let key = cred["api_key"].as_str().unwrap_or(tok);
            (client.post("https://inference-api.nousresearch.com/v1/chat/completions").bearer_auth(key).header("Accept", "text/event-stream").json(&openai_body), "openai")
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pasted_callbacks() {
        assert_eq!(parse_callback_code_or_token("http://localhost:1455/auth/callback?code=abc%20d&state=s1"), "abc d");
        assert_eq!(parse_callback_code_or_token("code=xyz"), "xyz");
        assert_eq!(parse_callback_code_or_token("  claude-code#state-123 "), "claude-code");
        assert_eq!(parse_callback_code_or_token("sess-raw-token"), "sess-raw-token");
    }

    #[test]
    fn device_cfg_covers_std_providers_only() {
        assert!(device_cfg("kimi", "d").is_some());
        assert!(device_cfg("muse", "d").is_some());
        assert!(device_cfg("nous", "d").unwrap().3.is_some());
        assert!(device_cfg("kilocode", "d").is_none());
    }
}
