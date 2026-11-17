//! GitHub Personal Access Token (PAT) integration + Repo / Project Code
//! analyzer for summarizing APIs and generating Beacon collections.

use crate::importer::{materialize_items, normalize_project};
use crate::store::{Environment, Project, Store};
use beacon_gateway::{Cipher, GatewayEngine};
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const GITHUB_FILE: &str = "github.json";
const DEFAULT_API_BASE: &str = "https://api.github.com";
const USER_AGENT: &str = "Beacon-API-Workbench";
const MAX_LOCAL_FILES: usize = 300;
const MAX_CODE_FILES_TO_READ: usize = 45;
const MAX_FILE_BYTES: usize = 120_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredGitHubAuth {
    pub token_enc: String,
    pub login: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub api_base: String,
    pub connected_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubStatus {
    pub connected: bool,
    pub login: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub html_url: Option<String>,
    pub scopes: Vec<String>,
    pub api_base: Option<String>,
    pub connected_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRepoSummary {
    pub full_name: String,
    pub name: String,
    pub owner: String,
    pub private: bool,
    pub description: Option<String>,
    pub language: Option<String>,
    pub default_branch: String,
    pub html_url: String,
    pub updated_at: Option<String>,
    pub stargazers_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredEndpoint {
    pub id: String,
    pub name: String,
    pub method: String,
    pub path: String,
    pub folder: String,
    pub source_file: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub auth_hint: Option<String>,
    #[serde(default)]
    pub sample_body: Option<String>,
    #[serde(default = "default_true")]
    pub selected: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSummaryResult {
    pub source_type: String,
    pub source_label: String,
    pub suggested_name: String,
    pub branch: Option<String>,
    pub default_base_url: String,
    pub frameworks: Vec<String>,
    pub auth_summary: String,
    pub summary_markdown: String,
    pub ai_enhanced: bool,
    pub spec_files: Vec<String>,
    pub files_scanned: usize,
    pub folders: Vec<String>,
    pub endpoints: Vec<DiscoveredEndpoint>,
}

fn github_path(data_dir: &Path) -> PathBuf {
    data_dir.join(GITHUB_FILE)
}

fn normalize_api_base(api_base: Option<&str>) -> String {
    let raw = api_base.unwrap_or(DEFAULT_API_BASE).trim();
    if raw.is_empty() {
        DEFAULT_API_BASE.to_string()
    } else {
        raw.trim_end_matches('/').to_string()
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

fn load_stored(data_dir: &Path) -> Option<StoredGitHubAuth> {
    let raw = fs::read_to_string(github_path(data_dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn load_pat(data_dir: &Path) -> Result<(String, StoredGitHubAuth), String> {
    let stored = load_stored(data_dir)
        .ok_or_else(|| "GitHub is not connected. Add a Personal Access Token first.".to_string())?;
    let cipher = Cipher::new(data_dir)?;
    let token = cipher.decrypt(&stored.token_enc)?;
    Ok((token, stored))
}

pub fn get_status(data_dir: &Path) -> GitHubStatus {
    match load_stored(data_dir) {
        Some(s) => GitHubStatus {
            connected: true,
            login: Some(s.login),
            name: s.name,
            avatar_url: s.avatar_url,
            html_url: s.html_url,
            scopes: s.scopes,
            api_base: Some(s.api_base),
            connected_at: Some(s.connected_at),
        },
        None => GitHubStatus {
            connected: false,
            login: None,
            name: None,
            avatar_url: None,
            html_url: None,
            scopes: Vec::new(),
            api_base: None,
            connected_at: None,
        },
    }
}

pub fn disconnect(data_dir: &Path) -> Result<(), String> {
    let path = github_path(data_dir);
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Failed to remove GitHub config: {e}"))?;
    }
    Ok(())
}

pub async fn connect_pat(
    data_dir: &Path,
    token: &str,
    api_base: Option<&str>,
) -> Result<GitHubStatus, String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err("Personal Access Token cannot be empty".into());
    }
    let base = normalize_api_base(api_base);
    let client = http_client()?;
    let resp = client
        .get(format!("{base}/user"))
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(trimmed)
        .send()
        .await
        .map_err(|e| format!("Failed to reach GitHub API: {e}"))?;

    let status = resp.status();
    let scopes = resp
        .headers()
        .get("x-oauth-scopes")
        .and_then(|v| v.to_str().ok())
        .map(|s| {
            s.split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response from GitHub API: {e}"))?;

    if !status.is_success() {
        let msg = body
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Authentication failed");
        return Err(format!("GitHub rejected PAT ({status}): {msg}"));
    }

    let login = body
        .get("login")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "GitHub user payload missing login".to_string())?
        .to_string();

    let cipher = Cipher::new(data_dir)?;
    let token_enc = cipher.encrypt(trimmed)?;

    let stored = StoredGitHubAuth {
        token_enc,
        login,
        name: body.get("name").and_then(|v| v.as_str()).map(str::to_string),
        avatar_url: body
            .get("avatar_url")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        html_url: body
            .get("html_url")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        scopes,
        api_base: base,
        connected_at: Utc::now().to_rfc3339(),
    };

    let _ = fs::create_dir_all(data_dir);
    let path = github_path(data_dir);
    let json = serde_json::to_string_pretty(&stored)
        .map_err(|e| format!("Failed to serialize GitHub config: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("Failed to save GitHub config: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    Ok(get_status(data_dir))
}

pub async fn list_repos(
    data_dir: &Path,
    query: Option<&str>,
    per_page: usize,
) -> Result<Vec<GitHubRepoSummary>, String> {
    let (token, auth) = load_pat(data_dir)?;
    let client = http_client()?;
    let limit = per_page.clamp(1, 100);

    let url = format!(
        "{}/user/repos?sort=updated&per_page={limit}&affiliation=owner,collaborator,organization_member",
        auth.api_base
    );
    let resp = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch GitHub repositories: {e}"))?;

    let status = resp.status();
    let payload: Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid GitHub repositories payload: {e}"))?;
    if !status.is_success() {
        let msg = payload
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Could not list repositories");
        return Err(format!("GitHub API error ({status}): {msg}"));
    }

    let filter = query.unwrap_or("").trim().to_lowercase();
    let mut repos = Vec::new();
    if let Some(arr) = payload.as_array() {
        for r in arr {
            let full_name = r
                .get("full_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if full_name.is_empty() {
                continue;
            }
            let desc = r
                .get("description")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            if !filter.is_empty() {
                let hay = format!(
                    "{} {}",
                    full_name.to_lowercase(),
                    desc.as_deref().unwrap_or("").to_lowercase()
                );
                if !hay.contains(&filter) {
                    continue;
                }
            }
            repos.push(GitHubRepoSummary {
                full_name: full_name.clone(),
                name: r
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                owner: r
                    .pointer("/owner/login")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                private: r.get("private").and_then(|v| v.as_bool()).unwrap_or(false),
                description: desc,
                language: r
                    .get("language")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                default_branch: r
                    .get("default_branch")
                    .and_then(|v| v.as_str())
                    .unwrap_or("main")
                    .to_string(),
                html_url: r
                    .get("html_url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                updated_at: r
                    .get("updated_at")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                stargazers_count: r
                    .get("stargazers_count")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
            });
        }
    }
    Ok(repos)
}

pub async fn summarize_github_repo(
    data_dir: &Path,
    gateway: Option<&GatewayEngine>,
    repo_full_name: &str,
    branch: Option<&str>,
    use_ai: bool,
) -> Result<CodeSummaryResult, String> {
    let repo = repo_full_name.trim().trim_matches('/');
    if !repo.contains('/') || repo.split('/').count() != 2 {
        return Err("Repository must be in 'owner/repo' format".into());
    }
    let (token, auth) = load_pat(data_dir)?;
    let client = http_client()?;

    let repo_meta: Value = client
        .get(format!("{}/repos/{repo}", auth.api_base))
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch repository metadata: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid repository metadata: {e}"))?;

    if let Some(msg) = repo_meta.get("message").and_then(|v| v.as_str()) {
        if repo_meta.get("full_name").is_none() {
            return Err(format!("GitHub error: {msg}"));
        }
    }

    let target_branch = branch
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| repo_meta.get("default_branch").and_then(|v| v.as_str()))
        .unwrap_or("main")
        .to_string();

    let tree_resp = client
        .get(format!(
            "{}/repos/{repo}/git/trees/{target_branch}?recursive=1",
            auth.api_base
        ))
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch repository tree: {e}"))?;

    if !tree_resp.status().is_success() {
        let status = tree_resp.status();
        let text = tree_resp.text().await.unwrap_or_default();
        return Err(format!("Failed to read tree for {repo}@{target_branch} ({status}): {text}"));
    }

    let tree_json: Value = tree_resp
        .json()
        .await
        .map_err(|e| format!("Invalid tree response: {e}"))?;

    let mut all_paths = Vec::new();
    if let Some(entries) = tree_json.get("tree").and_then(|v| v.as_array()) {
        for entry in entries {
            if entry.get("type").and_then(|v| v.as_str()) != Some("blob") {
                continue;
            }
            if let Some(p) = entry.get("path").and_then(|v| v.as_str()) {
                if !should_ignore_path(p) {
                    all_paths.push(p.to_string());
                }
            }
        }
    }

    let selected_paths = prioritize_candidate_files(&all_paths);
    let mut files: Vec<(String, String)> = Vec::new();

    for path in selected_paths.into_iter().take(MAX_CODE_FILES_TO_READ) {
        let url = format!(
            "{}/repos/{repo}/contents/{path}?ref={target_branch}",
            auth.api_base
        );
        let Ok(resp) = client
            .get(url)
            .header("Accept", "application/vnd.github.raw+json")
            .bearer_auth(&token)
            .send()
            .await
        else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        if let Ok(text) = resp.text().await {
            if text.len() <= MAX_FILE_BYTES {
                files.push((path, text));
            }
        }
    }

    let repo_short = repo.split('/').nth(1).unwrap_or(repo).to_string();
    let mut result = analyze_files(
        "github_repo",
        repo,
        &repo_short,
        Some(target_branch),
        &all_paths,
        &files,
    );

    if use_ai {
        if let Some(gw) = gateway {
            if let Some(enhanced) = enhance_summary_with_ai(gw, &result, &files).await {
                result = enhanced;
            }
        }
    }

    Ok(result)
}

pub async fn summarize_local_project(
    gateway: Option<&GatewayEngine>,
    folder_path: &str,
    use_ai: bool,
) -> Result<CodeSummaryResult, String> {
    let root = PathBuf::from(folder_path.trim());
    if !root.exists() || !root.is_dir() {
        return Err(format!("Folder does not exist: {}", root.display()));
    }
    let root_canon = fs::canonicalize(&root).unwrap_or(root);
    let mut all_paths = Vec::new();
    collect_local_paths(&root_canon, &root_canon, &mut all_paths, 0);

    let selected_paths = prioritize_candidate_files(&all_paths);
    let mut files = Vec::new();
    for rel in selected_paths.into_iter().take(MAX_CODE_FILES_TO_READ) {
        let full = root_canon.join(&rel);
        if let Ok(meta) = fs::metadata(&full) {
            if meta.len() as usize <= MAX_FILE_BYTES {
                if let Ok(content) = fs::read_to_string(&full) {
                    files.push((rel, content));
                }
            }
        }
    }

    let label = root_canon.to_string_lossy().to_string();
    let name = root_canon
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Project API")
        .to_string();

    let mut result = analyze_files("local_code", &label, &name, None, &all_paths, &files);
    if use_ai {
        if let Some(gw) = gateway {
            if let Some(enhanced) = enhance_summary_with_ai(gw, &result, &files).await {
                result = enhanced;
            }
        }
    }
    Ok(result)
}

/// Where a code source lives: a local folder, or a GitHub repo with an optional branch.
#[derive(Debug, PartialEq)]
pub enum CodeSource {
    Local(PathBuf),
    GitHub { repo: String, branch: Option<String> },
}

/// Accepts a folder path (absolute, ~, or relative to an existing dir), "owner/repo",
/// or a github.com URL (…/owner/repo[.git][/tree/branch]).
pub fn parse_code_source(raw: &str) -> CodeSource {
    let s = raw.trim();
    let expanded = match s.strip_prefix("~/") {
        Some(rest) => std::env::var_os("HOME").map(|h| PathBuf::from(h).join(rest)).unwrap_or_else(|| PathBuf::from(s)),
        None => PathBuf::from(s),
    };
    if expanded.is_dir() {
        return CodeSource::Local(expanded);
    }
    let url = s.trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.");
    if let Some(rest) = url.strip_prefix("github.com/") {
        let parts: Vec<&str> = rest.trim_end_matches('/').split('/').collect();
        if parts.len() >= 2 {
            let repo = format!("{}/{}", parts[0], parts[1].trim_end_matches(".git"));
            let branch = (parts.len() >= 4 && parts[2] == "tree").then(|| parts[3..].join("/"));
            return CodeSource::GitHub { repo, branch };
        }
    }
    let looks_like_path = s.starts_with('/') || s.starts_with('~') || s.starts_with('.') || s.contains('\\') || s.contains(':');
    if !looks_like_path && s.split('/').count() == 2 && !s.contains(' ') {
        return CodeSource::GitHub { repo: s.trim_end_matches(".git").to_string(), branch: None };
    }
    CodeSource::Local(expanded)
}

// Last analysis per source, so the agent can import it without re-scanning.
// shortcut: unbounded and process-wide, fine for a desktop app's handful of sources.
fn analysis_cache() -> &'static parking_lot::Mutex<HashMap<String, CodeSummaryResult>> {
    static CACHE: std::sync::OnceLock<parking_lot::Mutex<HashMap<String, CodeSummaryResult>>> = std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Agent entry point: analyzes a local folder or GitHub repo and caches the result.
/// No AI pass here, since the agent calling this is the AI.
pub async fn analyze_source(data_dir: &Path, source: &str, branch: Option<&str>) -> Result<CodeSummaryResult, String> {
    let result = match parse_code_source(source) {
        CodeSource::Local(path) => summarize_local_project(None, &path.to_string_lossy(), false).await?,
        CodeSource::GitHub { repo, branch: url_branch } => {
            summarize_github_repo(data_dir, None, &repo, branch.or(url_branch.as_deref()), false).await?
        }
    };
    analysis_cache().lock().insert(source.trim().to_string(), result.clone());
    Ok(result)
}

pub fn cached_analysis(source: &str) -> Option<CodeSummaryResult> {
    analysis_cache().lock().get(source.trim()).cloned()
}

/// Adds the endpoints to `project_id`, or to a new project (made active) when it is
/// None. Saves the store. Returns the project id.
pub fn add_endpoints_to_project(
    store: &mut Store,
    name: &str,
    base_url: &str,
    project_id: Option<&str>,
    endpoints: &[&DiscoveredEndpoint],
) -> Result<String, String> {
    if endpoints.is_empty() {
        return Err("Select at least one endpoint to generate a collection".into());
    }
    let base = base_url.trim().trim_end_matches('/');
    let base_url = if base.is_empty() { "http://localhost:8000".to_string() } else { base.to_string() };

    let raw_items: Vec<Value> = endpoints
        .iter()
        .map(|ep| {
            let clean_path = if ep.path.starts_with('/') { ep.path.clone() } else { format!("/{}", ep.path) };
            let mut headers = serde_json::Map::new();
            if let Some(auth) = ep.auth_hint.as_deref().filter(|a| !a.trim().is_empty()) {
                headers.insert("Authorization".to_string(), json!(auth));
            }
            let payload = ep
                .sample_body
                .as_deref()
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .unwrap_or_else(|| json!({}));
            json!({
                "name": ep.name,
                "method": ep.method.to_uppercase(),
                "url": format!("{base_url}{clean_path}"),
                "folder": ep.folder,
                "description": ep.description,
                "headers": Value::Object(headers),
                "payload": payload,
            })
        })
        .collect();
    let (materialized, _) = materialize_items(&raw_items)?;

    let target_id = if let Some(pid) = project_id.filter(|s| !s.is_empty()) {
        // Flush unsaved edits of the active project before touching its tree.
        store.save_active_project();
        let proj = store.projects.iter_mut().find(|p| p.id == pid).ok_or("Target project not found")?;
        proj.items.get_or_insert_with(Vec::new).extend(materialized);
        pid.to_string()
    } else {
        store.save_active_project();
        let proj_id = uuid::Uuid::new_v4().to_string();
        let env_id = uuid::Uuid::new_v4().to_string();
        let mut vars = HashMap::new();
        vars.insert("base_url".to_string(), json!(base_url));
        store.projects.push(Project {
            id: proj_id.clone(),
            name: if name.trim().is_empty() { "Generated API Collection".to_string() } else { name.trim().to_string() },
            template_id: None,
            environments: vec![Environment { id: env_id.clone(), name: "Default".to_string(), base_url, variables: vars }],
            current_environment_id: Some(env_id),
            notifications: None,
            shared_origin: None,
            file_sync: None,
            items: Some(materialized),
            tests: None,
            auth: None,
        });
        store.current_project_id = Some(proj_id.clone());
        proj_id
    };
    store.sync_current_config();
    store.save()?;
    Ok(target_id)
}

fn collect_local_paths(root: &Path, dir: &Path, out: &mut Vec<String>, depth: usize) {
    if depth > 6 || out.len() >= MAX_LOCAL_FILES {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_LOCAL_FILES {
            break;
        }
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if should_ignore_path(&rel_str) {
            continue;
        }
        if meta.is_dir() {
            collect_local_paths(root, &path, out, depth + 1);
        } else if meta.is_file() {
            out.push(rel_str);
        }
    }
}

fn should_ignore_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    let ignored_segments = [
        "node_modules/",
        "target/",
        ".git/",
        "dist/",
        "build/",
        ".next/",
        "vendor/",
        ".venv/",
        "venv/",
        "__pycache__/",
        ".cargo/",
        "coverage/",
    ];
    if ignored_segments.iter().any(|s| lower.starts_with(s) || lower.contains(&format!("/{s}"))) {
        return true;
    }
    let ignored_exts = [
        ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf",
        ".pdf", ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".dylib", ".lock",
    ];
    ignored_exts.iter().any(|ext| lower.ends_with(ext))
}

fn is_spec_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    let name = lower.rsplit('/').next().unwrap_or(&lower);
    name.contains("openapi")
        || name.contains("swagger")
        || name.contains("postman_collection")
        || name.ends_with(".har")
        || name == "beacon.yaml"
        || name == "beacon.yml"
}

fn prioritize_candidate_files(paths: &[String]) -> Vec<String> {
    let mut scored: Vec<(i32, &String)> = paths
        .iter()
        .filter_map(|p| {
            let lower = p.to_lowercase();
            let score = if is_spec_file(&lower) {
                100
            } else if matches!(
                lower.rsplit('/').next().unwrap_or(""),
                "package.json" | "cargo.toml" | "go.mod" | "requirements.txt" | "pyproject.toml" | "composer.json"
            ) {
                90
            } else if (lower.contains("route")
                || lower.contains("router")
                || lower.contains("controller")
                || lower.contains("handler")
                || lower.contains("endpoint")
                || lower.contains("/api/"))
                && is_code_file(&lower)
            {
                80
            } else if (lower.ends_with("main.rs")
                || lower.ends_with("lib.rs")
                || lower.ends_with("app.ts")
                || lower.ends_with("app.js")
                || lower.ends_with("server.ts")
                || lower.ends_with("server.js")
                || lower.ends_with("index.ts")
                || lower.ends_with("index.js")
                || lower.ends_with("main.py")
                || lower.ends_with("app.py")
                || lower.ends_with("main.go")
                || lower.ends_with("api.php"))
                && is_code_file(&lower)
            {
                65
            } else if lower == "readme.md" {
                40
            } else {
                0
            };
            if score > 0 {
                Some((score, p))
            } else {
                None
            }
        })
        .collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(b.1)));
    scored.into_iter().map(|(_, p)| p.clone()).collect()
}

fn is_code_file(lower: &str) -> bool {
    [
        ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".php", ".rb", ".java", ".kt",
        ".cs",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

fn detect_frameworks(files: &[(String, String)], all_paths: &[String]) -> Vec<String> {
    let mut set = BTreeSet::new();
    for (path, content) in files {
        let lower_path = path.to_lowercase();
        let lower_body = content.to_lowercase();
        if lower_path.ends_with("cargo.toml") {
            if lower_body.contains("axum") {
                set.insert("Rust (Axum)".to_string());
            }
            if lower_body.contains("actix-web") {
                set.insert("Rust (Actix-web)".to_string());
            }
            if lower_body.contains("rocket") {
                set.insert("Rust (Rocket)".to_string());
            }
        } else if lower_path.ends_with("package.json") {
            if lower_body.contains("\"next\"") {
                set.insert("Next.js".to_string());
            }
            if lower_body.contains("\"@nestjs/") {
                set.insert("NestJS".to_string());
            }
            if lower_body.contains("\"express\"") {
                set.insert("Express".to_string());
            }
            if lower_body.contains("\"fastify\"") {
                set.insert("Fastify".to_string());
            }
            if lower_body.contains("\"hono\"") {
                set.insert("Hono".to_string());
            }
        } else if lower_path.ends_with("go.mod") {
            if lower_body.contains("gin-gonic/gin") {
                set.insert("Go (Gin)".to_string());
            }
            if lower_body.contains("gofiber/fiber") {
                set.insert("Go (Fiber)".to_string());
            }
            if lower_body.contains("labstack/echo") {
                set.insert("Go (Echo)".to_string());
            }
        } else if lower_path.ends_with("requirements.txt") || lower_path.ends_with("pyproject.toml") {
            if lower_body.contains("fastapi") {
                set.insert("Python (FastAPI)".to_string());
            }
            if lower_body.contains("flask") {
                set.insert("Python (Flask)".to_string());
            }
            if lower_body.contains("django") {
                set.insert("Python (Django)".to_string());
            }
        } else if lower_path.ends_with("composer.json") && lower_body.contains("laravel") {
            set.insert("PHP (Laravel)".to_string());
        }
    }
    if set.is_empty() {
        if all_paths.iter().any(|p| p.ends_with(".rs")) {
            set.insert("Rust".to_string());
        } else if all_paths.iter().any(|p| p.ends_with(".ts") || p.ends_with(".js")) {
            set.insert("Node.js / TypeScript".to_string());
        } else if all_paths.iter().any(|p| p.ends_with(".py")) {
            set.insert("Python".to_string());
        } else if all_paths.iter().any(|p| p.ends_with(".go")) {
            set.insert("Go".to_string());
        }
    }
    set.into_iter().collect()
}

fn analyze_files(
    source_type: &str,
    source_label: &str,
    suggested_name: &str,
    branch: Option<String>,
    all_paths: &[String],
    files: &[(String, String)],
) -> CodeSummaryResult {
    let frameworks = detect_frameworks(files, all_paths);
    let mut spec_files = Vec::new();
    let mut endpoints = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut has_bearer_auth = false;

    for (path, content) in files {
        let lower = content.to_lowercase();
        if lower.contains("bearer") || lower.contains("authorization") || lower.contains("jwt") {
            has_bearer_auth = true;
        }
        if is_spec_file(path) {
            spec_files.push(path.clone());
            if let Ok(parsed) = normalize_project(&json!({ "content": content, "filename": path })) {
                let items = parsed
                    .pointer("/project/items")
                    .or_else(|| parsed.get("items"))
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let mut flat_items = Vec::new();
                flatten_imported_items(&items, None, &mut flat_items);
                for (folder_opt, item) in flat_items {
                    let method = item
                        .get("method")
                        .and_then(|v| v.as_str())
                        .unwrap_or("GET")
                        .to_uppercase();
                    let url = item
                        .get("url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("/")
                        .to_string();
                    let clean_path = strip_base_from_url(&url);
                    if seen.insert((method.clone(), clean_path.clone())) {
                        let folder = folder_opt
                            .filter(|s| !s.is_empty())
                            .unwrap_or_else(|| folder_from_path(&clean_path, path));
                        endpoints.push(DiscoveredEndpoint {
                            id: format!("ep-{}", endpoints.len() + 1),
                            name: item
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&clean_path)
                                .to_string(),
                            method,
                            path: clean_path,
                            folder,
                            source_file: path.clone(),
                            description: item
                                .get("description")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            auth_hint: None,
                            sample_body: item
                                .get("payload")
                                .and_then(|v| serde_json::to_string_pretty(v).ok()),
                            selected: true,
                        });
                    }
                }
            }
        }
    }

    // Static source-code route extraction across common backend frameworks.
    for (path, content) in files {
        if !is_code_file(&path.to_lowercase()) {
            continue;
        }
        for ep in extract_routes_from_code(path, content, has_bearer_auth) {
            if seen.insert((ep.method.clone(), ep.path.clone())) {
                let mut item = ep;
                item.id = format!("ep-{}", endpoints.len() + 1);
                endpoints.push(item);
            }
        }
    }

    let folders: Vec<String> = endpoints
        .iter()
        .map(|e| e.folder.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    let auth_summary = if has_bearer_auth {
        "Bearer / JWT Authorization detected in route or middleware files".to_string()
    } else {
        "No explicit auth middleware detected (configure headers/env vars if needed)".to_string()
    };

    let fw_label = if frameworks.is_empty() {
        "Custom API codebase".to_string()
    } else {
        frameworks.join(", ")
    };

    let summary_markdown = format!(
        "### {suggested_name}\n- **Stack:** {fw_label}\n- **Files scanned:** {} ({} specs)\n- **Endpoints discovered:** {} across {} folders\n- **Auth:** {auth_summary}",
        files.len(),
        spec_files.len(),
        endpoints.len(),
        folders.len(),
    );

    CodeSummaryResult {
        source_type: source_type.to_string(),
        source_label: source_label.to_string(),
        suggested_name: suggested_name.to_string(),
        branch,
        default_base_url: "http://localhost:8000".to_string(),
        frameworks,
        auth_summary,
        summary_markdown,
        ai_enhanced: false,
        spec_files,
        files_scanned: files.len(),
        folders,
        endpoints,
    }
}

fn flatten_imported_items(
    items: &[Value],
    current_folder: Option<&str>,
    out: &mut Vec<(Option<String>, Value)>,
) {
    for item in items {
        if item.get("kind").and_then(|v| v.as_str()) == Some("folder")
            || item.get("items").is_some()
        {
            let fname = item
                .get("name")
                .and_then(|v| v.as_str())
                .or(current_folder);
            if let Some(children) = item.get("items").and_then(|v| v.as_array()) {
                flatten_imported_items(children, fname, out);
            }
        } else {
            out.push((current_folder.map(str::to_string), item.clone()));
        }
    }
}

fn strip_base_from_url(url: &str) -> String {
    if let Some(idx) = url.find("://") {
        let rest = &url[idx + 3..];
        if let Some(slash) = rest.find('/') {
            return rest[slash..].to_string();
        }
        return "/".to_string();
    }
    if url.starts_with("{{") {
        if let Some(end) = url.find("}}") {
            let after = &url[end + 2..];
            if after.is_empty() {
                return "/".to_string();
            }
            return after.to_string();
        }
    }
    if url.starts_with('/') {
        url.to_string()
    } else {
        format!("/{url}")
    }
}

fn folder_from_path(route_path: &str, file_path: &str) -> String {
    let segs: Vec<&str> = route_path
        .trim_start_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    let candidate = if segs.first() == Some(&"api") || segs.first() == Some(&"v1") || segs.first() == Some(&"v2") {
        segs.get(1).copied()
    } else {
        segs.first().copied()
    };
    if let Some(s) = candidate {
        let clean = s.trim_start_matches(':').trim_matches(|c| c == '{' || c == '}');
        if !clean.is_empty() {
            return capitalize(clean);
        }
    }
    let stem = file_path
        .rsplit('/')
        .next()
        .unwrap_or("General")
        .split('.')
        .next()
        .unwrap_or("General");
    capitalize(stem)
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => "General".to_string(),
    }
}

fn extract_routes_from_code(
    file_path: &str,
    content: &str,
    has_bearer_auth: bool,
) -> Vec<DiscoveredEndpoint> {
    let mut out = Vec::new();
    let auth_hint = if has_bearer_auth {
        Some("Bearer {{token}}".to_string())
    } else {
        None
    };

    // 1. Next.js App Router: app/api/**/route.{ts,js}
    let lower_path = file_path.to_lowercase();
    if lower_path.ends_with("/route.ts")
        || lower_path.ends_with("/route.js")
        || lower_path.ends_with("/route.mts")
    {
        if let Some(api_idx) = lower_path.find("/api/") {
            let sub = &file_path[api_idx..file_path.len() - "/route.ts".len()];
            let route = sub.replace('[', ":").replace(']', "");
            for method in ["GET", "POST", "PUT", "PATCH", "DELETE"] {
                let pat = format!("function {method}");
                let pat2 = format!("const {method}");
                if content.contains(&pat) || content.contains(&pat2) {
                    out.push(DiscoveredEndpoint {
                        id: String::new(),
                        name: format!("{method} {route}"),
                        method: method.to_string(),
                        path: route.clone(),
                        folder: folder_from_path(&route, file_path),
                        source_file: file_path.to_string(),
                        description: format!("Next.js route handler ({file_path})"),
                        auth_hint: auth_hint.clone(),
                        sample_body: default_sample_body(method),
                        selected: true,
                    });
                }
            }
            return out;
        }
    }

    // 2. NestJS controller prefix
    let controller_prefix = Regex::new(r#"@Controller\(\s*['"`]([^'"`]*)['"`]\s*\)"#)
        .ok()
        .and_then(|re| re.captures(content))
        .and_then(|c| c.get(1).map(|m| m.as_str().trim_matches('/').to_string()));

    if let Some(prefix) = controller_prefix {
        if let Ok(re) = Regex::new(r#"@(Get|Post|Put|Patch|Delete|Head|Options)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)"#) {
            for cap in re.captures_iter(content) {
                let method = cap[1].to_uppercase();
                let sub = cap.get(2).map(|m| m.as_str().trim_matches('/')).unwrap_or("");
                let full_path = match (prefix.is_empty(), sub.is_empty()) {
                    (true, true) => "/".to_string(),
                    (false, true) => format!("/{prefix}"),
                    (true, false) => format!("/{sub}"),
                    (false, false) => format!("/{prefix}/{sub}"),
                };
                out.push(DiscoveredEndpoint {
                    id: String::new(),
                    name: format!("{method} {full_path}"),
                    method: method.clone(),
                    path: full_path.clone(),
                    folder: folder_from_path(&full_path, file_path),
                    source_file: file_path.to_string(),
                    description: format!("NestJS endpoint ({file_path})"),
                    auth_hint: auth_hint.clone(),
                    sample_body: default_sample_body(&method),
                    selected: true,
                });
            }
        }
    }

    // 3. Axum: .route("/path", get(...).post(...))
    if let Ok(re) = Regex::new(r#"\.route\(\s*"([^"]+)"\s*,\s*([^\n;]+)"#) {
        for cap in re.captures_iter(content) {
            let path = cap[1].to_string();
            let chain = &cap[2];
            for (fn_name, method) in [
                ("get(", "GET"),
                ("post(", "POST"),
                ("put(", "PUT"),
                ("patch(", "PATCH"),
                ("delete(", "DELETE"),
            ] {
                if chain.contains(fn_name) {
                    out.push(DiscoveredEndpoint {
                        id: String::new(),
                        name: format!("{method} {path}"),
                        method: method.to_string(),
                        path: path.clone(),
                        folder: folder_from_path(&path, file_path),
                        source_file: file_path.to_string(),
                        description: format!("Axum route ({file_path})"),
                        auth_hint: auth_hint.clone(),
                        sample_body: default_sample_body(method),
                        selected: true,
                    });
                }
            }
        }
    }

    // 4. Express / Fastify / Hono / Go Gin / Fiber / Echo / Laravel
    if let Ok(re) = Regex::new(
        r#"(?i)\b(?:app|router|r|e|v\d+|api|route)\.(get|post|put|patch|delete|head|options)\(\s*['"`]([^'"`]+)['"`]"#,
    ) {
        for cap in re.captures_iter(content) {
            let method = cap[1].to_uppercase();
            let raw_path = cap[2].to_string();
            if !raw_path.starts_with('/') {
                continue;
            }
            out.push(DiscoveredEndpoint {
                id: String::new(),
                name: format!("{method} {raw_path}"),
                method: method.clone(),
                path: raw_path.clone(),
                folder: folder_from_path(&raw_path, file_path),
                source_file: file_path.to_string(),
                description: format!("Route defined in {file_path}"),
                auth_hint: auth_hint.clone(),
                sample_body: default_sample_body(&method),
                selected: true,
            });
        }
    }

    // 5. Python FastAPI / Flask decorators & Actix-web attributes
    if let Ok(re) = Regex::new(
        r#"(?i)(?:@|#\[)(?:app|router|bp)?\.?(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]"#,
    ) {
        for cap in re.captures_iter(content) {
            let method = cap[1].to_uppercase();
            let raw_path = cap[2].to_string();
            if !raw_path.starts_with('/') {
                continue;
            }
            out.push(DiscoveredEndpoint {
                id: String::new(),
                name: format!("{method} {raw_path}"),
                method: method.clone(),
                path: raw_path.clone(),
                folder: folder_from_path(&raw_path, file_path),
                source_file: file_path.to_string(),
                description: format!("Decorator route ({file_path})"),
                auth_hint: auth_hint.clone(),
                sample_body: default_sample_body(&method),
                selected: true,
            });
        }
    }

    // 6. Laravel Route::get('/path', ...)
    if let Ok(re) = Regex::new(r#"(?i)Route::(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]"#) {
        for cap in re.captures_iter(content) {
            let method = cap[1].to_uppercase();
            let p = cap[2].to_string();
            let path = if p.starts_with('/') { p } else { format!("/{p}") };
            out.push(DiscoveredEndpoint {
                id: String::new(),
                name: format!("{method} {path}"),
                method: method.clone(),
                path: path.clone(),
                folder: folder_from_path(&path, file_path),
                source_file: file_path.to_string(),
                description: format!("Laravel route ({file_path})"),
                auth_hint: auth_hint.clone(),
                sample_body: default_sample_body(&method),
                selected: true,
            });
        }
    }

    out
}

fn default_sample_body(method: &str) -> Option<String> {
    if matches!(method, "POST" | "PUT" | "PATCH") {
        Some("{\n  \n}".to_string())
    } else {
        None
    }
}

async fn enhance_summary_with_ai(
    gateway: &GatewayEngine,
    base: &CodeSummaryResult,
    files: &[(String, String)],
) -> Option<CodeSummaryResult> {
    let mut snippet = String::new();
    for (path, content) in files.iter().take(12) {
        let preview: String = content.chars().take(1600).collect();
        snippet.push_str(&format!("\n--- {path} ---\n{preview}\n"));
        if snippet.len() > 14_000 {
            break;
        }
    }

    let existing_eps = serde_json::to_string(&base.endpoints).unwrap_or_default();
    let prompt = format!(
        "Analyze this API codebase and return ONLY valid JSON (no markdown fences) with:\n\
         {{\n  \"summary_markdown\": \"concise 3-5 bullet markdown summary of architecture, auth, and modules\",\n\
           \"default_base_url\": \"e.g. http://localhost:3000\",\n\
           \"auth_summary\": \"short auth description\",\n\
           \"endpoints\": [{{\"method\": \"GET\", \"path\": \"/example\", \"name\": \"Human name\", \"folder\": \"Group\", \"description\": \"short desc\", \"sample_body\": null}}]\n\
         }}\n\n\
         Source: {} (frameworks: {:?})\n\
         Pre-extracted endpoints: {}\n\n\
         Code excerpts:\n{}",
        base.source_label, base.frameworks, existing_eps, snippet
    );

    let req = json!({
        "model": "auto",
        "stream": false,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": "You are an expert API architect extracting clean, accurate REST endpoint collections from source code. Output ONLY valid JSON." },
            { "role": "user", "content": prompt }
        ]
    });

    let resp = gateway.chat_completions(req).await.ok()?;
    let bytes = axum::body::to_bytes(resp.into_body(), 512_000).await.ok()?;
    let resp_json: Value = serde_json::from_slice(&bytes).ok()?;
    let content = resp_json
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())?;

    let cleaned = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let parsed: Value = serde_json::from_str(cleaned).ok()?;
    let mut updated = base.clone();
    if let Some(s) = parsed.get("summary_markdown").and_then(|v| v.as_str()) {
        if !s.trim().is_empty() {
            updated.summary_markdown = s.trim().to_string();
        }
    }
    if let Some(b) = parsed.get("default_base_url").and_then(|v| v.as_str()) {
        if !b.trim().is_empty() {
            updated.default_base_url = b.trim().to_string();
        }
    }
    if let Some(a) = parsed.get("auth_summary").and_then(|v| v.as_str()) {
        if !a.trim().is_empty() {
            updated.auth_summary = a.trim().to_string();
        }
    }
    if let Some(arr) = parsed.get("endpoints").and_then(|v| v.as_array()) {
        if !arr.is_empty() {
            let mut merged: Vec<DiscoveredEndpoint> = Vec::new();
            let mut seen = HashSet::new();
            let source_map: HashMap<(String, String), String> = base
                .endpoints
                .iter()
                .map(|e| ((e.method.clone(), e.path.clone()), e.source_file.clone()))
                .collect();

            for ep in arr {
                let method = ep
                    .get("method")
                    .and_then(|v| v.as_str())
                    .unwrap_or("GET")
                    .to_uppercase();
                let path = ep
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("/")
                    .to_string();
                if !seen.insert((method.clone(), path.clone())) {
                    continue;
                }
                let sample_body = match ep.get("sample_body") {
                    Some(Value::String(s)) => Some(s.clone()),
                    Some(v) if v.is_object() || v.is_array() => serde_json::to_string_pretty(v).ok(),
                    _ => default_sample_body(&method),
                };
                merged.push(DiscoveredEndpoint {
                    id: format!("ep-{}", merged.len() + 1),
                    name: ep
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&path)
                        .to_string(),
                    method: method.clone(),
                    path: path.clone(),
                    folder: ep
                        .get("folder")
                        .and_then(|v| v.as_str())
                        .unwrap_or("API")
                        .to_string(),
                    source_file: source_map
                        .get(&(method, path))
                        .cloned()
                        .unwrap_or_else(|| "ai-analyzed".to_string()),
                    description: ep
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    auth_hint: None,
                    sample_body,
                    selected: true,
                });
            }
            if !merged.is_empty() {
                updated.folders = merged
                    .iter()
                    .map(|e| e.folder.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect();
                updated.endpoints = merged;
            }
        }
    }
    updated.ai_enhanced = true;
    Some(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_routes_across_frameworks() {
        let axum_src = r#"
            Router::new()
                .route("/users", get(list_users).post(create_user))
                .route("/users/:id", delete(delete_user))
        "#;
        let eps = extract_routes_from_code("src/lib.rs", axum_src, true);
        assert_eq!(eps.len(), 3);
        assert_eq!(eps[0].method, "GET");
        assert_eq!(eps[0].path, "/users");
        assert_eq!(eps[1].method, "POST");
        assert_eq!(eps[2].method, "DELETE");
        assert_eq!(eps[0].auth_hint.as_deref(), Some("Bearer {{token}}"));

        let express_src = r#"
            router.get('/orders', listOrders);
            app.post('/orders', createOrder);
        "#;
        let eps2 = extract_routes_from_code("routes/orders.ts", express_src, false);
        assert_eq!(eps2.len(), 2);
        assert_eq!(eps2[0].folder, "Orders");

        let nest_src = r#"
            @Controller('billing')
            export class BillingController {
                @Get('invoices')
                list() {}
                @Post('invoices')
                create() {}
            }
        "#;
        let eps3 = extract_routes_from_code("src/billing.controller.ts", nest_src, false);
        assert_eq!(eps3.len(), 2);
        assert_eq!(eps3[0].path, "/billing/invoices");
        assert_eq!(eps3[1].method, "POST");
    }

    #[test]
    fn disconnected_status_when_missing() {
        let dir = std::env::temp_dir().join(format!("beacon-gh-test-{}", uuid::Uuid::new_v4()));
        let st = get_status(&dir);
        assert!(!st.connected);
        assert!(st.login.is_none());
    }
}

#[cfg(test)]
mod source_tests {
    use super::*;

    #[test]
    fn parses_code_sources() {
        let gh = |repo: &str, branch: Option<&str>| CodeSource::GitHub { repo: repo.into(), branch: branch.map(Into::into) };
        assert_eq!(parse_code_source("acme/shop-api"), gh("acme/shop-api", None));
        assert_eq!(parse_code_source("https://github.com/acme/shop-api.git"), gh("acme/shop-api", None));
        assert_eq!(parse_code_source("github.com/acme/shop-api/tree/feat/x"), gh("acme/shop-api", Some("feat/x")));
        let here = std::env::current_dir().unwrap();
        assert_eq!(parse_code_source(here.to_str().unwrap()), CodeSource::Local(here));
        assert!(matches!(parse_code_source("./missing/dir"), CodeSource::Local(_)));
    }
}
