// Shared theme state. Supports an explicit 'light'/'dark' or 'system' (follows
// the OS). Every control reads/writes the same source of truth and stays in
// sync via a custom event. Mirrors the pre-paint script in index.html.
export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'theme'
const EVENT = 'beacon:theme'

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

export function getThemePref(): ThemePref {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    /* ignore */
  }
  return 'system'
}

export function resolveTheme(pref: ThemePref = getThemePref()): ResolvedTheme {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref
}

export function applyThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* ignore */
  }
  document.documentElement.classList.toggle('dark', resolveTheme(pref) === 'dark')
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pref }))
}

/** Subscribe to theme-preference changes made anywhere. Returns an unsubscribe. */
export function subscribeTheme(fn: (pref: ThemePref) => void): () => void {
  const handler = (event: Event) => fn((event as CustomEvent<ThemePref>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

// When following the OS, re-apply as it flips light/dark live.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (getThemePref() === 'system') {
      document.documentElement.classList.toggle('dark', systemPrefersDark())
      window.dispatchEvent(new CustomEvent(EVENT, { detail: 'system' }))
    }
  })
}
