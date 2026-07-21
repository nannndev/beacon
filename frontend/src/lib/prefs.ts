// Small, local (per-device) app preferences backed by localStorage. These are
// UI/desktop-shell settings, distinct from project/config data on the backend.
const NOTIFY_RUN_FINISHED = 'beacon.notify.runFinished'

export function getNotifyRunFinished(): boolean {
  try {
    return localStorage.getItem(NOTIFY_RUN_FINISHED) !== 'false' // default: on
  } catch {
    return true
  }
}

export function setNotifyRunFinished(enabled: boolean): void {
  try {
    localStorage.setItem(NOTIFY_RUN_FINISHED, enabled ? 'true' : 'false')
  } catch {
    /* ignore */
  }
}
