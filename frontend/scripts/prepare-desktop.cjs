const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';
const rootDir = path.join(__dirname, '..', '..');
const releaseDir = path.join(rootDir, 'target', 'release');
const tauriDir = path.join(__dirname, '..', 'src-tauri');

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

// Build backend, MCP server, and CLI native binaries with Cargo
console.log('Building Beacon native Rust binaries with Cargo (--release)...');
const cargoBuild = spawnSync(
  'cargo',
  ['build', '--release', '-p', 'beacon-server', '-p', 'beacon-mcp', '-p', 'beacon-cli'],
  {
    cwd: rootDir,
    stdio: 'inherit',
    shell: isWindows,
  }
);
if (cargoBuild.status !== 0) {
  console.error('Failed to compile Rust binaries with Cargo.');
  process.exit(1);
}

// 1. Backend sidecar
const backendSrc = path.join(releaseDir, isWindows ? 'backend.exe' : 'backend');
const backendDest = path.join(tauriDir, isWindows ? `backend-${triple}.exe` : `backend-${triple}`);
if (!fs.existsSync(backendSrc)) {
  console.error(`Backend binary not found at ${backendSrc}`);
  process.exit(1);
}
fs.copyFileSync(backendSrc, backendDest);
console.log(`Copied ${backendSrc} -> ${backendDest}`);

// 2. MCP Server sidecar
const mcpSrc = path.join(releaseDir, isWindows ? 'mcp_server.exe' : 'mcp_server');
const mcpDest = path.join(tauriDir, isWindows ? `mcp_server-${triple}.exe` : `mcp_server-${triple}`);
if (!fs.existsSync(mcpSrc)) {
  console.error(`MCP server binary not found at ${mcpSrc}`);
  process.exit(1);
}
fs.copyFileSync(mcpSrc, mcpDest);
console.log(`Copied ${mcpSrc} -> ${mcpDest}`);

// 3. Headless CLI tool
const cliSrc = path.join(releaseDir, isWindows ? 'beacon_cli.exe' : 'beacon_cli');
const cliDest = path.join(tauriDir, isWindows ? `beacon_cli-${triple}.exe` : `beacon_cli-${triple}`);
if (!fs.existsSync(cliSrc)) {
  console.error(`CLI binary not found at ${cliSrc}`);
  process.exit(1);
}
fs.copyFileSync(cliSrc, cliDest);
console.log(`Copied ${cliSrc} -> ${cliDest}`);

// 4. Copy agent skill (for Claude Code etc.)
const skillSrcDir = fs.existsSync(path.join(rootDir, '.agents', 'skills', 'beacon-api-workbench'))
  ? path.join(rootDir, '.agents', 'skills', 'beacon-api-workbench')
  : path.join(rootDir, '.claude', 'skills', 'beacon-api-workbench');
const skillDestDir = path.join(tauriDir, 'skills', 'beacon-api-workbench');
const skillSrcFile = path.join(skillSrcDir, 'SKILL.md');
const skillDestFile = path.join(skillDestDir, 'SKILL.md');

if (fs.existsSync(skillSrcFile)) {
  fs.mkdirSync(skillDestDir, { recursive: true });
  fs.copyFileSync(skillSrcFile, skillDestFile);
  console.log(`Copied skill -> ${skillDestFile}`);
}

console.log('Backend, MCP, and CLI sidecars ready. Now run: npm run tauri:build');
