import { RefreshCw } from 'lucide-react'
import { BrandMark } from './BrandMark'

interface Props {
  error: boolean
  onRetry: () => void
}

/** Full-screen boot state shown while the local backend sidecar starts up.
 *  Animated (floating brand mark + pulsing glow + indeterminate sweep) so the
 *  wait never feels frozen, with a Retry path if the backend is slow. */
export function LoadingScreen({ error, onRetry }: Props) {
  return (
    <div className="relative flex h-screen flex-col items-center justify-center gap-6 overflow-hidden bg-background text-foreground">
      {/* faint dotted backdrop, matching the landing aesthetic */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(#8888_0.6px,transparent_1px)] bg-[length:22px_22px] opacity-[0.15]" />

      <div className="relative flex items-center justify-center">
        {/* pulsing cyan glow behind the mark */}
        <span className="absolute h-24 w-24 rounded-full bg-cyan-500/25 blur-2xl animate-soft-pulse" />
        <div className={error ? 'opacity-90' : 'animate-float scale-125'}>
          <BrandMark size="lg" animated={!error} />
        </div>
      </div>

      <div className="max-w-xs text-center">
        <div className="text-lg font-semibold">
          {error ? 'Beacon backend did not start' : 'Loading your workspace'}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {error
            ? 'The local backend is taking longer than expected. Retry, or reopen Beacon if it keeps happening.'
            : 'Starting the local backend and loading your project.'}
        </p>
      </div>

      {error ? (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-transform active:scale-[0.98]"
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      ) : (
        <div className="h-1 w-48 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-cyan-400/0 via-cyan-400 to-cyan-400/0 animate-indeterminate" />
        </div>
      )}
    </div>
  )
}
