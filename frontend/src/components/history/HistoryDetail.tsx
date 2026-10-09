import { useMemo } from 'react'
import { Download, FileText, Loader2, Pin, PinOff, Tag, Trash2 } from 'lucide-react'

import type { HistoryDetail as Detail } from '../../types/history'
import { bucketBySecond } from '../../lib/chartMath'
import { HistoryChart } from './HistoryChart'


interface Props {
  detail: Detail
  onPin: () => void
  onLabel: () => void
  onExport: () => void
  onReport: (format?: 'html' | 'md' | 'pdf') => void
  onDelete: () => void
  exporting?: 'run' | 'report' | null
}

const Metric = ({ label, value, unit = '', status }: {
  label: string
  value: number | null | undefined
  unit?: string
  status?: 'critical'
}) => (
  <div className="min-w-0 rounded-lg border border-border bg-card p-3">
    <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
    <div className="mt-1 flex items-end justify-between gap-2">
      <div className="flex min-w-0 items-baseline gap-1.5 text-xl font-semibold text-foreground">
        {status && <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ backgroundColor: 'var(--chart-critical)' }} aria-label="Errors occurred" />}
        {value == null ? '—' : formatNumber(value)}
        {value != null && unit && <span className="text-xs font-normal text-muted-foreground">{unit.trim()}</span>}
      </div>
    </div>
  </div>
)

function formatNumber(value: number) {
  if (value >= 100) return Math.round(value).toLocaleString()
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatChartValue(value: number) {
  if (value >= 100) return Math.round(value).toLocaleString()
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function HistoryDetail({ detail, onPin, onLabel, onExport, onReport, onDelete, exporting = null }: Props) {
  const telemetry = useMemo(() => {
    // Per-second windows: stored samples are thinned out, and per-sample
    // "instantaneous" rates spike to thousands when workers report together.
    const buckets = bucketBySecond(detail.samples.map((sample) => ({
      elapsed: sample.elapsed_ms / 1000,
      attempts: sample.attempts,
      errors: sample.errors + sample.rate_limited,
      latency: sample.latency_ms,
    })), false, 'spread')
    const latencyValues = detail.events.map((event) => event.latency_ms).filter((value): value is number => value != null)
    return {
      latency: buckets.map((bucket) => ({ t: bucket.second, v: bucket.latency })),
      throughput: buckets.map((bucket) => ({ t: bucket.second, v: bucket.rps })),
      latencyValues: latencyValues.length ? latencyValues : detail.samples.flatMap((sample) => sample.latency_ms == null ? [] : [sample.latency_ms]),
    }
  }, [detail.samples, detail.events])
  return (
    <div className="h-full overflow-y-auto p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span className="rounded bg-muted px-2 py-1 uppercase">{detail.mode}</span><span>{detail.status}</span></div>
          <h2 className="text-2xl font-bold tracking-tight">{detail.target_name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{detail.project_name} · {new Date(detail.started_at).toLocaleString()}</p>
          {detail.label && <p className="mt-2 inline-flex rounded-lg bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-600 dark:text-cyan-400">{detail.label}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPin} className="history-action">{detail.is_pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}{detail.is_pinned ? 'Unpin' : 'Pin'}</button>
          <button onClick={onLabel} className="history-action"><Tag className="h-3.5 w-3.5" /> Label</button>
          <button disabled={exporting != null} onClick={onExport} className="history-action disabled:cursor-wait disabled:opacity-60">{exporting === 'run' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {exporting === 'run' ? 'Preparing…' : 'Export JSON'}</button>
          <button disabled={exporting != null} onClick={() => onReport('html')} className="history-action disabled:cursor-wait disabled:opacity-60" title="Download a shareable executive HTML report">{exporting === 'report' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} HTML Report</button>
          <button disabled={exporting != null} onClick={() => onReport('pdf')} className="history-action disabled:cursor-wait disabled:opacity-60" title="Print or save report as PDF">{exporting === 'report' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5 text-cyan-500" />} PDF / Print</button>
          <button onClick={onDelete} className="history-action text-red-500"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="Attempts" value={detail.metrics.attempts} />
        <Metric label="Success" value={detail.metrics.success} />
        <Metric label="Errors" value={detail.metrics.errors} status={detail.metrics.errors > 0 ? 'critical' : undefined} />
        <Metric label="P50 latency" value={detail.metrics.p50_ms} unit=" ms" />
        <Metric label="P95 latency" value={detail.metrics.p95_ms} unit=" ms" />
        <Metric label="Avg requests / s" value={detail.metrics.average_rps} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <HistoryChart title="Latency over time" subtitle="Average response time per second" series={[{ label: 'Latency', color: 'var(--chart-series)', data: telemetry.latency }]} unit=" ms" format={formatChartValue} />
        <HistoryChart title="Throughput over time" subtitle="Requests completed per second" series={[{ label: 'Throughput', color: 'var(--chart-series)', data: telemetry.throughput }]} unit="/s" format={formatChartValue} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <OutcomeDistribution detail={detail} />
        <LatencyDistribution values={telemetry.latencyValues} p50={detail.metrics.p50_ms} p95={detail.metrics.p95_ms} />
      </div>

      {detail.steps.length > 0 && (
        <section className="mt-5 rounded-2xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Ordered steps</h3>
          <div className="mt-3 space-y-2">
            {detail.steps.map((step) => (
              <div key={step.sequence} className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-background text-[10px] font-bold">{step.sequence + 1}</span>
                <span className="rounded bg-background px-1.5 py-0.5 text-[10px] font-semibold">{step.method}</span>
                <span className="min-w-0 flex-1 truncate">{step.endpoint_name}</span>
                <span className="text-xs text-muted-foreground">{step.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

const OUTCOMES = [
  { key: 'success', label: 'Success', color: 'var(--chart-good)' },
  { key: 'rate_limited', label: 'Rate limited', color: 'var(--chart-warning)' },
  { key: 'errors', label: 'Errors', color: 'var(--chart-critical)' },
] as const

/** Part-to-whole as one stacked bar plus exact rows (a donut can't compare
 *  close shares, and a one-slice donut says nothing). */
function OutcomeDistribution({ detail }: { detail: Detail }) {
  const counts = { success: detail.metrics.success, rate_limited: detail.metrics.rate_limited, errors: detail.metrics.errors }
  const total = counts.success + counts.rate_limited + counts.errors
  const statusCounts = detail.events.reduce<Record<string, number>>((tally, event) => {
    const key = event.status_code == null ? event.outcome : String(event.status_code)
    tally[key] = (tally[key] ?? 0) + 1
    return tally
  }, {})
  const present = OUTCOMES.filter((outcome) => counts[outcome.key] > 0)

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Response outcomes</h3>
        <span className="text-xs text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{total.toLocaleString()}</span> responses</span>
      </div>
      <div className="mt-4 flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-muted" role="img" aria-label={OUTCOMES.map((outcome) => `${outcome.label}: ${counts[outcome.key]}`).join(', ')}>
        {present.map((outcome) => (
          <div key={outcome.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(counts[outcome.key] / Math.max(1, total)) * 100}%`, backgroundColor: outcome.color }} title={`${outcome.label}: ${counts[outcome.key].toLocaleString()}`} />
        ))}
      </div>
      <div className="mt-3 space-y-1.5 text-xs">
        {OUTCOMES.map((outcome) => (
          <div key={outcome.key} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: outcome.color }} aria-hidden="true" />
            <span className="text-muted-foreground">{outcome.label}</span>
            <span className="ml-auto tabular-nums text-foreground">{counts[outcome.key].toLocaleString()}</span>
            <span className="w-14 text-right tabular-nums text-muted-foreground">{total ? ((counts[outcome.key] / total) * 100).toFixed(1) : '0.0'}%</span>
          </div>
        ))}
      </div>
      {Object.keys(statusCounts).length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border/70 pt-3">
          <span className="mr-1 self-center text-[10px] text-muted-foreground">Status codes</span>
          {Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([status, count]) => <span key={status} className="rounded-md bg-muted px-2 py-1 text-[10px] tabular-nums">{status} <span className="text-muted-foreground">{count.toLocaleString()}</span></span>)}
        </div>
      ) : null}
    </section>
  )
}

function LatencyDistribution({ values, p50, p95 }: { values: number[]; p50?: number | null; p95?: number | null }) {
  const buckets = useMemo(() => buildHistogram(values, 16), [values])
  const peak = Math.max(...buckets.map((bucket) => bucket.count), 1)
  const min = buckets[0]?.start ?? 0
  const max = buckets.at(-1)?.end ?? 1
  const position = (value: number) => `${Math.min(100, Math.max(0, ((value - min) / Math.max(1, max - min)) * 100))}%`
  const markers = [p50 != null ? { label: 'p50', value: p50 } : null, p95 != null ? { label: 'p95', value: p95 } : null].filter(Boolean) as Array<{ label: string; value: number }>
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Latency distribution</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">How many responses took how long</p>
      <div className="relative mt-6 h-40 border-b border-border">
        {markers.map((marker) => (
          <div key={marker.label} className="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed border-muted-foreground/70" style={{ left: position(marker.value) }}>
            <span className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-muted-foreground">{marker.label} {Math.round(marker.value)} ms</span>
          </div>
        ))}
        <div className="flex h-full items-end">
          {buckets.map((bucket, index) => (
            <div key={`${bucket.start}-${index}`} className="group relative flex h-full min-w-0 flex-1 items-end justify-center px-[1px]" tabIndex={bucket.count ? 0 : -1} aria-label={`${Math.round(bucket.start)}–${Math.round(bucket.end)} ms: ${bucket.count} responses`}>
              {bucket.count > 0 && (
                <div className="w-full max-w-[24px] rounded-t transition-opacity group-hover:opacity-75 group-focus:opacity-75" style={{ height: `${Math.max(2, (bucket.count / peak) * 100)}%`, backgroundColor: 'var(--chart-series)' }} />
              )}
              <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[10px] shadow-lg group-hover:block group-focus:block">
                <span className="font-semibold tabular-nums">{bucket.count.toLocaleString()}</span> <span className="text-muted-foreground">responses · {Math.round(bucket.start)}–{Math.round(bucket.end)} ms</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{Math.round(min)} ms</span><span>{Math.round((min + max) / 2)} ms</span><span>{Math.round(max)} ms</span>
      </div>
    </section>
  )
}

function buildHistogram(values: number[], bucketCount: number) {
  const samples = values.filter(Number.isFinite)
  if (samples.length === 0) return Array.from({ length: bucketCount }, (_, index) => ({ start: index, end: index + 1, count: 0 }))
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const width = Math.max(1, (max - min) / bucketCount)
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({ start: min + index * width, end: min + (index + 1) * width, count: 0 }))
  for (const value of samples) buckets[Math.min(bucketCount - 1, Math.floor((value - min) / width))].count += 1
  return buckets
}
