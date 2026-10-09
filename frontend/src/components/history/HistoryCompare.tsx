import type { HistoryCompareResult } from '../../types/history'
import { formatMetricDelta, metricTone } from '../../lib/historyMetrics'
import { bucketBySecond } from '../../lib/chartMath'
import { HistoryChart } from './HistoryChart'


const toneClass = { positive: 'text-emerald-500', negative: 'text-red-500', neutral: 'text-muted-foreground' }

export function HistoryCompare({ comparison }: { comparison: HistoryCompareResult }) {
  const perSecond = (samples: typeof comparison.baseline.samples) => bucketBySecond(samples.map((sample) => ({
    elapsed: sample.elapsed_ms / 1000,
    attempts: sample.attempts,
    errors: sample.errors + sample.rate_limited,
    latency: sample.latency_ms,
  })), false, 'spread').map((bucket) => ({ t: bucket.second, v: bucket.latency }))
  const latencySeries = [
    { label: 'Baseline run', color: 'var(--chart-series)', data: perSecond(comparison.baseline.samples) },
    { label: 'Candidate run', color: 'var(--chart-series-2)', data: perSecond(comparison.candidate.samples) },
  ]
  const rows: Array<{ key: string; label: string; unit: string }> = [
    { key: 'p50_ms', label: 'P50 latency', unit: 'ms' },
    { key: 'p95_ms', label: 'P95 latency', unit: 'ms' },
    { key: 'p99_ms', label: 'P99 latency', unit: 'ms' },
    { key: 'errors', label: 'Errors', unit: '' },
    { key: 'rate_limited', label: 'Rate limited', unit: '' },
    { key: 'success', label: 'Successful', unit: '' },
    { key: 'average_rps', label: 'Avg requests / s', unit: '' },
  ]
  return (
    <div className="h-full overflow-y-auto p-5 lg:p-6">
      <div className="flex items-end justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-500">Run comparison</p><h2 className="mt-1 text-2xl font-bold">Baseline vs Candidate</h2></div>
        {!comparison.same_mode && <span className="rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs text-amber-600 dark:text-amber-400">Different modes</span>}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: 'var(--chart-series)' }} aria-hidden="true" />Baseline</div><div className="mt-1 truncate font-semibold">{comparison.baseline.target_name}</div><div className="mt-1 text-xs text-muted-foreground">{comparison.baseline.mode} · {new Date(comparison.baseline.started_at).toLocaleString()}</div></div>
        <div className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: 'var(--chart-series-2)' }} aria-hidden="true" />Candidate</div><div className="mt-1 truncate font-semibold">{comparison.candidate.target_name}</div><div className="mt-1 text-xs text-muted-foreground">{comparison.candidate.mode} · {new Date(comparison.candidate.started_at).toLocaleString()}</div></div>
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl border border-border">
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr] bg-muted/50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><span>Metric</span><span>Base value</span><span>New value</span><span>Change</span></div>
        {rows.map(({ key, label, unit }) => {
          const delta = comparison.deltas[key]
          const base = (comparison.baseline.metrics as any)[key]
          const candidate = (comparison.candidate.metrics as any)[key]
          const tone = metricTone(key, delta?.change ?? null)
          return (
            <div key={key} className="grid grid-cols-[1fr_1fr_1fr_1fr] border-t border-border px-4 py-3 text-sm tabular-nums">
              <span className="font-medium">{label}</span>
              <span>{formatCell(base, unit)}</span>
              <span>{formatCell(candidate, unit)}</span>
              <span className={toneClass[tone]}>
                {formatMetricDelta(delta?.change ?? null, unit)}
                {tone !== 'neutral' && <span className="ml-1.5 text-[11px]">{tone === 'positive' ? 'better' : 'worse'}</span>}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-5"><HistoryChart title="Latency comparison" subtitle="Both runs share the same elapsed-time scale; the longer tail is not extrapolated" series={latencySeries} unit=" ms" format={(value) => (value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1))} /></div>
    </div>
  )
}

function formatCell(value: unknown, unit: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const text = value >= 100 ? Math.round(value).toLocaleString() : Number.isInteger(value) ? String(value) : value.toFixed(1)
  return unit ? `${text} ${unit}` : text
}
