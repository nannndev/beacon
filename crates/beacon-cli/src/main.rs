use beacon_core::APITester;
use beacon_server::store::Store;
use clap::{Parser, Subcommand};
use colored::*;
use std::process::ExitCode;

#[derive(Parser)]
#[command(name = "beacon", version)]
#[command(about = "Beacon API Workbench CLI & CI Test Runner", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Run API tests
    Run {
        /// Optional endpoint name or ID to filter
        #[arg(short, long)]
        endpoint: Option<String>,
        /// Concurrency level
        #[arg(short, long, default_value_t = 1)]
        concurrency: usize,
        /// Max requests
        #[arg(short, long, default_value_t = 1)]
        requests: u64,
    },
    /// List all endpoints in active project
    List,
    /// Print version information
    Version,
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let store = Store::new();

    match cli.command.unwrap_or(Commands::List) {
        Commands::Version => {
            println!("Beacon CLI v{}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Commands::List => {
            let active = store.get_active_project();
            println!(
                "{} {}",
                "Active Project:".bold(),
                active.map(|p| p.name.as_str()).unwrap_or("None").cyan()
            );
            println!("{}", "Endpoints:".bold());
            for t in &store.current_config.tests {
                println!("  {} {:<7} {}", t.id.dimmed(), t.method.green(), t.name.bold());
                println!("     URL: {}", t.url.dimmed());
            }
            ExitCode::SUCCESS
        }
        Commands::Run {
            endpoint,
            concurrency,
            requests,
        } => {
            let tests_to_run: Vec<_> = if let Some(ref filter) = endpoint {
                store
                    .current_config
                    .tests
                    .iter()
                    .filter(|t| t.id == *filter || t.name.to_lowercase().contains(&filter.to_lowercase()))
                    .cloned()
                    .collect()
            } else {
                store.current_config.tests.clone()
            };

            if tests_to_run.is_empty() {
                eprintln!("{}", "No matching endpoints found to run.".yellow());
                return ExitCode::FAILURE;
            }

            println!(
                "{} Running {} endpoint(s)...",
                "BEACON".bold().blue(),
                tests_to_run.len()
            );

            let mut all_passed = true;

            for test in tests_to_run {
                print!("  {:<7} {} ... ", test.method.blue().bold(), test.name);
                let tester = APITester::new(
                    test.clone(),
                    store.current_config.clone(),
                    concurrency,
                    0,
                    requests,
                    None,
                );

                match tester.execute_single().await {
                    Ok(out) => {
                        let passed = out.status >= 200 && out.status < 400 && out.assertions.iter().all(|a| a.ok);
                        if passed {
                            println!(
                                "{} [{} ms] HTTP {}",
                                "PASS".green().bold(),
                                out.time_ms as u64,
                                out.status
                            );
                        } else {
                            all_passed = false;
                            println!(
                                "{} [{} ms] HTTP {}",
                                "FAIL".red().bold(),
                                out.time_ms as u64,
                                out.status
                            );
                            for a in &out.assertions {
                                if !a.ok {
                                    println!("    ↳ assertion failed: {}", a.message.yellow());
                                }
                            }
                        }
                    }
                    Err(e) => {
                        all_passed = false;
                        println!("{} error: {}", "ERR".red().bold(), e);
                    }
                }
            }

            if all_passed {
                println!("\n{}", "All tests passed successfully!".green().bold());
                ExitCode::SUCCESS
            } else {
                println!("\n{}", "Some tests failed.".red().bold());
                ExitCode::FAILURE
            }
        }
    }
}

