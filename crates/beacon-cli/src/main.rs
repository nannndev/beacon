mod auth;
mod ci;
mod datasets;
mod error;
mod project;
mod report;
mod runner;
mod validate;
mod variables;

use clap::{Parser, Subcommand};
use error::{CliError, CliResult};
use serde_json::Value;
use std::io::IsTerminal;
use std::process::ExitCode;

#[derive(Parser)]
#[command(name = "beacon", version)]
#[command(about = "Run Git-backed Beacon API tests without opening the desktop app.", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Validate, then execute the selected project scope
    Run(RunArgs),
    /// Validate a Beacon project without sending requests
    Validate(ValidateArgs),
    /// List project endpoints, folders, or environments
    List(ListArgs),
    /// Generate CI configuration for a Beacon project
    Ci {
        #[command(subcommand)]
        command: CiCommands,
    },
}

#[derive(Subcommand)]
enum CiCommands {
    /// Initialize a CI provider
    Init {
        #[command(subcommand)]
        provider: CiProviders,
    },
}

#[derive(Subcommand)]
enum CiProviders {
    /// Generate a GitHub Actions workflow
    Github(CiGithubArgs),
}

#[derive(clap::Args)]
struct RunArgs {
    /// Project folder or beacon.yaml path
    #[arg(default_value = ".")]
    project: String,
    /// Run one endpoint; repeat to run several
    #[arg(long)]
    endpoint: Vec<String>,
    /// Run every endpoint below one folder
    #[arg(long, conflicts_with = "endpoint")]
    folder: Option<String>,
    /// Environment to use
    #[arg(long)]
    env: Option<String>,
    /// Read KEY=VALUE overrides from a local file
    #[arg(long = "env-file")]
    env_file: Option<String>,
    /// Override one variable; repeat as needed
    #[arg(long = "env-var")]
    env_var: Vec<String>,
    /// Repeat the selected scope (default: 1, or one pass per --data row)
    #[arg(long)]
    iterations: Option<u32>,
    /// CSV or JSON test data; each pass uses the next row as {{column}} variables
    #[arg(long)]
    data: Option<String>,
    /// Retry failed HTTP requests
    #[arg(long, default_value_t = 0)]
    retries: u32,
    /// Delay between retries in milliseconds
    #[arg(long = "retry-delay", default_value_t = 0)]
    retry_delay: u64,
    /// Stop after the first failed request
    #[arg(long)]
    bail: bool,
    /// Write a machine-readable JSON report
    #[arg(long = "report-json")]
    report_json: Option<String>,
    /// Write a JUnit XML report
    #[arg(long = "report-junit")]
    report_junit: Option<String>,
    /// Print only the final summary and errors
    #[arg(long)]
    quiet: bool,
    /// Disable ANSI terminal colors
    #[arg(long = "no-color")]
    no_color: bool,
    /// Write a GitHub Actions summary and failure annotations
    #[arg(long)]
    github: bool,
}

#[derive(clap::Args)]
struct ValidateArgs {
    /// Project folder or beacon.yaml path
    #[arg(default_value = ".")]
    project: String,
    /// Environment used for variable validation
    #[arg(long)]
    env: Option<String>,
    /// Read KEY=VALUE overrides from a local file
    #[arg(long = "env-file")]
    env_file: Option<String>,
    /// Override one variable; repeat as needed
    #[arg(long = "env-var")]
    env_var: Vec<String>,
    /// Treat warnings as validation failures
    #[arg(long)]
    strict: bool,
    /// Print machine-readable JSON diagnostics
    #[arg(long)]
    json: bool,
}

#[derive(clap::Args)]
struct ListArgs {
    /// Resource to list
    #[arg(value_parser = ["endpoints", "folders", "environments"])]
    resource: String,
    /// Project folder or beacon.yaml path
    #[arg(default_value = ".")]
    project: String,
    /// Print machine-readable JSON
    #[arg(long)]
    json: bool,
}

#[derive(clap::Args)]
struct CiGithubArgs {
    /// Project folder or beacon.yaml path
    #[arg(default_value = ".")]
    project: String,
    /// Environment used by the generated workflow
    #[arg(long)]
    env: Option<String>,
    /// Git repository root when it cannot be detected
    #[arg(long = "repo-root")]
    repo_root: Option<String>,
    /// Beacon CLI release to install
    #[arg(long = "cli-version", default_value_t = env!("CARGO_PKG_VERSION").to_string())]
    cli_version: String,
    /// Print the workflow without writing it
    #[arg(long = "dry-run")]
    dry_run: bool,
    /// Replace a different existing Beacon workflow
    #[arg(long)]
    force: bool,
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    match &cli.command {
        Commands::Run(args) => match run_command(args).await {
            Ok(code) => exit_code(code),
            Err(e) => {
                eprintln!("Beacon CLI error: {}", e);
                ExitCode::from(2)
            }
        },
        Commands::Validate(args) => match validate_command(args) {
            Ok(code) => exit_code(code),
            Err(e) => {
                if args.json {
                    print_validate_cli_error(&e);
                } else {
                    eprintln!("Beacon CLI error: {}", e);
                }
                ExitCode::from(2)
            }
        },
        Commands::List(args) => match list_command(args) {
            Ok(code) => exit_code(code),
            Err(e) => {
                eprintln!("Beacon CLI error: {}", e);
                ExitCode::from(2)
            }
        },
        Commands::Ci { command: CiCommands::Init { provider: CiProviders::Github(args) } } => {
            match ci_init_github_command(args) {
                Ok(code) => exit_code(code),
                Err(e) => {
                    eprintln!("Beacon CLI error: {}", e);
                    ExitCode::from(2)
                }
            }
        }
    }
}

fn exit_code(code: i32) -> ExitCode {
    ExitCode::from(code.clamp(0, 255) as u8)
}

fn print_validate_cli_error(e: &CliError) {
    let payload = serde_json::json!({
        "valid": false,
        "summary": {"errors": 1, "warnings": 0},
        "diagnostics": [{
            "severity": "error",
            "code": "cli_error",
            "location": ".",
            "message": e.to_string(),
        }],
    });
    println!("{}", serde_json::to_string_pretty(&payload).unwrap());
}

fn load_variables(
    env_file: Option<&str>,
    env_var: &[String],
    environment: Option<&Value>,
) -> CliResult<std::collections::HashMap<String, String>> {
    let file_values = match env_file {
        Some(path) => variables::parse_env_file(path)?,
        None => Default::default(),
    };
    let cli_values = variables::parse_env_vars(env_var)?;
    Ok(variables::resolve_variables(environment, &file_values, &cli_values))
}

// --- validate ---------------------------------------------------------

fn validate_command(args: &ValidateArgs) -> CliResult<i32> {
    let (project, root) = project::load_project(&args.project)?;
    let (endpoints, _scope) = project::select_endpoints(&project, None, None)?;
    let environment = project::select_environment(&project, args.env.as_deref())?;
    let variables = load_variables(args.env_file.as_deref(), &args.env_var, environment.as_ref())?;
    let missing_private = variables::missing_private_values(environment.as_ref(), &variables);
    let result = validate::validate_project(&project, &endpoints, environment.as_ref(), &variables, &missing_private);
    let failed = !result.valid() || (args.strict && !result.warnings().is_empty());

    if args.json {
        let mut output = result.to_json();
        if let Some(obj) = output.as_object_mut() {
            obj.insert("project".into(), Value::String(root.display().to_string()));
            obj.insert("strict".into(), Value::Bool(args.strict));
        }
        println!("{}", serde_json::to_string_pretty(&output).unwrap());
        return Ok(if failed { 2 } else { 0 });
    }

    for item in &result.diagnostics {
        let marker = if item.severity == "error" { "ERROR" } else { "WARN " };
        println!("{}  [{}] {}: {}", marker, item.code, item.location, item.message);
    }
    if result.diagnostics.is_empty() {
        println!("No validation issues found.");
    }
    println!(
        "\n{}: {} errors, {} warnings",
        if failed { "INVALID" } else { "VALID" },
        result.errors().len(),
        result.warnings().len()
    );
    Ok(if failed { 2 } else { 0 })
}

// --- list ---------------------------------------------------------------

fn list_command(args: &ListArgs) -> CliResult<i32> {
    let (project, root) = project::load_project(&args.project)?;
    let rows = project::list_project_resources(&project, &args.resource)?;

    if args.json {
        let items: Value = match &rows {
            project::ResourceRows::Endpoints(items) => serde_json::json!(items
                .iter()
                .map(|r| serde_json::json!({"id": r.id, "name": r.name, "method": r.method, "target_type": r.target_type, "folder": r.folder, "url": r.url}))
                .collect::<Vec<_>>()),
            project::ResourceRows::Folders(items) => serde_json::json!(items
                .iter()
                .map(|r| serde_json::json!({"id": r.id, "name": r.name, "path": r.path, "endpoints": r.endpoints}))
                .collect::<Vec<_>>()),
            project::ResourceRows::Environments(items) => serde_json::json!(items
                .iter()
                .map(|r| serde_json::json!({"id": r.id, "name": r.name, "base_url": r.base_url, "active": r.active}))
                .collect::<Vec<_>>()),
        };
        let count = match &rows {
            project::ResourceRows::Endpoints(items) => items.len(),
            project::ResourceRows::Folders(items) => items.len(),
            project::ResourceRows::Environments(items) => items.len(),
        };
        let output = serde_json::json!({
            "project": {
                "id": project.get("id"),
                "name": project.get("name"),
                "path": root.display().to_string(),
            },
            "resource": args.resource,
            "count": count,
            "items": items,
        });
        println!("{}", serde_json::to_string_pretty(&output).unwrap());
        return Ok(0);
    }

    match &rows {
        project::ResourceRows::Endpoints(items) => {
            if items.is_empty() {
                println!("No endpoints found.");
                return Ok(0);
            }
            println!("{:<8} {:<28} {:<24} ID", "METHOD", "NAME", "FOLDER");
            for row in items {
                println!("{:<8} {:<28} {:<24} {}", row.method, truncate(&row.name, 27), truncate(&row.folder, 23), row.id);
            }
        }
        project::ResourceRows::Folders(items) => {
            if items.is_empty() {
                println!("No folders found.");
                return Ok(0);
            }
            println!("{:<44} {:<10} ID", "PATH", "ENDPOINTS");
            for row in items {
                println!("{:<44} {:<10} {}", truncate(&row.path, 43), row.endpoints, row.id);
            }
        }
        project::ResourceRows::Environments(items) => {
            if items.is_empty() {
                println!("No environments found.");
                return Ok(0);
            }
            println!("{:<8} {:<28} {:<44} ID", "ACTIVE", "NAME", "BASE URL");
            for row in items {
                println!(
                    "{:<8} {:<28} {:<44} {}",
                    if row.active { "*" } else { "" },
                    truncate(&row.name, 27),
                    truncate(&row.base_url, 43),
                    row.id
                );
            }
        }
    }
    Ok(0)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

// --- ci init github -------------------------------------------------------

fn ci_init_github_command(args: &CiGithubArgs) -> CliResult<i32> {
    let (project, project_root) = project::load_project(&args.project)?;
    let environment = project::select_environment(&project, args.env.as_deref())?;
    let project_name = project.get("name").and_then(|v| v.as_str()).unwrap_or("Beacon project").to_string();
    let plan = ci::create_github_workflow_plan(ci::WorkflowParams {
        project_root: &project_root,
        project_name: &project_name,
        environment: environment.as_ref(),
        cli_version: &args.cli_version,
        repository_root: args.repo_root.as_deref(),
    })?;

    if args.dry_run {
        print!("{}", plan.content);
        eprintln!("Preview only; no file written. Destination: {}", plan.destination.display());
        return Ok(0);
    }

    let result = ci::write_github_workflow(&plan, args.force)?;
    let action = match result.state {
        "created" => "Created",
        "updated" => "Updated",
        _ => "Already up to date",
    };
    println!("{}: {}", action, result.path.display());
    println!("Project path in workflow: {}", plan.project_path);
    if !plan.secret_names.is_empty() {
        println!("\nAdd these repository secrets in GitHub before the workflow runs:");
        for name in &plan.secret_names {
            println!("  - {}", name);
        }
    } else {
        println!("\nNo private environment variables were detected for this environment.");
    }
    Ok(0)
}

// --- run ------------------------------------------------------------------

async fn run_command(args: &RunArgs) -> CliResult<i32> {
    let github_path = if args.github { Some(report::github_summary_path()?) } else { None };
    let color = std::io::stdout().is_terminal() && !args.no_color && std::env::var("NO_COLOR").is_err();
    let quiet = args.quiet || args.github;

    let (project, root) = project::load_project(&args.project)?;
    let endpoint_selectors = if args.endpoint.is_empty() { None } else { Some(args.endpoint.as_slice()) };
    let (endpoints, scope) = project::select_endpoints(&project, endpoint_selectors, args.folder.as_deref())?;
    let environment = project::select_environment(&project, args.env.as_deref())?;
    let variables = load_variables(args.env_file.as_deref(), &args.env_var, environment.as_ref())?;

    let data_rows = match &args.data {
        Some(path) => Some(datasets::load_data_file(path)?),
        None => None,
    };
    let iterations = args.iterations.unwrap_or_else(|| data_rows.as_ref().map(|r| r.len() as u32).unwrap_or(1));

    // Data columns are real variables at run time; don't flag them as missing.
    let mut validation_variables = variables.clone();
    if let Some(rows) = &data_rows {
        for row in rows {
            for column in row.keys() {
                validation_variables.entry(column.clone()).or_insert_with(|| "<test data>".to_string());
            }
        }
    }
    let missing_private = variables::missing_private_values(environment.as_ref(), &validation_variables);
    let validation = validate::validate_project(&project, &endpoints, environment.as_ref(), &validation_variables, &missing_private);
    if !validation.valid() {
        let lines: Vec<String> = validation.errors().iter().map(|item| format!("  [{}] {}: {}", item.code, item.location, item.message)).collect();
        return Err(CliError::new(format!("Project validation failed:\n{}", lines.join("\n"))));
    }

    let env_label = environment.as_ref().and_then(|e| e.get("name")).and_then(|v| v.as_str()).unwrap_or("none").to_string();
    if !quiet {
        println!("Beacon CLI {}", env!("CARGO_PKG_VERSION"));
        println!("Project: {} ({})", project.get("name").and_then(|v| v.as_str()).unwrap_or(""), root.display());
        let data_label = data_rows.as_ref().map(|r| format!(" | Data: {} rows", r.len())).unwrap_or_default();
        println!("Scope: {} | Environment: {} | Iterations: {}{}", scope, env_label, iterations, data_label);
        println!();
    }

    let mut printed = Vec::new();
    let result = runner::run_project(
        runner::RunParams {
            project: &project,
            endpoints: &endpoints,
            environment: environment.as_ref(),
            variables,
            scope,
            iterations,
            retries: args.retries,
            retry_delay_ms: args.retry_delay,
            bail: args.bail,
            data_rows: data_rows.as_deref(),
        },
        |execution| {
            if !quiet {
                printed.push(print_execution(execution, color));
            }
        },
    )
    .await?;
    for line in printed {
        println!("{}", line);
    }

    if let Some(path) = &args.report_json {
        report::write_json_report(&result, path)?;
    }
    if let Some(path) = &args.report_junit {
        report::write_junit_report(&result, path)?;
    }
    if let Some(path) = &github_path {
        report::write_github_summary(&result, path)?;
        for annotation in report::github_annotations(&result) {
            println!("{}", annotation);
        }
    }

    let summary = result.summary();
    println!();
    println!(
        "{}: {} passed, {} failed, {} total in {}ms",
        if result.passed { "PASSED" } else { "FAILED" },
        summary.passed,
        summary.failed,
        summary.total,
        result.duration_ms
    );
    if let Some(path) = &args.report_json {
        println!("JSON report: {}", path);
    }
    if let Some(path) = &args.report_junit {
        println!("JUnit report: {}", path);
    }
    if let Some(path) = &github_path {
        println!("GitHub summary: {}", path.display());
    }

    Ok(if result.passed { 0 } else { 1 })
}

fn print_execution(item: &report::ExecutionResult, color: bool) -> String {
    let state = if item.passed {
        paint("PASS", "32;1", color)
    } else {
        paint("FAIL", "31;1", color)
    };
    let status = item.status.map(|s| s.to_string()).unwrap_or_else(|| "ERR".to_string());
    let timing = item.time_ms.map(|t| format!("{}ms", t)).unwrap_or_else(|| "-".to_string());
    let mut out = format!("{}  {:<7} {}  {}  {}", state, item.method, item.endpoint_name, status, timing);
    if let Some(err) = &item.error {
        out.push_str(&format!("\n      {}", paint(err, "31", color)));
    }
    for assertion in &item.assertions {
        let ok = assertion.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        let marker = if ok { paint("ok", "32", color) } else { paint("failed", "31", color) };
        let message = assertion.get("message").and_then(|v| v.as_str()).unwrap_or("Assertion");
        out.push_str(&format!("\n      assertion {}: {}", marker, message));
    }
    if !item.extracted.is_empty() {
        out.push_str(&format!("\n      extracted: {}", item.extracted.join(", ")));
    }
    out
}

fn paint(value: &str, code: &str, color: bool) -> String {
    if color {
        format!("\x1b[{}m{}\x1b[0m", code, value)
    } else {
        value.to_string()
    }
}
