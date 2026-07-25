import { Activity, Gauge, Timer, Users, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ScenarioResult } from '../lib/api'

export function ScenarioResultsDialog({ result, onClose }: { result: ScenarioResult | null; onClose: () => void }) {
  if (!result) return null
  const isVirtual = (result.virtual_users ?? 1) > 1 || (result.iterations ?? 1) > 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold">{isVirtual ? 'Virtual user scenario' : 'Scenario result'}</h2>
              <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${result.passed ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}`}>
                {result.passed ? 'PASSED' : result.stopped_early ? 'STOPPED EARLY' : 'FAILED'}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{result.completed}/{result.total} endpoint steps analyzed</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close scenario results"><X className="h-4 w-4" /></button>
        </div>

        {isVirtual && (
          <div className="grid grid-cols-2 gap-2 border-b border-border bg-muted/15 p-4 lg:grid-cols-4">
            <Summary icon={<Users className="h-4 w-4" />} label="Virtual users" value={`${result.virtual_users}`} sub={`${result.iterations} iteration${result.iterations === 1 ? '' : 's'} each`} />
            <Summary icon={<Activity className="h-4 w-4" />} label="Journeys" value={`${result.completed_flows}/${result.total_flows}`} sub={`${result.successful_flows} successful`} />
            <Summary icon={<Gauge className="h-4 w-4" />} label="Success rate" value={`${result.success_rate?.toFixed(1)}%`} tone={(result.failed_flows ?? 0) > 0 ? 'text-amber-500' : 'text-emerald-500'} sub={`${result.failed_flows} failed`} />
            <Summary icon={<Timer className="h-4 w-4" />} label="Duration" value={formatDuration(result.duration_ms ?? 0)} sub="wall-clock time" />
          </div>
        )}

        {result.bottleneck && (
          <div className="mx-4 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs">
            <span className="font-semibold text-amber-500">Bottleneck</span>
            <span>{result.bottleneck.name || result.bottleneck.test_id}</span>
            <span className="ml-auto font-mono text-amber-500">P95 {result.bottleneck.p95_ms}ms</span>
          </div>
        )}

        <div className="max-h-[55vh] overflow-auto p-4">
          <div className="mb-2 grid grid-cols-[minmax(180px,1fr)_80px_80px_80px] gap-2 px-3 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
            <span>Step</span><span className="text-right">Success</span><span className="text-right">Avg</span><span className="text-right">P95</span>
          </div>
          <ol className="space-y-1.5">
            {result.steps.map((step, index) => {
              const ok = step.success ?? (step.ok && step.passed !== false)
              return (
                <li key={`${step.test_id}-${index}`} className="grid grid-cols-[minmax(180px,1fr)_80px_80px_80px] items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={ok ? 'text-emerald-500' : 'text-red-500'}>{ok ? '✓' : '✗'}</span>
                    <span className="truncate font-semibold">{index + 1}. {step.name || step.test_id}</span>
                    {step.error && <span className="truncate text-[10px] text-red-500" title={step.error}>{step.error}</span>}
                  </div>
                  <span className={`text-right font-mono ${Number(step.success_rate ?? (ok ? 100 : 0)) < 100 ? 'text-amber-500' : 'text-emerald-500'}`}>{step.success_rate != null ? `${step.success_rate.toFixed(1)}%` : ok ? '100%' : '0%'}</span>
                  <span className="text-right font-mono text-muted-foreground">{step.avg_ms != null ? `${step.avg_ms}ms` : step.time_ms != null ? `${step.time_ms}ms` : '—'}</span>
                  <span className="text-right font-mono text-muted-foreground">{step.p95_ms != null ? `${step.p95_ms}ms` : '—'}</span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </div>
  )
}

function Summary({ icon, label, value, sub, tone = 'text-foreground' }: { icon: ReactNode; label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">{icon}{label}</div>
      <div className={`mt-2 font-mono text-xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>
    </div>
  )
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 100) / 10
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}
