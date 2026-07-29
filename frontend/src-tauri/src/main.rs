#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mcp_registration;

use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, RunEvent, State};
use tauri_plugin_aptabase::EventTracker;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// The sidecar binary name Tauri resolves at runtime (no triple suffix — Tauri
/// strips it and appends the OS extension). Matches `externalBin` in
/// tauri.conf.json.
#[cfg(windows)]
const MCP_BINARY_NAME: &str = "mcp_server.exe";
#[cfg(not(windows))]
const MCP_BINARY_NAME: &str = "mcp_server";

#[cfg(windows)]
const BUNDLED_CLI_NAME: &str = "beacon_cli.exe";
#[cfg(not(windows))]
const BUNDLED_CLI_NAME: &str = "beacon_cli";
#[cfg(windows)]
const STAGED_CLI_NAME: &str = "beacon.exe";
#[cfg(not(windows))]
const STAGED_CLI_NAME: &str = "beacon";

const SKILL_RELATIVE: &str = "skills/beacon/SKILL.md";

/// Kill any backend sidecar left over from a previous session that crashed or
/// was force-quit before its `ExitRequested` cleanup ran. Safe to call at
/// startup: the single-instance plugin guarantees no *other* Beacon app is
/// running, so any surviving `backend` process can only be a stale orphan.
/// Multiple live backends would each hold their own in-memory store and
/// overwrite the shared tests.json with stale state, silently reverting edits
/// (e.g. newly created endpoints vanish). We deliberately do NOT touch
/// `mcp_server` — those are launched and owned by external MCP clients
/// (Claude Desktop/Code, Cursor, …), not by this app.
fn reap_stale_backends() {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/IM", "backend.exe", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    #[cfg(not(windows))]
    {
        // Packaged macOS/Linux apps launch a sibling binary named exactly
        // `backend`. Older cleanup only matched the triple-suffixed development
        // binary (`backend-*`), so packaged sidecars survived app updates as
        // PPID-1 orphans. Match our absolute sibling path first to avoid
        // touching unrelated processes named "backend".
        if let Some(path) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|parent| parent.join("backend")))
            .filter(|path| path.exists())
        {
            let _ = std::process::Command::new("pkill")
                .args(["-f", &path.to_string_lossy()])
                .output();
        }

        // A development build has a different sibling path than an installed
        // macOS build. If the installed app was force-quit before launching
        // `tauri dev`, reap that app-bundle sidecar as well.
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("pkill")
                .args(["-f", "Beacon.app/Contents/MacOS/backend"])
                .output();
        }

        // Development sidecars retain Tauri's target-triple suffix.
        let _ = std::process::Command::new("pkill")
            .args(["-f", "backend-"])
            .output();
    }
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Absolute path where we stage the MCP binary for stdio clients to launch.
/// Stored in a Tauri-managed state so the command can return it.
pub(crate) struct McpServerPath(pub(crate) Mutex<PathBuf>);

/// Absolute path to the staged agent skill for Claude Code etc.
pub(crate) struct McpSkillPath(pub(crate) Mutex<PathBuf>);

/// Absolute path to the staged headless CLI. Keeping this outside the app
/// bundle means the path survives desktop updates and can be used by CI scripts.
struct CliPath(Mutex<PathBuf>);

/// The port the bundled backend sidecar was told to listen on. The frontend
/// reads this via the `backend_port` command so it never hardcodes 8000.
struct BackendPort(u16);

/// Handle to the spawned sidecar so we can kill it when the app exits.
struct BackendChild(Mutex<Option<CommandChild>>);

#[tauri::command]
fn backend_port(state: State<BackendPort>) -> u16 {
    state.0
}

/// Release the packaged backend binary before the updater replaces application
/// files. This is essential on Windows, where a running sidecar keeps the EXE
/// locked and can leave the UI updated while the backend remains old.
#[tauri::command]
fn prepare_for_update(state: State<BackendChild>) -> Result<(), String> {
    if let Some(child) = state.0.lock().unwrap().take() {
        kill_tree(child);
    }
    reap_stale_backends();
    Ok(())
}

#[tauri::command]
fn mcp_server_path(state: State<McpServerPath>) -> String {
    state.0.lock().unwrap().to_string_lossy().to_string()
}

#[tauri::command]
fn mcp_skill_path(state: State<McpSkillPath>) -> String {
    state.0.lock().unwrap().to_string_lossy().to_string()
}

#[tauri::command]
fn cli_path(state: State<CliPath>) -> String {
    state.0.lock().unwrap().to_string_lossy().to_string()
}

/// Queue a harmless analytics probe and flush immediately. The Aptabase plugin
/// logs the HTTP result through `log`; debug builds initialize `env_logger` so
/// transport failures are visible in the `tauri dev` terminal.
#[tauri::command]
fn analytics_diagnostic(app: tauri::AppHandle) -> Result<String, String> {
    app.track_event(
        "analytics_test",
        Some(serde_json::json!({
            "source": "settings",
            "build": if cfg!(debug_assertions) { "debug" } else { "release" }
        })),
    )?;
    app.flush_events_blocking();
    Ok(format!(
        "Test event queued and flushed ({})",
        if cfg!(debug_assertions) { "debug" } else { "release" }
    ))
}

/// Ask the OS for a free TCP port on loopback (bind to :0, read the assigned
/// port, drop the listener). Falls back to 8000 if that somehow fails.
fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(8000)
}

fn main() {
    // Debug builds always expose Aptabase transport traces. Release builds stay
    // silent for users, but can opt in with RUST_LOG when diagnosing a field
    // issue (`RUST_LOG=tauri_plugin_aptabase=trace tauri dev --release`).
    if cfg!(debug_assertions) || std::env::var_os("RUST_LOG").is_some() {
        let mut logger = env_logger::Builder::from_default_env();
        logger.filter_module("tauri_plugin_aptabase", log::LevelFilter::Trace);
        let _ = logger.try_init();
    }

    // The Aptabase plugin schedules a background flush via `tokio::spawn`, which
    // panics ("no reactor running") without an ambient Tokio runtime. Create one
    // and enter it on the main thread; the guard lives until the app exits.
    let rt = tokio::runtime::Runtime::new().expect("failed to start Tokio runtime");
    let _rt_guard = rt.enter();

    let port = pick_free_port();

    tauri::Builder::default()
        // MUST be the first plugin. When a user launches Beacon again while it's
        // already open, this fires in the *existing* instance (focus the window)
        // and the second process exits before it can spawn a rival backend.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // Auto-update plumbing. The updater checks the GitHub Releases manifest
        // and verifies downloads against the embedded public key; the process
        // plugin lets the frontend relaunch the app after an update installs.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        // Anonymous, opt-out usage analytics. Sent natively (no webview CORS);
        // the plugin auto-enriches events with OS + app version. Key is a
        // client/ingest key (safe to ship); override at build via APTABASE_APP_KEY.
        .plugin(
            tauri_plugin_aptabase::Builder::new(
                option_env!("APTABASE_APP_KEY").unwrap_or("A-US-7075915871"),
            )
            .build(),
        )
        .manage(BackendPort(port))
        .manage(BackendChild(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            backend_port,
            prepare_for_update,
            mcp_server_path,
            mcp_skill_path,
            cli_path,
            analytics_diagnostic,
            mcp_registration::mcp_status,
            mcp_registration::mcp_register_claude_desktop,
            mcp_registration::mcp_unregister_claude_desktop,
            mcp_registration::mcp_register_claude_code,
            mcp_registration::mcp_unregister_claude_code
        ])
        .setup(move |app| {
            // Keep developer tooling available during `tauri dev`, but never open
            // or compile it into production installers.
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            // Per-user writable data dir (%APPDATA%\Beacon, ~/Library/Application
            // Support/Beacon, ~/.config/Beacon) derived from the bundle identifier.
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).ok();

            // Stage the bundled MCP server binary to a STABLE per-user path so
            // a config entry registered once keeps working across app updates.
            // stdio MCP clients (Claude Desktop/Code/etc.) launch it themselves;
            // we do NOT spawn it here.
            let staged_mcp = data_dir.join(MCP_BINARY_NAME);
            if let Ok(resource_dir) = app.path().resource_dir() {
                let bundled = resource_dir.join(MCP_BINARY_NAME);
                if bundled.exists() {
                    // Copy if missing or the bundled one is a different size
                    // (cheap "did it change across an update" check).
                    let needs_copy = match (std::fs::metadata(&bundled), std::fs::metadata(&staged_mcp)) {
                        (Ok(b), Ok(s)) => b.len() != s.len(),
                        _ => true,
                    };
                    if needs_copy {
                        if let Err(e) = std::fs::copy(&bundled, &staged_mcp) {
                            eprintln!("[beacon] failed to stage MCP binary to {staged_mcp:?}: {e}");
                        }
                    }
                } else {
                    // In a packaged build this should never happen — a missing
                    // externalBin means a broken installer. Log so a field
                    // report can distinguish "never staged" from "staging failed".
                    eprintln!("[beacon] bundled MCP binary not found at {bundled:?}");
                }
            }
            app.manage(McpServerPath(Mutex::new(staged_mcp)));

            // Stage the agent skill (SKILL.md) to the same stable per-user location.
            // Users can copy it to their ~/.claude/skills/beacon/ for Claude Code.
            let staged_skill = data_dir.join("skills").join("beacon").join("SKILL.md");
            if let Ok(resource_dir) = app.path().resource_dir() {
                let bundled_skill = resource_dir.join(SKILL_RELATIVE);
                if bundled_skill.exists() {
                    let skill_dir = staged_skill.parent().unwrap();
                    std::fs::create_dir_all(skill_dir).ok();
                    let needs_copy = match (std::fs::metadata(&bundled_skill), std::fs::metadata(&staged_skill)) {
                        (Ok(b), Ok(s)) => b.len() != s.len(),
                        _ => true,
                    };
                    if needs_copy {
                        if let Err(e) = std::fs::copy(&bundled_skill, &staged_skill) {
                            eprintln!("[beacon] failed to stage skill to {staged_skill:?}: {e}");
                        }
                    }
                } else {
                    eprintln!("[beacon] bundled skill not found at {bundled_skill:?}");
                }
            }
            app.manage(McpSkillPath(Mutex::new(staged_skill)));

            // Stage the CLI to a stable, human-friendly executable name. It is
            // not spawned by Beacon; terminals and CI runners execute it.
            let staged_cli = data_dir.join(STAGED_CLI_NAME);
            if let Ok(resource_dir) = app.path().resource_dir() {
                let bundled_cli = resource_dir.join(BUNDLED_CLI_NAME);
                if bundled_cli.exists() {
                    let needs_copy = match (
                        std::fs::metadata(&bundled_cli),
                        std::fs::metadata(&staged_cli),
                    ) {
                        (Ok(b), Ok(s)) if b.len() == s.len() => {
                            std::fs::read(&bundled_cli).ok() != std::fs::read(&staged_cli).ok()
                        }
                        (Ok(_), Ok(_)) => true,
                        _ => true,
                    };
                    if needs_copy {
                        if let Err(e) = std::fs::copy(&bundled_cli, &staged_cli) {
                            eprintln!("[beacon] failed to stage CLI binary to {staged_cli:?}: {e}");
                        }
                        #[cfg(not(windows))]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            if let Ok(metadata) = std::fs::metadata(&staged_cli) {
                                let mut permissions = metadata.permissions();
                                permissions.set_mode(0o755);
                                let _ = std::fs::set_permissions(&staged_cli, permissions);
                            }
                        }
                    }
                } else {
                    eprintln!("[beacon] bundled CLI binary not found at {bundled_cli:?}");
                }
            }
            app.manage(CliPath(Mutex::new(staged_cli)));

            // Reap any orphaned backend from a previous crashed session before
            // starting ours — two backends on the same tests.json revert each
            // other's writes.
            reap_stale_backends();

            // Launch the bundled Python backend, injecting the chosen port and
            // the data dir. The sidecar name matches `externalBin` in tauri.conf.json.
            let sidecar = app
                .shell()
                .sidecar("backend")
                .expect("backend sidecar not configured")
                .env("BEACON_PORT", port.to_string())
                .env("BEACON_DATA_DIR", data_dir.to_string_lossy().to_string())
                .env("BEACON_APP_VERSION", env!("CARGO_PKG_VERSION"))
                // Sharing is explicitly opt-in from Project Settings and is
                // protected by a short-lived pairing code plus owner approval.
                // Keep the LAN listener available in packaged desktop builds;
                // the UI warns users to use it only on trusted networks.
                .env("BEACON_ALLOW_INSECURE_LAN", "1")
                .args(["--port", &port.to_string()]);

            let (mut _rx, child) = sidecar.spawn().expect("failed to spawn backend sidecar");
            app.state::<BackendChild>().0.lock().unwrap().replace(child);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // Flush buffered analytics before quitting — the plugin batches
                // events on a timer, so a short session would otherwise lose them
                // (e.g. `app_started` when the app is opened and closed quickly).
                // Safe now that main() enters a Tokio runtime.
                app_handle.flush_events_blocking();
                // Kill the sidecar so no orphan backend is left running.
                if let Some(child) = app_handle.state::<BackendChild>().0.lock().unwrap().take() {
                    kill_tree(child);
                }
            }
        });
}

/// Terminate the sidecar and any descendants it spawned.
///
/// PyInstaller's `--onefile` mode on Windows uses a bootloader process that
/// extracts itself to a temp dir and re-execs the real interpreter as a
/// *child* process. `CommandChild::kill()` only signals the direct child (the
/// bootloader) — the grandchild (the actual uvicorn process) survives as an
/// orphan. `taskkill /T` kills the whole descendant tree instead.
fn kill_tree(child: CommandChild) {
    #[cfg(windows)]
    {
        let pid = child.pid();
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
}
