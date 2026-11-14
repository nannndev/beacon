//! Run results, reports (`beacon.cli.report` v1 JSON + JUnit XML), and
//! GitHub Actions summary/annotations. Mirrors `cli_runner.ExecutionResult` /
//! `CliRunResult` / `write_json_report` / `write_junit_report` and
//! `cli_github.py`.

use crate::error::{CliError, CliResult};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

pub const REPORT_FORMAT: &str = "beacon.cli.report";
pub const REPORT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize)]
pub struct ExecutionResult {
    pub endpoint_id: String,
    pub endpoint_name: String,
    pub method: String,
    /// The project's templated URL, never the rendered request URL (which
    /// may contain secret query values).
    pub target: String,
    pub iteration: u32,
    pub passed: bool,
    pub status: Option<u16>,
    pub time_ms: Option<i64>,
    pub error: Option<String>,
    pub assertions: Vec<Value>,
    pub extracted: Vec<String>,
    pub attempts: u32,
    /// Row number in the `--data` file. Never the row's values.
    pub data_row: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct CliRunResult {
    pub project_id: String,
    pub project_name: String,
    pub environment_id: Option<String>,
    pub environment_name: Option<String>,
    pub scope: String,
    pub started_at: String,
    pub duration_ms: i64,
    pub passed: bool,
    pub stopped_early: bool,
    pub executions: Vec<ExecutionResult>,
}

#[derive(Debug, Serialize)]
pub struct Summary {
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
}

impl CliRunResult {
    pub fn summary(&self) -> Summary {
        let total = self.executions.len();
        let passed = self.executions.iter().filter(|e| e.passed).count();
        Summary { total, passed, failed: total - passed }
    }

    pub fn to_json(&self) -> Value {
        let summary = self.summary();
        serde_json::json!({
            "format": REPORT_FORMAT,
            "version": REPORT_VERSION,
            "project": {"id": self.project_id, "name": self.project_name},
            "environment": self.environment_id.as_ref().map(|id| serde_json::json!({
                "id": id,
                "name": self.environment_name,
            })),
            "scope": self.scope,
            "started_at": self.started_at,
            "duration_ms": self.duration_ms,
            "passed": self.passed,
            "stopped_early": self.stopped_early,
            "summary": {"total": summary.total, "passed": summary.passed, "failed": summary.failed},
            "executions": self.executions,
        })
    }
}

pub fn write_json_report(result: &CliRunResult, path: &str) -> CliResult<()> {
    let target = expand_user(path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(&result.to_json()).map_err(|e| CliError::new(e.to_string()))?;
    std::fs::write(&target, format!("{}\n", body))?;
    Ok(())
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn write_junit_report(result: &CliRunResult, path: &str) -> CliResult<()> {
    let summary = result.summary();
    let mut xml = String::new();
    xml.push_str("<?xml version='1.0' encoding='utf-8'?>\n");
    xml.push_str(&format!(
        "<testsuite name=\"{}\" tests=\"{}\" failures=\"{}\" errors=\"0\" time=\"{:.3}\">\n",
        xml_escape(&format!("Beacon: {}", result.project_name)),
        summary.total,
        summary.failed,
        result.duration_ms as f64 / 1000.0,
    ));
    for execution in &result.executions {
        xml.push_str(&format!(
            "  <testcase classname=\"{}\" name=\"{}\" time=\"{:.3}\">\n",
            xml_escape(&result.project_name),
            xml_escape(&format!("{} [iteration {}]", execution.endpoint_name, execution.iteration)),
            execution.time_ms.unwrap_or(0) as f64 / 1000.0,
        ));
        if !execution.passed {
            let message = execution.error.clone().unwrap_or_else(|| "Request failed".to_string());
            xml.push_str(&format!(
                "    <failure message=\"{}\">{}</failure>\n",
                xml_escape(&message),
                xml_escape(&message),
            ));
        }
        xml.push_str("    <properties>\n");
        xml.push_str(&format!("      <property name=\"method\" value=\"{}\" />\n", xml_escape(&execution.method)));
        xml.push_str(&format!("      <property name=\"target\" value=\"{}\" />\n", xml_escape(&execution.target)));
        if let Some(status) = execution.status {
            xml.push_str(&format!("      <property name=\"status\" value=\"{}\" />\n", status));
        }
        xml.push_str("    </properties>\n");
        xml.push_str("  </testcase>\n");
    }
    xml.push_str("</testsuite>\n");

    let target = expand_user(path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&target, xml)?;
    Ok(())
}

fn expand_user(raw: &str) -> std::path::PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return Path::new(&home).join(rest);
        }
    }
    std::path::PathBuf::from(raw)
}

// --- GitHub Actions output -------------------------------------------------
//
// Deliberately derived from execution metadata, not response values.
// Assertion expected/actual values and transport exception text may contain
// credentials, rendered URLs, or response secrets and must not be written to
// pull-request annotations or the step summary. Mirrors `cli_github.py`.

pub fn github_summary_path() -> CliResult<std::path::PathBuf> {
    let raw = std::env::var("GITHUB_STEP_SUMMARY").unwrap_or_default();
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(CliError::new("--github requires GitHub Actions (GITHUB_STEP_SUMMARY is not set)"));
    }
    Ok(expand_user(raw))
}

fn markdown_escape(value: &str) -> String {
    value.replace('|', "\\|").replace('\r', " ").replace('\n', " ")
}

fn annotation_data(value: &str) -> String {
    value.replace('%', "%25").replace('\r', "%0D").replace('\n', "%0A")
}

fn annotation_property(value: &str) -> String {
    annotation_data(value).replace(':', "%3A").replace(',', "%2C")
}

pub fn safe_failure_reason(execution: &ExecutionResult) -> String {
    let mut reasons = Vec::new();
    match execution.status {
        None => reasons.push("request failed before an HTTP response".to_string()),
        Some(status) if !(200..300).contains(&status) => reasons.push(format!("HTTP {}", status)),
        _ => {}
    }
    let failed: Vec<&Value> = execution
        .assertions
        .iter()
        .filter(|a| !a.get("ok").and_then(|v| v.as_bool()).unwrap_or(false))
        .collect();
    if !failed.is_empty() {
        let mut kinds: Vec<String> = failed
            .iter()
            .map(|a| a.get("type").and_then(|v| v.as_str()).unwrap_or("unknown").to_string())
            .collect();
        kinds.sort();
        kinds.dedup();
        reasons.push(format!("{} assertion(s) failed ({})", failed.len(), kinds.join(", ")));
    }
    if reasons.is_empty() {
        "request failed".to_string()
    } else {
        reasons.join("; ")
    }
}

pub fn github_annotations(result: &CliRunResult) -> Vec<String> {
    result
        .executions
        .iter()
        .filter(|e| !e.passed)
        .map(|execution| {
            let title = annotation_property(&format!("Beacon: {}", execution.endpoint_name));
            let message = annotation_data(&format!(
                "{} {}, iteration {}: {}",
                execution.method,
                execution.endpoint_name,
                execution.iteration,
                safe_failure_reason(execution)
            ));
            format!("::error title={}::{}", title, message)
        })
        .collect()
}

pub fn github_summary_markdown(result: &CliRunResult) -> String {
    let summary = result.summary();
    let state = if result.passed { "Passed" } else { "Failed" };
    let icon = if result.passed { "\u{2705}" } else { "\u{274c}" };
    let environment = result.environment_name.clone().unwrap_or_else(|| "None".to_string());
    let mut lines = vec![
        format!("# {} Beacon API tests: {}", icon, state),
        String::new(),
        "| Project | Environment | Scope | Duration |".to_string(),
        "| --- | --- | --- | ---: |".to_string(),
        format!(
            "| {} | {} | {} | {} ms |",
            markdown_escape(&result.project_name),
            markdown_escape(&environment),
            markdown_escape(&result.scope),
            result.duration_ms
        ),
        String::new(),
        "| Total | Passed | Failed |".to_string(),
        "| ---: | ---: | ---: |".to_string(),
        format!("| {} | {} | {} |", summary.total, summary.passed, summary.failed),
    ];
    let failures: Vec<&ExecutionResult> = result.executions.iter().filter(|e| !e.passed).collect();
    if !failures.is_empty() {
        lines.push(String::new());
        lines.push("## Failures".to_string());
        lines.push(String::new());
        lines.push("| Endpoint | Iteration | Status | Reason |".to_string());
        lines.push("| --- | ---: | ---: | --- |".to_string());
        for execution in failures.iter().take(50) {
            let status = execution.status.map(|s| s.to_string()).unwrap_or_else(|| "\u{2014}".to_string());
            lines.push(format!(
                "| {} {} | {} | {} | {} |",
                markdown_escape(&execution.method),
                markdown_escape(&execution.endpoint_name),
                execution.iteration,
                status,
                markdown_escape(&safe_failure_reason(execution))
            ));
        }
        if failures.len() > 50 {
            lines.push(String::new());
            lines.push(format!("_Showing 50 of {} failures._", failures.len()));
        }
    }
    lines.push(String::new());
    lines.push("Detailed machine-readable results are available in the Beacon report artifact.".to_string());
    lines.push(String::new());
    lines.join("\n")
}

pub fn write_github_summary(result: &CliRunResult, path: &Path) -> CliResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| CliError::new(format!("Could not write GitHub Actions summary: {}", e)))?;
    file.write_all(github_summary_markdown(result).as_bytes())
        .map_err(|e| CliError::new(format!("Could not write GitHub Actions summary: {}", e)))?;
    Ok(())
}
