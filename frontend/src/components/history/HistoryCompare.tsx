import type { HistoryCompareResult } from '../../types/history'
import { formatMetricDelta, metricTone } from '../../lib/historyMetrics'
import { HistoryChart } from './HistoryChart'


const toneClass = { positive: 'text-emerald-500', negative: 'text-red-500', neutral: 'text-muted-foreground' }

export function HistoryCompare({ comparison }: { comparison: HistoryCompareResult }) {
  const latencySeries = [
    { label: 'Baseline run', color: '#22d3ee', points: comparison.baseline.samples.filter((sample) => sample.latency_ms != null).map((sample) => ({ x: sample.elapsed_ms, y: sample.latency_ms! })) },
    { label: 'Candidate run', color: '#a78bfa', points: comparison.candidate.samples.filter((sample) => sample.latency_ms != null).map((sample) => ({ x: sample.elapsed_ms, y: sample.latency_ms! })) },
  ]
  const keys = ['p50_ms', 'p95_ms', 'p99_ms', 'errors', 'rate_limited', 'success', 'average_rps']
  return (
    <div className="h-full overflow-y-auto p-5 lg:p-6">
      <div className="flex items-end justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-500">Run comparison</p><h2 className="mt-1 text-2xl font-bold">Baseline vs Candidate</h2></div>
        {!comparison.same_mode && <span className="rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs text-amber-600 dark:text-amber-400">Different modes</span>}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-4"><div className="text-xs font-semibold text-cyan-500">Baseline</div><div className="mt-1 truncate font-semibold">{comparison.baseline.target_name}</div><div className="mt-1 text-xs text-muted-foreground">{comparison.baseline.mode} · {new Date(comparison.baseline.started_at).toLocaleString()}</div></div>
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4"><div className="text-xs font-semibold text-violet-500">Candidate</div><div className="mt-1 truncate font-semibold">{comparison.candidate.target_name}</div><div className="mt-1 text-xs text-muted-foreground">{comparison.candidate.mode} · {new Date(comparison.candidate.started_at).toLocaleString()}</div></div>
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl border border-border">
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr] bg-muted/50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><span>Metric</span><span>Base value</span><span>New value</span><span>Change</span></div>
        {keys.map((key) => {
          const delta = comparison.deltas[key]
          const base = (comparison.baseline.metrics as any)[key]
          const candidate = (comparison.candidate.metrics as any)[key]
          const tone = metricTone(key, delta?.change ?? null)
          return <div key={key} className="grid grid-cols-[1fr_1fr_1fr_1fr] border-t border-border px-4 py-3 text-sm"><span className="font-medium">{key.replaceAll('_', ' ')}</span><span>{base ?? '—'}</span><span>{candidate ?? '—'}</span><span className={toneClass[tone]}>{formatMetricDelta(delta?.change ?? null)}</span></div>
        })}
      </div>
      <div className="mt-5"><HistoryChart title="Latency comparison" subtitle="Both runs share the same elapsed-time scale; the longer tail is not extrapolated" series={latencySeries} unit="ms" /></div>
    </div>
  )
}
