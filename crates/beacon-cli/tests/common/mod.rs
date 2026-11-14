//! Shared test helpers: a minimal HTTP/1.1 mock server (no axum/std::net-only,
//! to keep the dev-dependency list small) and a `beacon.yaml` project-folder
//! builder that writes the exact on-disk shape `project_file_sync.py`
//! produces, so these tests exercise the real CLI binary end-to-end.

#![allow(dead_code)]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::thread;

pub struct MockResponse {
    pub status: u16,
    pub body: String,
}

impl MockResponse {
    pub fn json(status: u16, body: serde_json::Value) -> Self {
        Self { status, body: body.to_string() }
    }
}

/// Start a background HTTP server on an OS-assigned port. `routes` keys are
/// `"METHOD /path"`; anything else gets a 404. Returns the base URL
/// (`http://127.0.0.1:PORT`). The server thread exits when the test binary
/// exits.
pub fn spawn_mock_server(routes: Vec<(&'static str, MockResponse)>) -> String {
    let (base_url, _) = spawn_mock_server_capturing(routes);
    base_url
}

/// Like `spawn_mock_server`, but every received request header map (lower-
/// cased names) is pushed to the returned shared log, so a test can assert
/// on what the CLI actually sent (e.g. a resolved `Authorization` header).
pub fn spawn_mock_server_capturing(
    routes: Vec<(&'static str, MockResponse)>,
) -> (String, std::sync::Arc<std::sync::Mutex<Vec<HashMap<String, String>>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    let port = listener.local_addr().unwrap().port();
    let routes: HashMap<String, MockResponse> = routes.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured_clone = captured.clone();

    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            handle_connection(stream, &routes, &captured_clone);
        }
    });

    (format!("http://127.0.0.1:{}", port), captured)
}

fn handle_connection(
    mut stream: TcpStream,
    routes: &HashMap<String, MockResponse>,
    captured: &std::sync::Arc<std::sync::Mutex<Vec<HashMap<String, String>>>>,
) {
    stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).ok();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let Ok(n) = stream.read(&mut chunk) else { return };
        if n == 0 {
            break None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
            break Some(pos);
        }
        if buf.len() > 1_000_000 {
            return;
        }
    };
    let Some(header_end) = header_end else { return };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let Some(request_line) = lines.next() else { return };
    let mut parts = request_line.split_whitespace();
    let (Some(method), Some(path)) = (parts.next(), parts.next()) else { return };

    let header_lines: Vec<&str> = lines.collect();
    let mut headers = HashMap::new();
    for line in &header_lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_lowercase(), value.trim().to_string());
        }
    }
    captured.lock().unwrap().push(headers.clone());

    let content_length: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);

    let body_so_far = buf.len() - (header_end + 4);
    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < content_length {
        let Ok(n) = stream.read(&mut chunk) else { break };
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    let _ = body_so_far;

    let path_only = path.split('?').next().unwrap_or(path);
    let key = format!("{} {}", method, path_only);
    let response = routes.get(&key);
    let (status, body_text) = match response {
        Some(r) => (r.status, r.body.clone()),
        None => (404, "{\"error\":\"not found\"}".to_string()),
    };
    let reason = reason_phrase(status);
    let out = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        reason,
        body_text.as_bytes().len(),
        body_text
    );
    let _ = stream.write_all(out.as_bytes());
    let _ = stream.flush();
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        _ => "OK",
    }
}

// --- project-folder builder ------------------------------------------------

pub struct ProjectBuilder {
    pub root: PathBuf,
    environments: Vec<String>,
    items: Vec<String>,
}

impl ProjectBuilder {
    pub fn new(root: &Path) -> Self {
        std::fs::create_dir_all(root.join("endpoints")).unwrap();
        std::fs::create_dir_all(root.join("environments")).unwrap();
        Self { root: root.to_path_buf(), environments: Vec::new(), items: Vec::new() }
    }

    pub fn environment(mut self, id: &str, name: &str, base_url: &str, variables: &[(&str, Option<&str>)]) -> Self {
        let relative = format!("environments/{}.yaml", id);
        let vars_yaml: String = variables
            .iter()
            .map(|(k, v)| match v {
                Some(val) => format!("  {}: {:?}\n", k, val),
                None => format!("  {}: null\n", k),
            })
            .collect();
        let content = format!(
            "id: {id}\nname: {name}\nbase_url: {base_url}\nvariables:\n{vars}",
            id = id,
            name = name,
            base_url = base_url,
            vars = if vars_yaml.is_empty() { "  {}\n".to_string() } else { vars_yaml },
        );
        std::fs::write(self.root.join(&relative), content).unwrap();
        self.environments.push(relative);
        self
    }

    /// Write an endpoint YAML file (without placing it in the manifest tree
    /// yet). `extra_yaml` is raw YAML appended under the endpoint document
    /// (e.g. `assertions:\n  - type: status...`). A default `headers: {}` /
    /// `payload: {}` is included unless `extra_yaml` already declares that key.
    fn write_endpoint_file(&self, id: &str, name: &str, url: &str, method: &str, extra_yaml: &str) -> String {
        let relative = format!("endpoints/{}.yaml", id);
        let mut header = format!("id: {id}\nname: {name}\nurl: {url}\nmethod: {method}\n", id = id, name = name, url = url, method = method);
        if !extra_yaml.contains("headers:") {
            header.push_str("headers: {}\n");
        }
        if !extra_yaml.contains("payload:") {
            header.push_str("payload: {}\n");
        }
        if !extra_yaml.contains("payload_type:") {
            header.push_str("payload_type: json\n");
        }
        let content = format!("{header}{extra}", header = header, extra = extra_yaml);
        std::fs::write(self.root.join(&relative), content).unwrap();
        relative
    }

    /// Add a top-level request endpoint.
    pub fn endpoint(mut self, id: &str, name: &str, url: &str, method: &str, extra_yaml: &str) -> Self {
        let relative = self.write_endpoint_file(id, name, url, method, extra_yaml);
        self.items.push(format!(
            "    - type: request\n      id: {id}\n      file: {relative}\n",
            id = id,
            relative = relative
        ));
        self
    }

    /// Add a folder containing freshly-defined endpoints nested under it in
    /// the manifest tree (not also placed at the top level). Each tuple is
    /// `(id, name, url, method, extra_yaml)`. `auth_yaml`, if non-empty, is
    /// inlined as the folder's `auth:` block.
    pub fn folder_with(
        mut self,
        folder_id: &str,
        folder_name: &str,
        endpoints: &[(&str, &str, &str, &str, &str)],
        auth_yaml: &str,
    ) -> Self {
        let mut nested = String::new();
        for (id, name, url, method, extra_yaml) in endpoints {
            let relative = self.write_endpoint_file(id, name, url, method, extra_yaml);
            nested.push_str(&format!(
                "        - type: request\n          id: {id}\n          file: {relative}\n",
                id = id,
                relative = relative
            ));
        }
        let auth_block = if auth_yaml.is_empty() {
            String::new()
        } else {
            format!("      auth:\n{}", indent(auth_yaml, "        "))
        };
        self.items.push(format!(
            "    - type: folder\n      id: {folder_id}\n      name: {folder_name}\n{auth_block}      items:\n{nested}",
            folder_id = folder_id,
            folder_name = folder_name,
            auth_block = auth_block,
            nested = nested,
        ));
        self
    }

    pub fn build(self, project_id: &str, project_name: &str, current_environment_id: &str) {
        let env_list: String = self.environments.iter().map(|e| format!("    - {}\n", e)).collect();
        let items: String = self.items.concat();
        let manifest = format!(
            "format: beacon.project\nversion: 1\nproject:\n  id: {project_id}\n  name: {project_name}\n  current_environment_id: {current_environment_id}\n  environments:\n{env_list}  items:\n{items}",
            project_id = project_id,
            project_name = project_name,
            current_environment_id = current_environment_id,
            env_list = env_list,
            items = items,
        );
        std::fs::write(self.root.join("beacon.yaml"), manifest).unwrap();
    }
}

fn indent(text: &str, prefix: &str) -> String {
    text.lines().map(|l| format!("{}{}\n", prefix, l)).collect()
}

// --- CLI invocation ---------------------------------------------------------

pub fn beacon_cmd() -> Command {
    Command::new(env!("CARGO_BIN_EXE_beacon_cli"))
}

pub fn run_cli(args: &[&str]) -> Output {
    beacon_cmd().args(args).output().expect("run beacon_cli")
}

pub fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

pub fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).to_string()
}
