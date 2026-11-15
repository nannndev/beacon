//! Safe CI configuration generation for Git-backed Beacon projects. Mirrors
//! `cli_ci.py`: finds the repo root, maps private variables to GitHub
//! Actions secrets, renders the exact workflow YAML, and writes it
//! atomically without ever reading secret values into the file.

use crate::error::{CliError, CliResult};
use crate::variables::{is_secret_name, shell_variable_name};
use regex::Regex;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const DEFAULT_WORKFLOW: &str = ".github/workflows/beacon.yml";

pub struct GithubWorkflowPlan {
    pub destination: PathBuf,
    pub project_path: String,
    pub secret_names: Vec<String>,
    pub content: String,
}

pub struct GithubWorkflowWriteResult {
    pub path: PathBuf,
    pub state: &'static str,
}

pub fn find_repository_root(project_root: &Path, explicit_root: Option<&str>) -> CliResult<PathBuf> {
    if let Some(explicit) = explicit_root {
        let candidate = expand_user(explicit).canonicalize().map_err(|_| {
            CliError::new(format!("Git repository not found at {}", expand_user(explicit).display()))
        })?;
        if !candidate.join(".git").exists() {
            return Err(CliError::new(format!("Git repository not found at {}", candidate.display())));
        }
        if !project_root.starts_with(&candidate) {
            return Err(CliError::new("Beacon project must be inside the selected Git repository"));
        }
        return Ok(candidate);
    }
    let mut current = Some(project_root.to_path_buf());
    while let Some(candidate) = current {
        if candidate.join(".git").exists() {
            return Ok(candidate);
        }
        current = candidate.parent().map(|p| p.to_path_buf());
    }
    Err(CliError::new("No Git repository contains this Beacon project. Run git init or use --repo-root PATH."))
}

fn expand_user(raw: &str) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return Path::new(&home).join(rest);
        }
    }
    PathBuf::from(raw)
}

pub fn discover_github_secrets(environment: Option<&Value>) -> CliResult<Vec<String>> {
    let Some(variables) = environment.and_then(|e| e.get("variables")).and_then(|v| v.as_object()) else {
        return Ok(Vec::new());
    };
    let mut names: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();
    for key in variables.keys() {
        if !is_secret_name(key) {
            continue;
        }
        let github_name = format!("BEACON_VAR_{}", shell_variable_name(key));
        if let Some(existing) = names.get(&github_name) {
            if existing != key {
                return Err(CliError::new(format!(
                    "Private variables {:?} and {:?} both map to {}. Rename one variable before generating CI.",
                    existing, key, github_name
                )));
            }
        }
        names.insert(github_name, key.clone());
    }
    Ok(names.into_keys().collect())
}

pub struct WorkflowParams<'a> {
    pub project_root: &'a Path,
    pub project_name: &'a str,
    pub environment: Option<&'a Value>,
    pub cli_version: &'a str,
    pub repository_root: Option<&'a str>,
}

pub fn create_github_workflow_plan(params: WorkflowParams) -> CliResult<GithubWorkflowPlan> {
    let repo_root = find_repository_root(params.project_root, params.repository_root)?;
    let relative = params
        .project_root
        .strip_prefix(&repo_root)
        .map_err(|_| CliError::new("Beacon project must be inside the selected Git repository"))?;
    let project_path = if relative.as_os_str().is_empty() {
        ".".to_string()
    } else {
        relative.to_string_lossy().replace('\\', "/")
    };
    let secret_names = discover_github_secrets(params.environment)?;
    let environment_name = params.environment.and_then(|e| e.get("name")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let destination = repo_root.join(DEFAULT_WORKFLOW);
    let content = render_github_workflow(RenderParams {
        project_name: params.project_name,
        project_path: &project_path,
        environment_name: environment_name.as_deref(),
        secret_names: &secret_names,
        cli_version: params.cli_version,
    })?;
    Ok(GithubWorkflowPlan { destination, project_path, secret_names, content })
}

pub struct RenderParams<'a> {
    pub project_name: &'a str,
    pub project_path: &'a str,
    pub environment_name: Option<&'a str>,
    pub secret_names: &'a [String],
    pub cli_version: &'a str,
}

pub fn render_github_workflow(params: RenderParams) -> CliResult<String> {
    let normalized_version = params.cli_version.trim().strip_prefix('v').unwrap_or(params.cli_version.trim()).to_string();
    let semver_re = Regex::new(r"^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$").unwrap();
    if normalized_version != "latest" && !semver_re.is_match(&normalized_version) {
        return Err(CliError::new("CLI version must be a semantic version such as 0.4.8, or 'latest'"));
    }
    let release_segment = if normalized_version == "latest" {
        "latest/download".to_string()
    } else {
        format!("download/v{}", normalized_version)
    };

    let mut env_lines = vec![format!("      BEACON_PROJECT: {}", json_quote(params.project_path))];
    if let Some(name) = params.environment_name {
        env_lines.push(format!("      BEACON_ENV: {}", json_quote(name)));
    }
    for name in params.secret_names {
        env_lines.push(format!("      {}: ${{{{ secrets.{} }}}}", name, name));
    }
    let env_block = env_lines.join("\n");
    let env_arg = if params.environment_name.is_some() { " --env \"$BEACON_ENV\"" } else { "" };
    let display_name = {
        let cleaned = params.project_name.replace(['\r', '\n'], " ");
        let trimmed = cleaned.trim();
        if trimmed.is_empty() { "Beacon project".to_string() } else { trimmed.to_string() }
    };

    Ok(format!(
        r#"# Generated by Beacon CLI for {display_name}
name: Beacon API tests

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  api-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
{env_block}
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Install Beacon CLI
        shell: bash
        run: |
          curl --fail --silent --show-error --location \
            https://github.com/nannndev/beacon/releases/{release_segment}/beacon-linux-x64 \
            --output "$RUNNER_TEMP/beacon"
          chmod +x "$RUNNER_TEMP/beacon"
          echo "$RUNNER_TEMP" >> "$GITHUB_PATH"

      - name: Validate Beacon project
        shell: bash
        run: beacon validate "$BEACON_PROJECT"{env_arg} --strict

      - name: Run Beacon project
        shell: bash
        run: |
          beacon run "$BEACON_PROJECT"{env_arg} --bail --quiet --github \
            --report-junit "$BEACON_PROJECT/reports/beacon.xml" \
            --report-json "$BEACON_PROJECT/reports/beacon.json"

      - name: Upload Beacon reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: beacon-reports
          path: ${{{{ env.BEACON_PROJECT }}}}/reports/
          if-no-files-found: ignore
"#,
    ))
}

fn json_quote(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| format!("{:?}", s))
}

pub fn write_github_workflow(plan: &GithubWorkflowPlan, force: bool) -> CliResult<GithubWorkflowWriteResult> {
    let target = &plan.destination;
    let existed = target.exists();
    if existed {
        let existing = std::fs::read_to_string(target)
            .map_err(|e| CliError::new(format!("Could not read existing workflow: {}", e)))?;
        if existing == plan.content {
            return Ok(GithubWorkflowWriteResult { path: target.clone(), state: "unchanged" });
        }
        if !force {
            return Err(CliError::new(format!(
                "Workflow already exists at {}. Review with --dry-run, then use --force to replace it.",
                target.display()
            )));
        }
    }

    let parent = target.parent().ok_or_else(|| CliError::new("Invalid workflow destination"))?;
    std::fs::create_dir_all(parent)?;
    let tmp_name = format!(".beacon-workflow-{}.tmp", std::process::id());
    let tmp_path = parent.join(tmp_name);
    std::fs::write(&tmp_path, &plan.content)
        .map_err(|e| CliError::new(format!("Could not write GitHub Actions workflow: {}", e)))?;
    std::fs::rename(&tmp_path, target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        CliError::new(format!("Could not write GitHub Actions workflow: {}", e))
    })?;

    Ok(GithubWorkflowWriteResult { path: target.clone(), state: if existed { "updated" } else { "created" } })
}
