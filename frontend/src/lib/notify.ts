// Best-effort native OS notifications (desktop only). Imports the Tauri
// notification plugin lazily so the browser/dev build never touches it.
import { isDesktop } from './platform'
import { getNotifyRunFinished } from './prefs'

export interface RunSummary {
  attempts: number
  success: number
  rate_limited: number
  errors: number
}

/** Notify that a run finished. Silently no-ops in the browser or if the user
 *  denied notification permission. */
export async function notifyRunFinished(stats: RunSummary): Promise<void> {
  if (!isDesktop() || !getNotifyRunFinished()) return
  try {
    const mod = await import('@tauri-apps/plugin-notification')
    let granted = await mod.isPermissionGranted()
    if (!granted) {
      granted = (await mod.requestPermission()) === 'granted'
    }
    if (!granted) return
    const { attempts, success, rate_limited, errors } = stats
    mod.sendNotification({
      title: 'Beacon — run finished',
      body: `${attempts} attempts · ${success} ok · ${rate_limited} rate-limited · ${errors} errors`,
    })
  } catch {
    // notifications are auxiliary — never let them break a run
  }
}
