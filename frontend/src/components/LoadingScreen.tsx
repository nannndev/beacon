import { useEffect, useState } from 'react'
import { RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { BrandMark } from './BrandMark'

interface Props {
  error: boolean
  onRetry: () => void
}

const TIPS = [
  'Tip: Press ⌘K to search endpoints, modes, and settings.',
  'Tip: All requests run locally — no cloud, no account needed.',
  'Tip: Create a WebSocket target to test ws:// and wss:// endpoints.',
  'Tip: Use {{random_email}} or {{uuid}} for fresh values per request.',
  'Tip: Chain scenarios with extractors — login once, carry the token forward.',
]

const VERSION = '0.6.0'

export function LoadingScreen({ error, onRetry }: Props) {
  const [tipIndex, setTipIndex] = useState(0)

  useEffect(() => {
    if (error) return
    const timer = setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), 4000)
    return () => clearInterval(timer)
  }, [error])

  return (
    <div className="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-background text-foreground">
      {/* Atmosphere */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_30%,hsl(var(--beacon-500)/0.09),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(#8888_0.6px,transparent_1px)] bg-[length:20px_20px] opacity-[0.08]" />
        {/* Animated orbits */}
        <div className="absolute left-1/2 top-[38%] h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-500/10 animate-[spin_20s_linear_infinite]" />
        <div className="absolute left-1/2 top-[38%] h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-500/8 animate-[spin_14s_linear_infinite_reverse]" />
      </div>

      {/* Brand */}
      <div className="relative flex items-center justify-center">
        <span className="absolute h-20 w-20 rounded-full bg-cyan-500/20 blur-2xl animate-soft-pulse" />
        <div className={error ? 'opacity-90' : 'animate-float scale-125'}>
          <BrandMark size="lg" animated={!error} />
        </div>
      </div>

      {/* Status */}
      <div className="relative mt-8 max-w-xs text-center">
        <h1 className="text-xl font-semibold tracking-tight">
          {error ? 'Beacon backend did not start' : 'Starting Beacon'}
        </h1>
        <p className="mt-2 min-h-[2.5rem] text-sm leading-relaxed text-muted-foreground">
          {error
            ? 'The local backend is taking longer than expected. Check that port 8000 is free, then retry or reopen Beacon.'
            : 'Firing up the local engine, loading your workspace, and preparing your project.'}
        </p>
      </div>

      {/* Progress or retry */}
      <div className="relative mt-6">
        {error ? (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5">
              <WifiOff className="h-3.5 w-3.5 text-red-500" />
              <span className="text-xs text-red-500">Connection refused</span>
            </div>
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-lg transition-all hover:-translate-y-px active:scale-[0.985]"
            >
              <RefreshCw className="h-4 w-4" /> Retry connection
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500" />
              </span>
              <span className="text-[11px] text-muted-foreground">Waiting for backend</span>
            </div>
            <div className="h-1 w-56 overflow-hidden rounded-full bg-muted/50">
              <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-cyan-400/0 via-cyan-400 to-cyan-400/0 animate-indeterminate" />
            </div>
          </div>
        )}
      </div>

      {/* Cycling tip */}
      {!error && (
        <div className="absolute bottom-10 flex flex-col items-center gap-2">
          <p className="animate-[fade-in_0.5s_ease] text-center text-[12px] leading-relaxed text-muted-foreground/70">
            {TIPS[tipIndex]}
          </p>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
              <Wifi className="h-3 w-3" />
              localhost:8000
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/40">v{VERSION}</span>
          </div>
        </div>
      )}
    </div>
  )
}
