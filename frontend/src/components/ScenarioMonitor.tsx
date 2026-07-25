import { useEffect, useState, type ReactNode } from 'react'
import { Activity, CheckCircle2, CircleDashed, Gauge, Timer, Users, X, XCircle } from 'lucide-react'
import type { ScenarioResult } from '../lib/api'
import type { ScenarioParams } from '../types/testModes'

interface ScenarioPlan {
  params: ScenarioParams
  startedAt: number
}

interface Props {
  busy: boolean
  plan: ScenarioPlan | null
  result: ScenarioResult | null
  endpoints: Array<{ id: string; name: string; method?: string }>
  onClear: () => void
}

export function ScenarioMonitor({ busy, plan, result, endpoints, onClear }: Props) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!busy) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [busy])

  if (!plan && !result) return null

  const virtualUsers = result?.virtual_users ?? plan?.params.virtual_users ?? 1
  const iterations = result?.iterations ?? plan?.params.iterations ?? 1
  const plannedJourneys = virtualUsers * iterations
  const elapsedMs = result?.duration_ms ?? Math.max(0, now - (plan?.startedAt ?? now))
  const status = busy ? 'running' : result?.passed ? 'passed' : 'failed'

  return (
    <section className={`overflow-hidden rounded-xl border ${busy ? 'border-indigo-400/30 bg-indigo-500/[0.035]' : result?.passed ? 'border-emerald-500/25 bg-emerald-500/[0.025]' : 'border-red-500/25 bg-red-500/[0.025]'}`} aria-live="polite">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3">
        <div className={`grid h-9 w-9 place-items-center rounded-lg ${busy ? 'bg-indigo-500/15 text-indigo-300' : result?.passed ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}`}>
          {busy ? <CircleDashed className="h-4 w-4 animate-spin" /> : result?.passed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Scenario journey</h2>
            <span className={`rounded px-2 py-0.5 text-[9px] font-bold tracking-wide ${busy ? 'bg-indigo-500/15 text-indigo-300' : result?.passed ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}`}>
              {busy ? 'RUNNING' : result?.stopped_early ? 'STOPPED EARLY' : result?.passed ? 'PASSED' : 'FAILED'}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {busy ? 'Virtual users are moving through this endpoint sequence concurrently.' : `${result?.completed_flows ?? 0} of ${result?.total_flows ?? plannedJourneys} journeys completed.`}
          </p>
        </div>
        {!busy && (
          <button type="button" onClick={onClear} className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close scenario results">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-border/70 bg-border/60 md:grid-cols-4">
        <Metric icon={<Users className="h-3.5 w-3.5" />} label="Virtual users" value={String(virtualUsers)} detail={`${iterations} iteration${iterations === 1 ? '' : 's'} each`} />
        <Metric icon={<Activity className="h-3.5 w-3.5" />} label="Journeys" value={busy ? plannedJourneys.toLocaleString() : `${result?.completed_flows ?? 0}/${result?.total_flows ?? plannedJourneys}`} detail={busy ? 'planned' : `${result?.successful_flows ?? 0} successful`} />
        <Metric icon={<Gauge className="h-3.5 w-3.5" />} label={busy ? 'Endpoint steps' : 'Success rate'} value={busy ? String(endpoints.length) : `${(result?.success_rate ?? 0).toFixed(1)}%`} detail={busy ? `${(plannedJourneys * endpoints.length).toLocaleString()} max executions` : `${result?.failed_flows ?? 0} failed`} />
        <Metric icon={<Timer className="h-3.5 w-3.5" />} label="Elapsed" value={formatDuration(elapsedMs)} detail={busy ? 'live timer' : 'wall-clock time'} />
      </div>

      <div className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="font-medium uppercase tracking-wider">Journey path</span>
          {busy && <span>Live totals appear when all workers finish</span>}
        </div>

        <div className="overflow-x-auto pb-1">
          <ol className="flex min-w-max items-center">
            {endpoints.map((endpoint, index) => {
              const step = result?.steps[index]
              const stepOk = step ? (step.success ?? (step.ok && step.passed !== false)) : undefined
              return (
                <li key={endpoint.id} className="flex items-center">
                  <div className={`relative min-w-[170px] rounded-lg border px-3 py-2.5 ${busy ? 'border-indigo-400/20 bg-background/70' : stepOk ? 'border-emerald-500/20 bg-emerald-500/[0.04]' : 'border-red-500/20 bg-red-500/[0.04]'}`}>
                    {busy && <span className="absolute inset-x-3 top-0 h-px animate-pulse bg-gradient-to-r from-transparent via-indigo-400 to-transparent" style={{ animationDelay: `${index * 160}ms` }} />}
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-[9px] font-bold ${busy ? 'text-indigo-300' : stepOk ? 'text-emerald-500' : 'text-red-500'}`}>{String(index + 1).padStart(2, '0')}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{endpoint.method || 'REQ'}</span>
                    </div>
                    <div className="mt-1.5 max-w-[150px] truncate text-xs font-medium" title={endpoint.name}>{endpoint.name}</div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {busy ? 'processing across users' : step ? `${(step.success_rate ?? (stepOk ? 100 : 0)).toFixed(1)}% · ${step.p95_ms ?? step.time_ms ?? '—'}ms p95` : 'not reached'}
                    </div>
                  </div>
                  {index < endpoints.length - 1 && (
                    <div className="relative h-px w-9 bg-border">
                      {busy && <span className="absolute -top-0.5 h-1.5 w-1.5 animate-[scenario-flow_1.4s_ease-in-out_infinite] rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]" style={{ animationDelay: `${index * 180}ms` }} />}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>

        {result?.bottleneck && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px]">
            <span className="font-semibold text-amber-500">Bottleneck</span>
            <span>{result.bottleneck.name || result.bottleneck.test_id}</span>
            <span className="ml-auto font-mono text-amber-500">P95 {result.bottleneck.p95_ms}ms</span>
          </div>
        )}
      </div>
    </section>
  )
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="bg-background/70 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[9px] text-muted-foreground">{detail}</div>
    </div>
  )
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = Math.floor(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
