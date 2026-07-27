// Desktop auto-update UI over useUpdater().
//  - available / downloading / ready  → a prominent centered modal
//  - up-to-date / error               → a lightweight bottom-left toast
// No-ops in the browser build (the hook only leaves 'idle' on desktop).
import { useUpdater } from '@/hooks/useUpdater'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { AlertTriangle, ArrowUpCircle, CheckCircle2, Download, Loader2, RotateCw, X } from 'lucide-react'

export function UpdatePrompt() {
  const u = useUpdater()
  const upToDate = u.error === 'up-to-date'
  const modalOpen = u.status === 'available' || u.status === 'downloading' || u.status === 'ready'
  const cornerVisible = upToDate || (u.status === 'error' && !upToDate)
  const pct = Math.round(u.progress * 100)

  return (
    <>
      <Dialog
        open={modalOpen}
        onOpenChange={(open) => {
          // Never let the user close mid-download (they'd lose the progress UI).
          if (!open && u.status !== 'downloading') u.dismiss()
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogTitle className="sr-only">Software update</DialogTitle>

          <div className="flex flex-col items-center pt-1 text-center">
            <div className="relative mb-1">
              <span className="absolute inset-0 rounded-2xl bg-cyan-500/25 blur-xl" />
              <div className="relative grid h-12 w-12 place-items-center rounded-2xl bg-cyan-500/10 text-cyan-500">
                {u.status === 'ready' ? (
                  <RotateCw className="h-6 w-6" />
                ) : u.status === 'downloading' ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <ArrowUpCircle className="h-6 w-6" />
                )}
              </div>
            </div>

            {u.status === 'available' && (
              <>
                <h2 className="mt-3 text-lg font-bold">Update available</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Beacon <b className="text-foreground">v{u.version}</b> is ready to install
                  {u.currentVersion ? ` — you're on v${u.currentVersion}` : ''}.
                </p>
                {u.notes && (
                  <div className="mt-3 max-h-44 w-full overflow-y-auto whitespace-pre-line rounded-lg border border-border bg-muted/40 p-3 text-left text-xs leading-relaxed text-muted-foreground">
                    {u.notes}
                  </div>
                )}
              </>
            )}

            {u.status === 'downloading' && (
              <>
                <h2 className="mt-3 text-lg font-bold">{pct >= 100 ? 'Installing update…' : 'Downloading update…'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">v{u.version} · {pct}%{pct >= 100 ? ' · keep Beacon open' : ''}</p>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </>
            )}

            {u.status === 'ready' && (
              <>
                <h2 className="mt-3 text-lg font-bold">Update ready</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Restart Beacon to finish updating to <b className="text-foreground">v{u.version}</b>.
                </p>
              </>
            )}
          </div>

          <div className="mt-5 flex justify-center gap-2">
            {u.status === 'available' && (
              <>
                <Button variant="outline" onClick={u.dismiss}>Later</Button>
                <Button className="gap-1.5" onClick={() => void u.downloadAndInstall()}>
                  <Download className="h-4 w-4" /> Download &amp; install
                </Button>
              </>
            )}
            {u.status === 'ready' && (
              <>
                <Button variant="outline" onClick={u.dismiss}>Later</Button>
                <Button className="gap-1.5" onClick={() => void u.restart()}>
                  <RotateCw className="h-4 w-4" /> Restart now
                </Button>
              </>
            )}
            {u.status === 'downloading' && (
              <p className="text-xs text-muted-foreground">{pct >= 100 ? 'Backend stopped safely while all app files are replaced.' : 'You can keep working while the update downloads.'}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {cornerVisible && (
        <div className="fixed bottom-4 left-4 z-[100] w-[320px] max-w-[calc(100vw-2rem)] animate-in slide-in-from-bottom-2 fade-in">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card/95 p-3.5 shadow-lg backdrop-blur">
            {upToDate ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            )}
            <div className="min-w-0 flex-1">
              {upToDate ? (
                <p className="text-sm font-semibold">You're up to date 🎉</p>
              ) : (
                <>
                  <p className="text-sm font-semibold">Update failed</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{u.error}</p>
                  <button
                    onClick={() => void u.check()}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-muted"
                  >
                    <RotateCw className="h-3.5 w-3.5" /> Retry
                  </button>
                </>
              )}
            </div>
            <button
              onClick={u.dismiss}
              aria-label="Dismiss"
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
