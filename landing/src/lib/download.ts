// Direct "download the right installer" for the visitor's OS. On click we look
// up the latest release, pick the matching installer asset, and navigate
// straight to the file — no detour through the GitHub releases page. Falls back
// to the releases page if detection fails or there's no build for the OS yet.
const REPO = 'nannndev/beacon'
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

export type Platform = 'windows' | 'mac' | 'linux' | 'other'

export function detectPlatform(): Platform {
  const ua = navigator.userAgent || ''
  if (/Win/i.test(ua)) return 'windows'
  if (/Mac/i.test(ua)) return 'mac'
  if (/Android/i.test(ua)) return 'other'
  if (/Linux|X11/i.test(ua)) return 'linux'
  return 'other'
}

function assetMatcher(platform: Platform): RegExp | null {
  if (platform === 'windows') return /\.exe$/i
  if (platform === 'mac') return /\.dmg$/i
  if (platform === 'linux') return /\.(appimage|deb)$/i
  return null
}

function pickAsset(assets: any[], platform: Platform): any | null {
  const matcher = assetMatcher(platform)
  if (!matcher) return null
  const candidates = assets.filter((a: any) => matcher.test(a.name || ''))
  if (candidates.length === 0) return null
  if (platform === 'windows') {
    // Prefer the NSIS installer over the raw portable EXE.
    const installer = candidates.find((a: any) => /-setup\.exe$/i.test(a.name || ''))
    if (installer) return installer
  }
  if (platform === 'linux') {
    const appimage = candidates.find((a: any) => /\.appimage$/i.test(a.name || ''))
    if (appimage) return appimage
  }
  return candidates[0]
}

/** Resolve the latest installer URL for a platform, or null if unavailable. */
export async function latestInstallerUrl(platform: Platform, signal?: AbortSignal): Promise<string | null> {
  const matcher = assetMatcher(platform)
  if (!matcher) return null
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { signal })
    if (!res.ok) return null
    const release = await res.json()
    const asset = pickAsset(release.assets || [], platform)
    return asset?.browser_download_url ?? null
  } catch {
    return null
  }
}

/** Start a direct download of the installer, falling back to the releases page.
 *  Pass a platform for the per-OS buttons; omit to auto-detect the visitor's OS. */
export async function startDownload(platform: Platform = detectPlatform()): Promise<void> {
  const url = await latestInstallerUrl(platform)
  window.location.href = url ?? RELEASES_PAGE
}
