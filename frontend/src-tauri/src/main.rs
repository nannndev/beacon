#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mcp_registration;

use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// The sidecar binary name Tauri resolves at runtime (no triple suffix — Tauri
/// strips it and appends the OS extension). Matches `externalBin` in
/// tauri.conf.json.
#[cfg(windows)]
const MCP_BINARY_NAME: &str = "mcp_server.exe";
#[cfg(not(windows))]
const MCP_BINARY_NAME: &str = "mcp_server";

/// Absolute path where we stage the MCP binary for stdio clients to launch.
/// Stored in a Tauri-managed state so the command can return it.
pub(crate) struct McpServerPath(pub(crate) Mutex<PathBuf>);

/// The port the bundled backend sidecar was told to listen on. The frontend
/// reads this via the `backend_port` command so it never hardcodes 8000.
struct BackendPort(u16);

/// Handle to the spawned sidecar so we can kill it when the app exits.
struct BackendChild(Mutex<Option<CommandChild>>);

#[tauri::command]
fn backend_port(state: State<BackendPort>) -> u16 {
    state.0
}

#[tauri::command]
fn mcp_server_path(state: State<McpServerPath>) -> String {
    state.0.lock().unwrap().to_string_lossy().to_string()
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
    let port = pick_free_port();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendPort(port))
        .manage(BackendChild(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            backend_port,
            mcp_server_path,
            mcp_registration::mcp_status,
            mcp_registration::mcp_register_claude_desktop,
            mcp_registration::mcp_unregister_claude_desktop,
            mcp_registration::mcp_register_claude_code,
            mcp_registration::mcp_unregister_claude_code
        ])
        .setup(move |app| {
            #[cfg(debug_assertions)]
            app.get_webview_window("main").unwrap().open_devtools();

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

            // Launch the bundled Python backend, injecting the chosen port and
            // the data dir. The sidecar name matches `externalBin` in tauri.conf.json.
            let sidecar = app
                .shell()
                .sidecar("backend")
                .expect("backend sidecar not configured")
                .env("BEACON_PORT", port.to_string())
                .env("BEACON_DATA_DIR", data_dir.to_string_lossy().to_string())
                .args(["--port", &port.to_string()]);

            let (mut _rx, child) = sidecar.spawn().expect("failed to spawn backend sidecar");
            app.state::<BackendChild>().0.lock().unwrap().replace(child);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Kill the sidecar when the app is quitting so no orphan backend.exe
            // is left running.
            if let RunEvent::ExitRequested { .. } = event {
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
