// Beacon unified dev runner.
//
// Launches the Rust backend (Axum), the React/Vite frontend, and the VitePress
// docs together, reading every port from the single root `.env` so nothing
// can drift out of sync. Cross-platform (uses `concurrently`, already a dep).
//
//   node scripts/dev.mjs                # all three
//   node scripts/dev.mjs backend        # just the backend
//   node scripts/dev.mjs frontend docs  # a subset
//
import { readFileSync, existsSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import concurrently from 'concurrently'
import pc from 'picocolors'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// --- load .env (create from template on first run) -----------------------
function loadEnv() {
  const envPath = resolve(ROOT, '.env')
  const examplePath = resolve(ROOT, '.env.example')
  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath)
    console.log(pc.dim('[dev] created .env from .env.example'))
  }
  const env = {}
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
      const idx = trimmed.indexOf('=')
      const key = trimmed.slice(0, idx).trim()
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
      env[key] = val
    }
  }
  return env
}

const env = loadEnv()
const BACKEND_PORT = env.BACKEND_PORT || '8000'
const FRONTEND_PORT = env.FRONTEND_PORT || '5173'
const DOCS_PORT = env.DOCS_PORT || '5174'
const LANDING_PORT = env.LANDING_PORT || '5175'

// --- child env passed to every process (so they can read ports too) ------
const childEnv = { ...process.env, PORT: BACKEND_PORT, BACKEND_PORT, FRONTEND_PORT, DOCS_PORT, LANDING_PORT }

const SERVICES = {
  backend: {
    name: 'BACKEND',
    prefixColor: 'blue',
    command: `cargo run -p beacon-server`,
    cwd: ROOT,
  },
  frontend: {
    name: 'FRONTEND',
    prefixColor: 'green',
    command: 'pnpm --dir frontend dev',
    cwd: ROOT,
  },
  docs: {
    name: 'DOCS',
    prefixColor: 'magenta',
    command: `pnpm exec vitepress dev docs --port ${DOCS_PORT}`,
    cwd: ROOT,
  },
  landing: {
    name: 'LANDING',
    prefixColor: 'yellow',
    command: 'pnpm --dir landing dev',
    cwd: ROOT,
  },
}

// --- pick services from CLI args (default: all) --------------------------
const requested = process.argv.slice(2).map((a) => a.toLowerCase())
const unknown = requested.filter((a) => !(a in SERVICES))
if (unknown.length) {
  console.error(pc.red(`[dev] Unknown service(s): ${unknown.join(', ')}`))
  console.error(pc.dim(`[dev] Valid: ${Object.keys(SERVICES).join(', ')}`))
  process.exit(1)
}
const selected = requested.length ? requested : Object.keys(SERVICES)

// --- banner --------------------------------------------------------------
console.log(pc.bold('\n  Beacon dev — starting: ') + pc.bold(selected.join(', ')))
if (selected.includes('backend')) console.log('  ' + pc.blue('Backend ') + pc.dim(`→ http://localhost:${BACKEND_PORT}`))
if (selected.includes('frontend')) console.log('  ' + pc.green('Frontend') + pc.dim(`→ http://localhost:${FRONTEND_PORT}`))
if (selected.includes('docs')) console.log('  ' + pc.magenta('Docs    ') + pc.dim(`→ http://localhost:${DOCS_PORT}/docs/`))
if (selected.includes('landing')) console.log('  ' + pc.yellow('Landing ') + pc.dim(`→ http://localhost:${LANDING_PORT}`))
console.log(pc.dim('  (Ctrl+C stops everything)\n'))

const commands = selected.map((key) => ({
  command: SERVICES[key].command,
  name: SERVICES[key].name,
  prefixColor: SERVICES[key].prefixColor,
  cwd: SERVICES[key].cwd,
  env: childEnv,
}))

const { result } = concurrently(commands, {
  prefix: 'name',
  killOthers: ['failure', 'success'],
  restartTries: 0,
})

result.then(
  () => process.exit(0),
  () => process.exit(1),
)
