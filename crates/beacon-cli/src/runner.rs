//! Headless execution of a Git-backed Beacon project scope. Mirrors
//! `cli_runner.run_project`: builds a `TestConfig`/`EndpointTest` from the
//! loaded project tree and runs each endpoint through
//! `beacon_core::APITester::execute_single`, applying inherited auth,
//! retries, data rows, and bail exactly like the Python runner.

use crate::auth::{effective_auth, resolve_auth_headers};
use crate::datasets::Row;
use crate::error::CliError;
use crate::project::auth_chains;
use crate::report::{CliRunResult, ExecutionResult};
use beacon_core::{APITester, EndpointTest, TestConfig};
use serde_json::Value;
use std::collections::HashMap;

pub struct RunParams<'a> {
    pub project: &'a Value,
    pub endpoints: &'a [Value],
    pub environment: Option<&'a Value>,
    pub variables: HashMap<String, String>,
    pub scope: String,
    pub iterations: u32,
    pub retries: u32,
    pub retry_delay_ms: u64,
    pub bail: bool,
    pub data_rows: Option<&'a [Row]>,
}

pub async fn run_project<F>(params: RunParams<'_>, mut on_execution: F) -> Result<CliRunResult, CliError>
where
    F: FnMut(&ExecutionResult),
{
    if params.iterations < 1 {
        return Err(CliError::new("Iterations must be at least 1"));
    }

    let base_url = params.environment.and_then(|e| e.get("base_url")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let config = TestConfig::new(base_url, params.variables, Vec::new());
    let inherited_auth = auth_chains(params.project);

    let started = std::time::Instant::now();
    let started_at = chrono_like_now();
    let mut executions = Vec::new();
    let mut stopped_early = false;

    'iterations: for iteration in 1..=params.iterations {
        let data_row_number = if let Some(rows) = params.data_rows.filter(|r| !r.is_empty()) {
            let idx = (iteration as usize - 1) % rows.len();
            {
                let mut vars = config.variables.write();
                for (k, v) in &rows[idx] {
                    vars.insert(k.clone(), v.clone());
                }
            }
            Some(idx + 1)
        } else {
            None
        };

        for endpoint_data in params.endpoints {
            let endpoint_id = endpoint_data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mut endpoint: EndpointTest = serde_json::from_value(endpoint_data.clone())
                .map_err(|e| CliError::new(format!("Invalid endpoint {}: {}", endpoint_id, e)))?;

            // Resolve inherited auth into concrete headers, merged over any
            // hand-written header of the same name (a configured auth spec
            // is authoritative), before templating runs inside execute_single.
            let chain: Vec<Value> = {
                let mut c = inherited_auth.get(&endpoint_id).cloned().unwrap_or_default();
                if let Some(auth) = endpoint_data.get("auth") {
                    if !auth.is_null() {
                        c.push(auth.clone());
                    }
                }
                c
            };
            if let Some(resolved) = effective_auth(&chain) {
                let snapshot = config.snapshot_variables();
                let resolve = |s: &str| substitute_plain(s, &snapshot);
                let auth_headers = resolve_auth_headers(Some(&resolved), resolve);
                for (k, v) in auth_headers {
                    endpoint.headers.insert(k, Value::String(v));
                }
            }

            let execution = execute_with_retries(
                &endpoint,
                &config,
                params.retries,
                params.retry_delay_ms,
                iteration,
                data_row_number,
            )
            .await;

            on_execution(&execution);
            let passed = execution.passed;
            executions.push(execution);
            if params.bail && !passed {
                stopped_early = true;
                break 'iterations;
            }
        }
    }

    let duration_ms = started.elapsed().as_millis() as i64;
    let passed = !executions.is_empty() && executions.iter().all(|e| e.passed);
    Ok(CliRunResult {
        project_id: params.project.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        project_name: params.project.get("name").and_then(|v| v.as_str()).unwrap_or("Project").to_string(),
        environment_id: params.environment.and_then(|e| e.get("id")).and_then(|v| v.as_str()).map(|s| s.to_string()),
        environment_name: params.environment.and_then(|e| e.get("name")).and_then(|v| v.as_str()).map(|s| s.to_string()),
        scope: params.scope,
        started_at,
        duration_ms,
        passed,
        stopped_early,
        executions,
    })
}

/// Fire one endpoint, retrying a transport failure or non-2xx response up to
/// `retries` times with `retry_delay_ms` between attempts. Mirrors
/// `tester.py`'s `send_once` retry loop built atop `execute_single`.
async fn execute_with_retries(
    endpoint: &EndpointTest,
    config: &TestConfig,
    retries: u32,
    retry_delay_ms: u64,
    iteration: u32,
    data_row: Option<usize>,
) -> ExecutionResult {
    let total_attempts = retries + 1;
    for attempt in 1..=total_attempts {
        let is_last = attempt == total_attempts;
        let tester = APITester::new(endpoint.clone(), config.clone(), 1, 0, 1, None);
        match tester.execute_single().await {
            Ok(out) => {
                let http_ok = (200..300).contains(&out.status);
                if !http_ok && !is_last {
                    if retry_delay_ms > 0 {
                        tokio::time::sleep(std::time::Duration::from_millis(retry_delay_ms)).await;
                    }
                    continue;
                }
                let assertions_ok = out.assertions.iter().all(|a| a.ok);
                let passed = http_ok && assertions_ok;
                let mut error = None;
                if !http_ok {
                    error = Some(format!("HTTP {}", out.status));
                } else if !assertions_ok {
                    let failures: Vec<String> = out.assertions.iter().filter(|a| !a.ok).map(|a| a.message.clone()).collect();
                    error = Some(if failures.is_empty() { "Assertion failed".to_string() } else { failures.join("; ") });
                }
                let assertions_json: Vec<Value> = out
                    .assertions
                    .iter()
                    .map(|a| serde_json::to_value(a).unwrap_or(Value::Null))
                    .collect();
                return ExecutionResult {
                    endpoint_id: endpoint.id.clone(),
                    endpoint_name: endpoint.name.clone(),
                    method: endpoint.method.clone(),
                    target: endpoint.url.clone(),
                    iteration,
                    passed,
                    status: Some(out.status),
                    time_ms: Some(out.time_ms.round() as i64),
                    error,
                    assertions: assertions_json,
                    extracted: out.extracted,
                    attempts: attempt,
                    data_row,
                };
            }
            Err(err) => {
                if !is_last {
                    if retry_delay_ms > 0 {
                        tokio::time::sleep(std::time::Duration::from_millis(retry_delay_ms)).await;
                    }
                    continue;
                }
                return ExecutionResult {
                    endpoint_id: endpoint.id.clone(),
                    endpoint_name: endpoint.name.clone(),
                    method: endpoint.method.clone(),
                    target: endpoint.url.clone(),
                    iteration,
                    passed: false,
                    status: None,
                    time_ms: None,
                    error: Some(err),
                    assertions: Vec::new(),
                    extracted: Vec::new(),
                    attempts: attempt,
                    data_row,
                };
            }
        }
    }
    unreachable!("loop always returns on its last attempt")
}

fn substitute_plain(s: &str, variables: &HashMap<String, String>) -> String {
    let mut out = s.to_string();
    for (k, v) in variables {
        let token = format!("{{{{{}}}}}", k);
        out = out.replace(&token, v);
    }
    out
}

fn chrono_like_now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}
