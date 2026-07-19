import path from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone marketing site. Reads the single source-of-truth .env at the repo
// root (one level up) so ports/URLs never drift from the app + docs.
export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(__dirname, '..')
  const env = loadEnv(mode, rootDir, '')

  const DOCS_PORT = env.DOCS_PORT || '5174'
  const LANDING_PORT = Number(env.LANDING_PORT) || 5175
  const FRONTEND_PORT = env.FRONTEND_PORT || '5173'

  // Where the marketing CTAs point. Override any of these in the root .env.
  const docsUrl = env.VITE_DOCS_URL || `http://localhost:${DOCS_PORT}/docs/`
  const downloadUrl = env.VITE_DOWNLOAD_URL || 'https://github.com/nannndev/beacon/releases/latest'
  const appUrl = env.VITE_APP_URL || `http://localhost:${FRONTEND_PORT}`

  return {
    plugins: [react()],
    envDir: rootDir,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      'import.meta.env.VITE_DOCS_URL': JSON.stringify(docsUrl),
      'import.meta.env.VITE_DOWNLOAD_URL': JSON.stringify(downloadUrl),
      'import.meta.env.VITE_APP_URL': JSON.stringify(appUrl),
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          contributors: path.resolve(__dirname, 'contributors/index.html'),
        },
      },
    },
    server: {
      port: LANDING_PORT,
      strictPort: true,
      host: '0.0.0.0',
    },
  }
})
