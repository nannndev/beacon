// Single source of truth for "are we running inside the desktop shell?".
// Used to switch the API base, the WebSocket base, and the initial view so the
// detection can't drift between call sites.
export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as any
  // Tauri v2 exposes `globalThis.isTauri`; the older globals are retained as
  // fallbacks for existing installs/dev tooling.
  return !!w.isTauri || !!w.__TAURI_INTERNALS__ || !!w.__TAURI__ || !!w.process?.versions?.electron
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return
  if (isDesktop()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
      return
    } catch (e) {
      console.warn('[beacon] failed to open external URL with tauri plugin-shell, falling back to window.open', e)
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

