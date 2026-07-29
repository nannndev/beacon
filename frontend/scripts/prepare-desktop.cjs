const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const backendDir = path.join(__dirname, '..', '..', 'backend');
const distDir = path.join(backendDir, 'dist');
const tauriDir = path.join(__dirname, '..', 'src-tauri');
// Tauri v2 resolves the sidecar as <externalBin>-<target-triple>[.exe] next to
// src-tauri. externalBin is "backend", so the file is src-tauri/backend-<triple>.exe.

// Resolve a working Python launcher (Windows often only has the `py` launcher
// on PATH, not `python`).
function resolvePython() {
  const configuredPython = process.env.BEACON_PYTHON?.trim();
  if (configuredPython) return configuredPython;

  const candidates = isWindows ? ['py', 'python', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: true });
    if (r.status === 0) return cmd;
  }
  console.error('No Python found (tried: ' + candidates.join(', ') + ').');
  process.exit(1);
}

const python = resolvePython();
if (isMac && process.arch !== 'arm64' && process.arch !== 'x64') {
  console.error(`Unsupported macOS architecture: ${process.arch}`);
  process.exit(1);
}
console.log(`Building backend with PyInstaller (using ${python})...`);
const backendBuild = spawnSync(python, ['build_backend.py'], {
  cwd: backendDir,
  stdio: 'inherit',
  shell: false,
});
if (backendBuild.status !== 0) {
  console.error(
    'Failed to build backend. Install backend/requirements-desktop.txt in the selected Python environment.'
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

// Third bundled tool: the headless Beacon CLI. Tauri stages this to a stable
// per-user path named `beacon` / `beacon.exe` when the desktop app launches.
const cliSrcName = isWindows ? 'beacon_cli.exe' : 'beacon_cli';
const cliDestName = isWindows ? `beacon_cli-${triple}.exe` : `beacon_cli-${triple}`;
const cliSrcBinary = path.join(distDir, cliSrcName);
const cliDestBinary = path.join(tauriDir, cliDestName);

if (!fs.existsSync(cliSrcBinary)) {
  console.error(`Beacon CLI binary not found at ${cliSrcBinary}`);
  process.exit(1);
}

fs.copyFileSync(cliSrcBinary, cliDestBinary);
console.log(`Copied ${cliSrcName} -> ${cliDestBinary}`);

// Copy the agent skill (for Claude Code etc.)
const skillSrcDir = path.join(__dirname, '..', '..', '.claude', 'skills', 'beacon');
const skillDestDir = path.join(tauriDir, 'skills', 'beacon');
const skillSrcFile = path.join(skillSrcDir, 'SKILL.md');
const skillDestFile = path.join(skillDestDir, 'SKILL.md');

if (!fs.existsSync(skillSrcFile)) {
  console.error(`Skill not found at ${skillSrcFile}`);
  process.exit(1);
}

fs.mkdirSync(skillDestDir, { recursive: true });
fs.copyFileSync(skillSrcFile, skillDestFile);
console.log(`Copied skill -> ${skillDestFile}`);

console.log('Backend, MCP, and CLI sidecars ready. Now run: npm run tauri:build');
