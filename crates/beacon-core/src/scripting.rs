//! Pre-request scripts: user Python run out of process in a restricted sandbox.
//!
//! Scripts come from project files that can be shared, so they are untrusted. Each
//! run starts the system `python3 -I` on the embedded `script_sandbox.py` (AST checks,
//! import allowlist, rlimits) with an empty environment, a temp-dir cwd, and a hard
//! deadline; the process is killed if it does not answer in time.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

const SANDBOX_SRC: &str = include_str!("script_sandbox.py");
const SCRIPT_TIMEOUT_S: u64 = 5;
/// Grace on top of the in-sandbox deadline: covers interpreter startup and C-level hangs.
const HARD_TIMEOUT_GRACE_S: u64 = 3;

#[derive(Debug, Clone)]
pub struct ScriptResult {
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Value,
    /// Variables the script created or changed (stringified, like every config variable).
    pub changed_vars: HashMap<String, String>,
}

fn python_cmd() -> &'static str {
    if cfg!(windows) { "python" } else { "python3" }
}

fn stringify(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Run `script` against the resolved request. `Err` carries a user-facing message;
/// the caller sends the request unmodified in that case.
pub async fn run_pre_request(
    script: &str,
    url: &str,
    method: &str,
    headers: &HashMap<String, String>,
    body: &Value,
    variables: &HashMap<String, String>,
) -> Result<ScriptResult, String> {
    // A fresh file per run: nothing for another process to swap between runs.
    let dir = std::env::temp_dir();
    let path = dir.join(format!("beacon-script-sandbox-{}.py", uuid::Uuid::new_v4().simple()));
    std::fs::write(&path, SANDBOX_SRC).map_err(|e| format!("Could not prepare the script sandbox: {e}"))?;
    let result = run_in(&path, &dir, script, url, method, headers, body, variables).await;
    let _ = std::fs::remove_file(&path);
    result
}

#[allow(clippy::too_many_arguments)]
async fn run_in(
    sandbox: &std::path::Path,
    cwd: &std::path::Path,
    script: &str,
    url: &str,
    method: &str,
    headers: &HashMap<String, String>,
    body: &Value,
    variables: &HashMap<String, String>,
) -> Result<ScriptResult, String> {
    let mut cmd = Command::new(python_cmd());
    // -I: ignore PYTHON* env vars, user site-packages and the script's directory.
    cmd.arg("-I").arg(sandbox).env_clear().env("PYTHONIOENCODING", "utf-8").current_dir(cwd);
    #[cfg(windows)]
    for key in ["SYSTEMROOT", "TEMP", "TMP"] {
        if let Ok(v) = std::env::var(key) {
            cmd.env(key, v);
        }
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("Pre-request script skipped: '{}' was not found. Install Python 3 to run scripts.", python_cmd())
        } else {
            format!("Could not start the script sandbox: {e}")
        }
    })?;

    let request = json!({
        "script": script,
        "timeout": SCRIPT_TIMEOUT_S,
        "context": { "url": url, "method": method, "headers": headers, "body": body, "variables": variables },
    });
    let mut stdin = child.stdin.take().ok_or("Script sandbox has no stdin")?;
    let stdout = child.stdout.take().ok_or("Script sandbox has no stdout")?;

    let exchange = async move {
        stdin.write_all(format!("{request}\n").as_bytes()).await.map_err(|e| format!("Script sandbox failed: {e}"))?;
        drop(stdin); // EOF ends the worker loop after this one request
        let mut line = String::new();
        BufReader::new(stdout).read_line(&mut line).await.map_err(|e| format!("Script sandbox failed: {e}"))?;
        Ok::<String, String>(line)
    };
    let line = match tokio::time::timeout(Duration::from_secs(SCRIPT_TIMEOUT_S + HARD_TIMEOUT_GRACE_S), exchange).await {
        Ok(r) => r?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(format!("Script timed out after {SCRIPT_TIMEOUT_S} seconds"));
        }
    };
    let _ = child.kill().await;
    if line.trim().is_empty() {
        return Err("Script sandbox exited without a result".into());
    }
    let reply: Value = serde_json::from_str(&line).map_err(|e| format!("Script sandbox returned invalid output: {e}"))?;
    if reply["ok"] != json!(true) {
        return Err(reply["error"].as_str().unwrap_or("Script failed").to_string());
    }

    let ctx = &reply["context"];
    let headers = ctx["headers"]
        .as_object()
        .map(|h| h.iter().map(|(k, v)| (k.clone(), stringify(v))).collect())
        .unwrap_or_else(|| headers.clone());
    let changed_vars = ctx["variables"]
        .as_object()
        .map(|vars| {
            vars.iter()
                .map(|(k, v)| (k.clone(), stringify(v)))
                .filter(|(k, v)| variables.get(k) != Some(v))
                .collect()
        })
        .unwrap_or_default();
    Ok(ScriptResult {
        url: ctx["url"].as_str().unwrap_or(url).to_string(),
        headers,
        body: ctx.get("body").cloned().unwrap_or_else(|| body.clone()),
        changed_vars,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has_python() -> bool {
        std::process::Command::new(python_cmd()).arg("--version").output().is_ok()
    }

    #[tokio::test]
    async fn script_sets_vars_and_headers_and_is_sandboxed() {
        if !has_python() {
            eprintln!("skipping: no python3");
            return;
        }
        let vars = HashMap::from([("a".to_string(), "1".to_string())]);
        let r = run_pre_request(
            "beacon.environment.set('tok', 'x' + beacon.environment.get('a'))\nbeacon.request.headers['X-T'] = 5",
            "http://h/p", "GET", &HashMap::new(), &json!({}), &vars,
        )
        .await
        .unwrap();
        assert_eq!(r.changed_vars, HashMap::from([("tok".to_string(), "x1".to_string())]));
        assert_eq!(r.headers["X-T"], "5");

        let err = run_pre_request("import os", "u", "GET", &HashMap::new(), &json!({}), &vars).await.unwrap_err();
        assert!(err.contains("not available"), "{err}");
        let err = run_pre_request("while True: pass", "u", "GET", &HashMap::new(), &json!({}), &vars).await.unwrap_err();
        assert!(err.contains("timed out"), "{err}");
    }
}
