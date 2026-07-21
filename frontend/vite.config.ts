import path from 'path'
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Read the single source-of-truth .env at the repo root (one level up).
  const rootDir = path.resolve(__dirname, '..')
  const env = loadEnv(mode, rootDir, '')

  // Bake the app version from tauri.conf.json at build time so the UI never
  // depends on a runtime IPC call (getVersion() can fail / lag → showed "—").
  let appVersion = ''
  try {
    appVersion = JSON.parse(readFileSync(path.resolve(__dirname, 'src-tauri/tauri.conf.json'), 'utf8')).version || ''
  } catch { /* keep empty */ }

  const BACKEND_PORT = env.BACKEND_PORT || '8000'
  const FRONTEND_PORT = Number(env.FRONTEND_PORT) || 5173
  const DOCS_PORT = env.DOCS_PORT || '5174'

  const backendTarget = `http://127.0.0.1:${BACKEND_PORT}`
  const docsUrl = `http://localhost:${DOCS_PORT}/docs/`

  // All backend routes share the same proxy target.
  const proxyPaths = ['/config', '/tests', '/run', '/status', '/stop', '/projects', '/global', '/history']
  const proxy: Record<string, any> = Object.fromEntries(
    proxyPaths.map((p) => [p, { target: backendTarget, changeOrigin: true }]),
  )
  proxy['/ws'] = { target: `ws://127.0.0.1:${BACKEND_PORT}`, ws: true, changeOrigin: true }

  return {
    plugins: [react()],
    // Expose VITE_* vars from the root .env (not frontend/.env) to the client.
    envDir: rootDir,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    // Docs link URL derived from DOCS_PORT — single knob, no drift.
    define: {
      'import.meta.env.VITE_DOCS_URL': JSON.stringify(docsUrl),
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    // Tauri expects a fixed port in dev
    server: {
      port: FRONTEND_PORT,
      strictPort: true,
      host: '0.0.0.0',
      proxy,
    },
    // Pre-bundle the lazily-imported Tauri modules so Vite doesn't discover them
    // mid-session and trigger a full page reload — that reload can race the
    // desktop backend handshake and surface a false "backend did not start".
    optimizeDeps: {
      include: [
        '@tauri-apps/api/app',
        '@tauri-apps/api/core',
        '@tauri-apps/plugin-notification',
        '@tauri-apps/plugin-updater',
        '@tauri-apps/plugin-process',
      ],
    },
  }
})
