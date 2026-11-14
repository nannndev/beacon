//! Small, constrained Git client for linked Beacon project folders
//! (port of the Python `project_git.py`). Every call is an argument array
//! to the system `git`; no shell is ever involved.
use crate::file_sync::MANIFEST;
use crate::store::Project;
use serde_json::{json, Map, Value};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;

type R<T> = Result<T, String>;
const TIMEOUT: Duration = Duration::from_secs(45);
const NETWORK_TIMEOUT: Duration = Duration::from_secs(30);
const CLONE_TIMEOUT: Duration = Duration::from_secs(120);
pub const MANAGED_PATHS: [&str; 4] = ["beacon.yaml", "endpoints", "environments", ".gitignore"];
const MAX_PATCH_BYTES: usize = 256_000;

pub fn root(project: &Project) -> R<PathBuf> {
    let path = project.file_sync.as_ref().and_then(|m| m.get("path")).and_then(|p| p.as_str()).unwrap_or("");
    let root = PathBuf::from(path);
    if !root.is_absolute() || !root.is_dir() || !root.join(MANIFEST).is_file() {
        return Err("Link this project to a valid folder before using Git".into());
    }
    root.canonicalize().map_err(|e| e.to_string())
}

fn git_available() -> bool {
    std::process::Command::new("git").arg("--version").output().is_ok()
}

async fn run_with(root: &Path, args: &[&str], timeout: Duration) -> R<String> {
    let child = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o ConnectionAttempts=1")
        .kill_on_drop(true)
        .output();
    let output = match tokio::time::timeout(timeout, child).await {
        Err(_) => return Err("Git connection timed out. Check the remote URL, network, and device credentials".into()),
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => return Err("Git is not installed or is not available in PATH".into()),
        Ok(Err(e)) => return Err(format!("Could not run git: {e}")),
        Ok(Ok(out)) => out,
    };
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = if stderr.is_empty() { stdout.trim().to_string() } else { stderr };
        let lowered = detail.to_lowercase();
        let detail = if lowered.contains("repository not found") {
            "Remote repository was not found. Check the origin URL and your repository access".into()
        } else if lowered.contains("permission denied (publickey)") {
            "GitHub rejected this SSH key. Add the device key to GitHub, or change origin from git@github.com:… to https://github.com/… to use GitHub CLI credentials".into()
        } else if ["terminal prompts disabled", "authentication failed", "could not read from remote repository"].iter().any(|m| lowered.contains(m)) {
            "Git authentication failed. Sign in with your device's Git credential manager or SSH key".into()
        } else if lowered.contains("host key verification failed") {
            "The Git host identity could not be verified. Check your SSH known_hosts configuration".into()
        } else if detail.is_empty() {
            format!("git {} failed", args.first().unwrap_or(&""))
        } else {
            detail
        };
        return Err(detail);
    }
    // Porcelain status has meaningful leading spaces; only trim the tail.
    Ok(stdout.trim_end().to_string())
}

async fn run(root: &Path, args: &[&str]) -> R<String> {
    run_with(root, args, TIMEOUT).await
}

async fn is_repo(root: &Path) -> bool {
    run(root, &["rev-parse", "--is-inside-work-tree"]).await.is_ok()
}

async fn require_clean(root: &Path) -> R<()> {
    let output = run(root, &["status", "--porcelain=v1", "--untracked-files=all"]).await?;
    let lines: Vec<&str> = output.lines().filter(|l| !l.is_empty()).collect();
    if lines.is_empty() {
        return Ok(());
    }
    let paths: Vec<String> = lines.iter().take(3).map(|l| l.get(3..).unwrap_or(l).trim_matches('"').to_string()).collect();
    Err(format!(
        "Commit, stash, or discard all repository changes before switching branches (including {}{})",
        paths.join(", "),
        if lines.len() > 3 { "…" } else { "" }
    ))
}

async fn validate_branch_name(root: &Path, name: &str) -> R<String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 200 || name.contains('\n') || name.contains('\r') {
        return Err("Enter a valid branch name".into());
    }
    run(root, &["check-ref-format", "--branch", name]).await.map_err(|_| "Enter a valid branch name".to_string())?;
    Ok(name.to_string())
}

async fn validate_project_on_ref(root: &Path, git_ref: &str, project_id: &str) -> R<()> {
    let text = run(root, &["show", &format!("{git_ref}:{MANIFEST}")]).await
        .map_err(|_| "That branch does not contain a valid Beacon project".to_string())?;
    let manifest: Value = serde_yaml::from_str(&text).map_err(|_| "That branch does not contain a valid Beacon project".to_string())?;
    if manifest.get("format").and_then(|f| f.as_str()) != Some("beacon.project") || manifest.get("version").and_then(|v| v.as_i64()) != Some(1) {
        return Err("That branch does not contain a supported Beacon project".into());
    }
    let linked = manifest.get("project").and_then(|p| p.get("id")).map(|id| match id {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }).unwrap_or_default();
    if linked != project_id {
        return Err("That branch belongs to a different Beacon project".into());
    }
    Ok(())
}

async fn remote_url(root: &Path) -> Option<String> {
    run(root, &["remote", "get-url", "origin"]).await.ok().filter(|u| !u.is_empty())
}

pub async fn branches(project: &Project) -> R<Value> {
    let root = root(project)?;
    if !is_repo(&root).await {
        return Err("Initialize Git before managing branches".into());
    }
    let current = run(&root, &["branch", "--show-current"]).await?;
    let current = if current.is_empty() { None } else { Some(current) };
    let mut local = Vec::new();
    let mut local_names = Vec::new();
    let raw = run(&root, &["for-each-ref", "--format=%(refname:short)%00%(upstream:short)%00%(HEAD)", "refs/heads"]).await?;
    for line in raw.lines() {
        let fields: Vec<&str> = line.split('\0').collect();
        let name = fields.first().copied().unwrap_or("");
        if name.is_empty() {
            continue;
        }
        local_names.push(name.to_string());
        let upstream = fields.get(1).copied().filter(|u| !u.is_empty());
        local.push(json!({ "name": name, "full_name": name, "kind": "local", "current": Some(name) == current.as_deref(), "upstream": upstream }));
    }
    let mut remote = Vec::new();
    for name in run(&root, &["for-each-ref", "--format=%(refname:short)", "refs/remotes"]).await?.lines() {
        if name.is_empty() || name.ends_with("/HEAD") {
            continue;
        }
        let local_name = name.split_once('/').map(|(_, n)| n).unwrap_or(name);
        let tracked = local_names.iter().any(|n| n == local_name);
        remote.push(json!({ "name": local_name, "full_name": name, "kind": "remote", "current": false, "upstream": null, "local_name": if tracked { Some(local_name) } else { None } }));
    }
    Ok(json!({ "current": current, "remote_url": remote_url(&root).await, "local": local, "remote": remote }))
}

pub async fn fetch(project: &Project) -> R<Value> {
    let root = root(project)?;
    if branches(project).await?["remote_url"].is_null() {
        return Err("Add an origin remote before fetching branches".into());
    }
    run_with(&root, &["fetch", "--prune", "origin"], TIMEOUT).await?;
    branches(project).await
}

pub async fn create_branch(project: &Project, name: &str) -> R<Value> {
    let root = root(project)?;
    if !is_repo(&root).await {
        return Err("Initialize Git before creating a branch".into());
    }
    require_clean(&root).await?;
    let name = validate_branch_name(&root, name).await?;
    run(&root, &["switch", "-c", &name]).await?;
    branches(project).await
}

/// Returns (ref to inspect, git args that switch to it).
async fn resolve_target(root: &Path, target: &str, state: &Value) -> R<(String, Vec<String>)> {
    let target = target.trim();
    let locals: Vec<&str> = state["local"].as_array().map(|a| a.iter().filter_map(|b| b["name"].as_str()).collect()).unwrap_or_default();
    if locals.contains(&target) {
        return Ok((target.into(), vec!["switch".into(), target.into()]));
    }
    let remote = state["remote"].as_array().and_then(|a| a.iter().find(|b| b["full_name"].as_str() == Some(target)));
    if let Some(item) = remote {
        let local_name = item["name"].as_str().unwrap_or("").to_string();
        if locals.contains(&local_name.as_str()) {
            return Ok((local_name.clone(), vec!["switch".into(), local_name]));
        }
        validate_branch_name(root, &local_name).await?;
        return Ok((target.into(), vec!["switch".into(), "--track".into(), "-c".into(), local_name, target.into()]));
    }
    Err("Refresh branches and choose an available local or remote branch".into())
}

pub async fn compare_branch(project: &Project, target: &str) -> R<Value> {
    let root = root(project)?;
    if !is_repo(&root).await {
        return Err("Initialize Git before comparing branches".into());
    }
    let state = branches(project).await?;
    let current = state["current"].clone();
    let (git_ref, _) = resolve_target(&root, target, &state).await?;
    validate_project_on_ref(&root, &git_ref, &project.id).await?;
    let mut out = json!({ "current": current, "target": target, "current_only_commits": 0, "target_only_commits": 0, "files": [], "summary": { "added": 0, "modified": 0, "deleted": 0 } });
    if Some(git_ref.as_str()) == state["current"].as_str() {
        return Ok(out);
    }
    if let Ok(counts) = run(&root, &["rev-list", "--left-right", "--count", &format!("HEAD...{git_ref}")]).await {
        let mut parts = counts.split_whitespace().map(|n| n.parse::<u64>().unwrap_or(0));
        out["current_only_commits"] = json!(parts.next().unwrap_or(0));
        out["target_only_commits"] = json!(parts.next().unwrap_or(0));
    }
    let mut base = vec!["diff", "--numstat", "--no-renames", "HEAD", &git_ref, "--"];
    base.extend(MANAGED_PATHS);
    let mut stats: Map<String, Value> = Map::new();
    for line in run(&root, &base).await?.lines() {
        let f: Vec<&str> = line.splitn(3, '\t').collect();
        if f.len() == 3 {
            stats.insert(f[2].into(), json!([f[0].parse::<u64>().unwrap_or(0), f[1].parse::<u64>().unwrap_or(0)]));
        }
    }
    base[1] = "--name-status";
    let mut files = Vec::new();
    for line in run(&root, &base).await?.lines() {
        let Some((code, path)) = line.split_once('\t') else { continue };
        let status = match code.chars().next() { Some('A') => "added", Some('D') => "deleted", _ => "modified" };
        let path = managed_file(path)?;
        let st = stats.get(&path).cloned().unwrap_or(json!([0, 0]));
        out["summary"][status] = json!(out["summary"][status].as_u64().unwrap_or(0) + 1);
        files.push(json!({ "path": path, "status": status, "additions": st[0], "deletions": st[1] }));
    }
    out["files"] = json!(files);
    Ok(out)
}

pub async fn switch_branch(project: &Project, target: &str) -> R<Value> {
    let root = root(project)?;
    if !is_repo(&root).await {
        return Err("Initialize Git before switching branches".into());
    }
    require_clean(&root).await?;
    let state = branches(project).await?;
    if Some(target) == state["current"].as_str() {
        return Ok(state);
    }
    let (git_ref, command) = resolve_target(&root, target, &state).await?;
    validate_project_on_ref(&root, &git_ref, &project.id).await?;
    let args: Vec<&str> = command.iter().map(String::as_str).collect();
    run(&root, &args).await?;
    branches(project).await
}

pub async fn status(project: &Project) -> R<Value> {
    let root = root(project)?;
    let mut out = json!({ "available": true, "repository": false, "branch": null, "remote_url": null, "upstream": null, "ahead": 0, "behind": 0, "changes": [], "message": "" });
    if !git_available() {
        out["available"] = json!(false);
        out["message"] = json!("Git is not installed or is not available in PATH");
        return Ok(out);
    }
    if !is_repo(&root).await {
        out["message"] = json!("This linked folder is not a Git repository yet");
        return Ok(out);
    }
    out["repository"] = json!(true);
    let branch = run(&root, &["branch", "--show-current"]).await?;
    out["branch"] = if branch.is_empty() { Value::Null } else { json!(branch) };
    out["remote_url"] = json!(remote_url(&root).await);
    if let Ok(upstream) = run(&root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).await {
        if !upstream.is_empty() {
            out["upstream"] = json!(upstream);
            if let Ok(counts) = run(&root, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).await {
                let mut parts = counts.split_whitespace().map(|n| n.parse::<u64>().unwrap_or(0));
                out["ahead"] = json!(parts.next().unwrap_or(0));
                out["behind"] = json!(parts.next().unwrap_or(0));
            }
        }
    }
    let mut args = vec!["status", "--porcelain=v1", "--untracked-files=all", "--"];
    args.extend(MANAGED_PATHS);
    let mut changes = Vec::new();
    for line in run(&root, &args).await?.lines() {
        if line.len() < 4 {
            continue;
        }
        let (code, mut path) = (&line[..2], &line[3..]);
        if let Some((_, renamed)) = path.split_once(" -> ") {
            path = renamed;
        }
        let code = code.trim();
        changes.push(json!({ "path": path.trim_matches('"'), "status": if code.is_empty() { "modified" } else { code } }));
    }
    let n = changes.len();
    out["message"] = json!(if n == 0 { "Working tree is clean".to_string() } else { format!("{n} file change{}", if n == 1 { "" } else { "s" }) });
    out["changes"] = json!(changes);
    Ok(out)
}

pub async fn init(project: &Project) -> R<Value> {
    let root = root(project)?;
    if !is_repo(&root).await {
        run(&root, &["init", "-b", "main"]).await?;
    }
    status(project).await
}

fn validate_url(url: &str, message: &str) -> R<String> {
    let url = url.trim();
    if url.is_empty() || url.len() > 2048 || url.contains('\n') || url.contains('\r') || url.starts_with('-') {
        return Err(message.into());
    }
    Ok(url.to_string())
}

/// Clone `remote_url` into a new folder under `parent`; returns the new folder.
pub async fn clone(remote_url: &str, parent: &str) -> R<PathBuf> {
    let remote_url = validate_url(remote_url, "Enter a valid Git repository URL")?;
    let parent = PathBuf::from(parent);
    if parent.as_os_str().is_empty() || !parent.is_absolute() || !parent.is_dir() {
        return Err("Choose an existing destination folder".into());
    }
    let parent = parent.canonicalize().map_err(|e| e.to_string())?;
    let tail = remote_url.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    let tail = if tail.contains('/') { tail } else { tail.rsplit(':').next().unwrap_or(tail) };
    let tail = tail.strip_suffix(".git").unwrap_or(tail);
    let mut name = String::new();
    for c in tail.chars() {
        if c.is_ascii_alphanumeric() || "._-".contains(c) {
            name.push(c);
        } else if !name.ends_with('-') {
            name.push('-');
        }
    }
    let name = name.trim_matches(|c| c == '.' || c == '-').to_string();
    if name.is_empty() {
        return Err("Could not determine the repository folder name".into());
    }
    let target = parent.join(&name);
    if target.exists() {
        return Err(format!("Destination already exists: {}", target.display()));
    }
    run_with(&parent, &["clone", "--", &remote_url, &target.to_string_lossy()], CLONE_TIMEOUT).await?;
    Ok(target)
}

pub async fn set_remote(project: &Project, url: &str) -> R<Value> {
    let root = root(project)?;
    if !is_repo(&root).await {
        return Err("Initialize Git before adding a remote".into());
    }
    let url = validate_url(url, "Enter a valid Git remote URL")?;
    if remote_url(&root).await.is_some() {
        run(&root, &["remote", "set-url", "origin", &url]).await?;
    } else {
        run(&root, &["remote", "add", "origin", &url]).await?;
    }
    status(project).await
}

pub async fn commit(project: &Project, message: &str) -> R<Value> {
    let root = root(project)?;
    if !is_repo(&root).await {
        return Err("Initialize Git before committing".into());
    }
    let message = message.trim();
    if message.is_empty() || message.len() > 200 || message.contains('\n') || message.contains('\r') {
        return Err("Commit message must be one line and no longer than 200 characters".into());
    }
    // `git add -A -- <dir>` is a hard pathspec error when <dir> doesn't exist yet
    // (e.g. a project with no endpoints never gets an `endpoints/` folder).
    let existing: Vec<&str> = MANAGED_PATHS.into_iter().filter(|p| root.join(p).exists()).collect();
    if existing.is_empty() {
        return Err("No Beacon project changes to commit".into());
    }
    let mut args = vec!["add", "-A", "--"];
    args.extend(existing);
    run(&root, &args).await?;
    if run(&root, &["diff", "--cached", "--name-only"]).await?.is_empty() {
        return Err("No Beacon project changes to commit".into());
    }
    run(&root, &["commit", "-m", message]).await?;
    status(project).await
}

pub async fn pull(project: &Project) -> R<Value> {
    let root = root(project)?;
    let current = status(project).await?;
    if !current["changes"].as_array().is_some_and(|c| c.is_empty()) {
        return Err("Commit or discard local Git changes before pulling".into());
    }
    if current["upstream"].is_null() {
        return Err("Set a remote and push this branch once before pulling".into());
    }
    run_with(&root, &["pull", "--ff-only"], NETWORK_TIMEOUT).await?;
    status(project).await
}

pub async fn push(project: &Project) -> R<Value> {
    let root = root(project)?;
    let current = status(project).await?;
    if current["remote_url"].is_null() {
        return Err("Add an origin remote before pushing".into());
    }
    let Some(branch) = current["branch"].as_str() else {
        return Err("Create a commit on a branch before pushing".into());
    };
    if current["upstream"].is_null() {
        run_with(&root, &["push", "-u", "origin", branch], NETWORK_TIMEOUT).await?;
    } else {
        run_with(&root, &["push"], NETWORK_TIMEOUT).await?;
    }
    status(project).await
}

fn managed_file(raw: &str) -> R<String> {
    let path = Path::new(raw);
    let parts: Vec<&str> = path.components().map(|c| match c {
        Component::Normal(p) => p.to_str().unwrap_or(""),
        _ => "",
    }).collect();
    if raw.is_empty() || path.is_absolute() || parts.iter().any(|p| p.is_empty()) {
        return Err("Invalid Git diff path".into());
    }
    let normalized = parts.join("/");
    let allowed = normalized == MANIFEST || normalized == ".gitignore"
        || (parts.len() >= 2 && (parts[0] == "endpoints" || parts[0] == "environments") && normalized.ends_with(".yaml"));
    if !allowed {
        return Err("Diff preview is limited to public Beacon project files".into());
    }
    Ok(normalized)
}

fn patch_counts(patch: &str) -> (u64, u64) {
    let (mut add, mut del) = (0, 0);
    for line in patch.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') { add += 1 } else if line.starts_with('-') { del += 1 }
    }
    (add, del)
}

fn untracked_patch(root: &Path, relative: &str) -> String {
    let Ok(data) = fs_read_inside(root, relative) else { return String::new() };
    if data.contains(&0) {
        return "Binary file preview is unavailable".into();
    }
    let text = String::from_utf8_lossy(&data);
    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return String::new();
    }
    let mut out = format!("--- /dev/null\n+++ b/{relative}\n@@ -0,0 +1,{} @@\n", lines.len());
    for l in lines {
        out.push('+');
        out.push_str(l);
        out.push('\n');
    }
    out
}

fn fs_read_inside(root: &Path, relative: &str) -> std::io::Result<Vec<u8>> {
    let target = root.join(relative).canonicalize()?;
    if !target.starts_with(root) {
        return Err(std::io::Error::other("outside root"));
    }
    std::fs::read(target)
}

pub async fn diff(project: &Project, scope: &str, selected: Option<&str>) -> R<Value> {
    let root = root(project)?;
    let current = status(project).await?;
    if current["repository"] != json!(true) {
        return Err("Initialize Git before viewing changes".into());
    }
    if scope != "working" && scope != "last_commit" {
        return Err("Diff scope must be working or last_commit".into());
    }
    let mut commit = Value::Null;
    let mut changed: Vec<(String, String)> = Vec::new();
    if scope == "working" {
        for item in current["changes"].as_array().unwrap_or(&Vec::new()) {
            changed.push((managed_file(item["path"].as_str().unwrap_or(""))?, item["status"].as_str().unwrap_or("").to_string()));
        }
    } else {
        let not_yet = || "Create the first commit before viewing commit history".to_string();
        let raw = run(&root, &["show", "-s", "--format=%H%x00%h%x00%s%x00%an%x00%cI", "HEAD"]).await.map_err(|_| not_yet())?;
        let f: Vec<&str> = raw.splitn(5, '\0').collect();
        if f.len() != 5 {
            return Err(not_yet());
        }
        commit = json!({ "id": f[0], "short_id": f[1], "subject": f[2], "author": f[3], "committed_at": f[4] });
        let mut args = vec!["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "HEAD", "--"];
        args.extend(MANAGED_PATHS);
        for line in run(&root, &args).await.map_err(|_| not_yet())?.lines() {
            let f: Vec<&str> = line.split('\t').collect();
            if f.len() >= 2 {
                changed.push((managed_file(f[f.len() - 1])?, f[0].to_string()));
            }
        }
    }
    if let Some(sel) = selected.filter(|s| !s.is_empty()) {
        let sel = managed_file(sel)?;
        if !changed.iter().any(|(p, _)| *p == sel) {
            return Err("That file is not part of the selected change set".into());
        }
        changed.retain(|(p, _)| *p == sel);
    }
    let mut files = Vec::new();
    for (path, st) in changed {
        let mut patch = if scope == "last_commit" {
            run(&root, &["show", "--format=", "--no-ext-diff", "--unified=3", "HEAD", "--", &path]).await?
        } else {
            run(&root, &["diff", "HEAD", "--no-ext-diff", "--unified=3", "--", &path]).await.unwrap_or_default()
        };
        if patch.is_empty() && st == "??" {
            patch = untracked_patch(&root, &path);
        }
        let truncated = patch.len() > MAX_PATCH_BYTES;
        if truncated {
            let mut cut = MAX_PATCH_BYTES;
            while !patch.is_char_boundary(cut) { cut -= 1 }
            patch.truncate(cut);
            patch.push_str("\n… diff truncated …");
        }
        let (additions, deletions) = patch_counts(&patch);
        files.push(json!({ "path": path, "status": st, "patch": patch, "additions": additions, "deletions": deletions, "truncated": truncated }));
    }
    Ok(json!({ "scope": scope, "commit": commit, "files": files }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_file_rules() {
        assert_eq!(managed_file("endpoints/a--1.yaml").unwrap(), "endpoints/a--1.yaml");
        assert!(managed_file("../beacon.yaml").is_err());
        assert!(managed_file("src/main.rs").is_err());
        assert!(managed_file("endpoints/notes.txt").is_err());
    }

    #[test]
    fn patch_counting() {
        assert_eq!(patch_counts("--- a\n+++ b\n@@\n+x\n+y\n-z\n"), (2, 1));
    }
}
