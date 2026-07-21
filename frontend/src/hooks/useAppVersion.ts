/**
 * The app version, baked in at build time from src-tauri/tauri.conf.json
 * (see vite.config.ts). Synchronous and reliable — no runtime IPC that can
 * fail or lag (the old getVersion() call sometimes returned nothing → "—").
 */
export function useAppVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''
}
