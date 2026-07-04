const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';
const backendDir = path.join(__dirname, '..', '..', 'backend');
const distDir = path.join(backendDir, 'dist');
const tauriDir = path.join(__dirname, '..', 'src-tauri');
// Tauri v2 resolves the sidecar as <externalBin>-<target-triple>[.exe] next to
// src-tauri. externalBin is "backend", so the file is src-tauri/backend-<triple>.exe.

// Resolve a working Python launcher (Windows often only has the `py` launcher
// on PATH, not `python`).
function resolvePython() {
  const candidates = isWindows ? ['py', 'python', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: true });
    if (r.status === 0) return cmd;
  }
  console.error('No Python found (tried: ' + candidates.join(', ') + ').');
  process.exit(1);
}

const python = resolvePython();
console.log(`Building backend with PyInstaller (using ${python})...`);
try {
  execSync(`${python} build_backend.py`, { cwd: backendDir, stdio: 'inherit' });
} catch (e) {
  console.error(
    'Failed to build backend. Make sure PyInstaller is installed (pip install pyinstaller) and you are in a Python env with the backend deps.'
  );
  process.exit(1);
}

// Tauri v2 requires the sidecar filename to carry the Rust host target triple.
function targetTriple() {
  const out = execSync('rustc -vV', { encoding: 'utf8' });
  const m = out.match(/host:\s*(\S+)/);
  if (!m) {
    console.error('Could not determine Rust target triple from `rustc -vV`. Is Rust installed?');
    process.exit(1);
  }
  return m[1];
}

const triple = targetTriple();
const srcName = isWindows ? 'backend.exe' : 'backend';
const destName = isWindows ? `backend-${triple}.exe` : `backend-${triple}`;
const srcBinary = path.join(distDir, srcName);
const destBinary = path.join(tauriDir, destName);

if (!fs.existsSync(srcBinary)) {
  console.error(`Backend binary not found at ${srcBinary}`);
  process.exit(1);
}

fs.copyFileSync(srcBinary, destBinary);
console.log(`Copied ${srcName} -> ${destBinary}`);

// Second sidecar: the MCP server binary (same triple-suffix convention).
const mcpSrcName = isWindows ? 'mcp_server.exe' : 'mcp_server';
const mcpDestName = isWindows ? `mcp_server-${triple}.exe` : `mcp_server-${triple}`;
const mcpSrcBinary = path.join(distDir, mcpSrcName);
const mcpDestBinary = path.join(tauriDir, mcpDestName);

if (!fs.existsSync(mcpSrcBinary)) {
  console.error(`MCP server binary not found at ${mcpSrcBinary}`);
  process.exit(1);
}

fs.copyFileSync(mcpSrcBinary, mcpDestBinary);
console.log(`Copied ${mcpSrcName} -> ${mcpDestBinary}`);
console.log('Backend sidecar ready. Now run: npm run tauri:build');
