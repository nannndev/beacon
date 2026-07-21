// In-app auto-update state machine (desktop only). Wraps the Tauri updater +
// process plugins so the UI never imports them directly (they throw in the
// browser/dev build). Auto-checks once shortly after launch; the caller can
// also trigger a manual check.
import { useCallback, useEffect, useRef, useState } from 'react'
import { isDesktop } from '@/lib/platform'

export type UpdateStatus =
  | 'idle' // no update available (or not checked yet)
  | 'checking'
  | 'available' // found, waiting for the user to start the download
  | 'downloading'
  | 'ready' // downloaded + installed, waiting for relaunch
  | 'error'

export interface UpdaterState {
  status: UpdateStatus
  version?: string
  currentVersion?: string
  notes?: string
  progress: number // 0..1 during download
  error?: string
}

export interface Updater extends UpdaterState {
  check: (opts?: { silent?: boolean }) => Promise<void>
  downloadAndInstall: () => Promise<void>
  restart: () => Promise<void>
  dismiss: () => void
}

export function useUpdater(): Updater {
  const [state, setState] = useState<UpdaterState>({ status: 'idle', progress: 0 })
  const updateRef = useRef<any>(null)
  const contentLength = useRef(0)
  const downloaded = useRef(0)
  const didAutoCheck = useRef(false)

  const check = useCallback(async (opts?: { silent?: boolean }) => {
    if (!isDesktop()) return
    setState((s) => ({ ...s, status: 'checking', error: undefined }))
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (update) {
        updateRef.current = update
        setState({
          status: 'available',
          version: (update as any).version,
          currentVersion: (update as any).currentVersion,
          notes: (update as any).body,
          progress: 0,
        })
      } else {
        updateRef.current = null
        // A manual check wants "you're up to date" feedback; a silent auto-check
        // just goes quiet.
        setState({ status: 'idle', progress: 0, error: opts?.silent ? undefined : 'up-to-date' })
      }
    } catch (e: any) {
      const msg = String(e?.message || e)
      // The release manifest lists no build for this OS/arch (e.g. macOS isn't
      // in latest.json yet). That's not a real error — treat it as "nothing to
      // update to for your platform" so the UI doesn't show a scary message.
      if (/platform/i.test(msg) && /were found|not\s*found/i.test(msg)) {
        setState({ status: 'idle', progress: 0, error: opts?.silent ? undefined : 'no-platform' })
      } else {
        setState({ status: 'error', progress: 0, error: msg })
      }
    }
  }, [])

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current
    if (!update) return
    contentLength.current = 0
    downloaded.current = 0
    setState((s) => ({ ...s, status: 'downloading', progress: 0, error: undefined }))
    try {
      await update.downloadAndInstall((event: any) => {
        switch (event?.event) {
          case 'Started':
            contentLength.current = event.data?.contentLength || 0
            break
          case 'Progress':
            downloaded.current += event.data?.chunkLength || 0
            setState((s) => ({
              ...s,
              status: 'downloading',
              progress: contentLength.current ? downloaded.current / contentLength.current : 0,
            }))
            break
          case 'Finished':
            setState((s) => ({ ...s, progress: 1 }))
            break
        }
      })
      setState((s) => ({ ...s, status: 'ready', progress: 1 }))
    } catch (e: any) {
      setState({ status: 'error', progress: 0, error: String(e?.message || e) })
    }
  }, [])

  const restart = useCallback(async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  }, [])

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, status: 'idle', error: undefined }))
  }, [])

  // Auto-check once, a few seconds after launch, so it never competes with the
  // initial render / backend handshake.
  useEffect(() => {
    if (didAutoCheck.current || !isDesktop()) return
    didAutoCheck.current = true
    const t = setTimeout(() => {
      void check({ silent: true })
    }, 3000)
    return () => clearTimeout(t)
  }, [check])

  return { ...state, check, downloadAndInstall, restart, dismiss }
}
