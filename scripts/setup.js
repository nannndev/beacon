#!/usr/bin/env node

const { execSync } = require('child_process');
const pc = require('picocolors');
const path = require('path');
const fs = require('fs');

const rootDir = process.cwd();

function log(message, color = 'white') {
  const colors = {
    green: pc.green,
    cyan: pc.cyan,
    yellow: pc.yellow,
    red: pc.red,
    blue: pc.blue,
    magenta: pc.magenta,
    bold: pc.bold,
  };
  const fn = colors[color] || pc.white;
  console.log('\n' + fn(pc.bold(message)) + '\n');
}

function success(message) {
  console.log(pc.green('✅ ' + message));
}

function run(cmd, options = {}) {
  try {
    console.log(pc.dim(`$ ${cmd}`));
    execSync(cmd, { 
      stdio: 'inherit', 
      cwd: options.cwd || rootDir,
      shell: process.platform === 'win32' ? 'cmd.exe' : undefined 
    });
    return true;
  } catch (e) {
    log(`Failed: ${cmd}`, 'red');
    process.exit(1);
  }
}

async function main() {
  console.log(pc.bold(pc.blue('🚀 Security Tools Setup')));
  console.log(pc.dim('One-command setup for backend + frontend...\n'));

  // 1. Root
  log('=== Installing root deps ===', 'cyan');
  run('pnpm install');

  // 2. Frontend
  log('=== Installing frontend (React + shadcn/ui) ===', 'cyan');
  const frontendDir = path.join(rootDir, 'frontend');
  run('pnpm install', { cwd: frontendDir });

  // 3. Landing
  log('=== Installing landing page ===', 'cyan');
  const landingDir = path.join(rootDir, 'landing');
  run('pnpm install', { cwd: landingDir });

  // 4. Backend
  log('=== Installing backend (FastAPI) ===', 'cyan');
  const backendDir = path.join(rootDir, 'backend');
  const pipCmd = process.platform === 'win32' 
    ? 'py -m pip install -r requirements.txt || python -m pip install -r requirements.txt' 
    : 'python3 -m pip install -r requirements.txt || python -m pip install -r requirements.txt';
  
  run(pipCmd, { cwd: backendDir });

  success('Setup complete!');
  console.log(pc.green('\n✅ Ready!'));
  console.log(pc.dim('Run "pnpm dev" to start both services together.\n'));
}

main().catch(console.error);