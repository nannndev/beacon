import { useMemo } from 'react'
import { Download, FileText, Loader2, Pin, PinOff, Tag, Trash2 } from 'lucide-react'

import type { HistoryDetail as Detail } from '../../types/history'
import { HistoryChart } from './HistoryChart'


interface Props {
  detail: Detail
  onPin: () => void
  onLabel: () => void
  onExport: () => void
  onReport: (format?: 'html' | 'md') => void
  onDelete: () => void
  exporting?: 'run' | 'report' | null
}

const Metric = ({ label, value, unit = '', series, color }: { label: string; value: number | null | undefined; unit?: string; series: number[]; color: string }) => (
  <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-card via-card to-muted/20 p-3">
    <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:radial-gradient(circle_at_center,currentColor_0.7px,transparent_0.8px)] [background-size:7px_7px]" />
    <div className="relative text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{label}</div>
    <div className="relative mt-1 flex items-end justify-between gap-2">
      <div className="font-mono text-xl font-semibold tabular-nums">{value == null ? '—' : `${Number(value).toFixed(value % 1 ? 1 : 0)}${unit}`}</div>
      <MiniTrend values={series} color={color} />
    </div>
  </div>
)

export function HistoryDetail({ detail, onPin, onLabel, onExport, onReport, onDelete, exporting = null }: Props) {
  const telemetry = useMemo(() => {
    const latency = detail.samples.flatMap((sample) => sample.latency_ms == null ? [] : [{ x: sample.elapsed_ms, y: sample.latency_ms }])
    const throughput = detail.samples.map((sample) => ({ x: sample.elapsed_ms, y: sample.instantaneous_rps }))
    return {
      latency,
      throughput,
      latencyValues: latency.map((point) => point.y),
      throughputValues: throughput.map((point) => point.y),
      attemptsValues: detail.samples.map((sample) => sample.attempts),
      successValues: detail.samples.map((sample) => sample.success),
      errorValues: detail.samples.map((sample) => sample.errors + sample.rate_limited),
    }
  }, [detail.samples])
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
          <button disabled={exporting != null} onClick={onExport} className="history-action disabled:cursor-wait disabled:opacity-60">{exporting === 'run' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {exporting === 'run' ? 'Preparing…' : 'Export'}</button>
          <button disabled={exporting != null} onClick={() => onReport('html')} className="history-action disabled:cursor-wait disabled:opacity-60" title="Download a shareable HTML report">{exporting === 'report' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} {exporting === 'report' ? 'Preparing…' : 'Report'}</button>
          <button onClick={onDelete} className="history-action text-red-500"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="Attempts" value={detail.metrics.attempts} series={telemetry.attemptsValues} color="#60a5fa" />
        <Metric label="Success" value={detail.metrics.success} series={telemetry.successValues} color="#34d399" />
        <Metric label="Errors" value={detail.metrics.errors} series={telemetry.errorValues} color="#ef5b4f" />
        <Metric label="P50" value={detail.metrics.p50_ms} unit="ms" series={telemetry.latencyValues} color="#22d3ee" />
        <Metric label="P95" value={detail.metrics.p95_ms} unit="ms" series={telemetry.latencyValues} color="#f59e0b" />
        <Metric label="Avg RPS" value={detail.metrics.average_rps} series={telemetry.throughputValues} color="#a78bfa" />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <HistoryChart title="Latency over time" subtitle="Response timing across retained samples" series={[{ label: 'Latency', color: '#22d3ee', points: telemetry.latency }]} unit="ms" />
        <HistoryChart title="Throughput over time" subtitle="Instantaneous requests per second" series={[{ label: 'Throughput', color: '#34d399', points: telemetry.throughput }]} unit="rps" />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <OutcomeDistribution detail={detail} />
        <LatencyDistribution values={telemetry.latencyValues} />
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

function MiniTrend({ values, color }: { values: number[]; color: string }) {
  const recent = values.filter(Number.isFinite).slice(-28)
  if (recent.length < 2) return <span className="h-7 w-14 rounded bg-muted/30" />
  const min = Math.min(...recent)
  const max = Math.max(...recent)
  const span = Math.max(1, max - min)
  const coordinates = recent.map((value, index) => ({ x: (index / (recent.length - 1)) * 56, y: 25 - ((value - min) / span) * 20 }))
  const latest = coordinates.at(-1)!
  return (
    <svg viewBox="0 0 56 28" className="h-7 w-14 shrink-0 overflow-visible" aria-hidden="true">
      <polyline points={coordinates.map(({ x, y }) => `${x},${y}`).join(' ')} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={latest.x} cy={latest.y} r="1.8" fill={color} />
    </svg>
  )
}

function OutcomeDistribution({ detail }: { detail: Detail }) {
  const success = detail.metrics.success
  const rateLimited = detail.metrics.rate_limited
  const errors = detail.metrics.errors
  const total = Math.max(1, success + rateLimited + errors)
  const successEnd = (success / total) * 100
  const rateEnd = successEnd + (rateLimited / total) * 100
  const statusCounts = detail.events.reduce<Record<string, number>>((counts, event) => {
    const key = event.status_code == null ? event.outcome : String(event.status_code)
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Response outcomes</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Final result mix across the run</p>
      <div className="mt-5 flex items-center gap-5">
        <div className="relative h-32 w-32 shrink-0 rounded-full" style={{ background: `conic-gradient(#34d399 0 ${successEnd}%, #f59e0b ${successEnd}% ${rateEnd}%, #ef5b4f ${rateEnd}% 100%)` }}>
          <div className="absolute inset-[14px] grid place-items-center rounded-full bg-card text-center">
            <div><div className="font-mono text-xl font-semibold">{total}</div><div className="text-[9px] uppercase tracking-wider text-muted-foreground">responses</div></div>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2 text-xs">
          <OutcomeRow label="Success" value={success} total={total} color="#34d399" />
          <OutcomeRow label="Rate limited" value={rateLimited} total={total} color="#f59e0b" />
          <OutcomeRow label="Errors" value={errors} total={total} color="#ef5b4f" />
        </div>
      </div>
      {Object.keys(statusCounts).length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border/70 pt-3">
          {Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([status, count]) => <span key={status} className="rounded-md bg-muted px-2 py-1 font-mono text-[10px]">{status} <span className="text-muted-foreground">{count}</span></span>)}
        </div>
      ) : null}
    </section>
  )
}

function OutcomeRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} /><span className="text-muted-foreground">{label}</span><span className="ml-auto font-mono">{((value / total) * 100).toFixed(1)}%</span><span className="w-8 text-right font-mono text-muted-foreground">{value}</span></div>
}

function LatencyDistribution({ values }: { values: number[] }) {
  const buckets = useMemo(() => buildHistogram(values, 12), [values])
  const peak = Math.max(...buckets.map((bucket) => bucket.count), 1)
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Latency distribution</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Retained samples grouped from fastest to slowest</p>
      <div className="mt-5 flex h-36 items-end gap-1.5 border-b border-border px-1">
        {buckets.map((bucket, index) => (
          <div key={`${bucket.start}-${index}`} className="group relative flex h-full min-w-0 flex-1 items-end">
            <div className="w-full rounded-t-sm bg-gradient-to-t from-cyan-600 to-cyan-300 transition-opacity group-hover:opacity-75" style={{ height: `${Math.max(3, (bucket.count / peak) * 100)}%` }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 font-mono text-[9px] shadow-lg group-hover:block">{Math.round(bucket.start)}-{Math.round(bucket.end)}ms: {bucket.count}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[9px] text-muted-foreground"><span>{Math.round(buckets[0]?.start ?? 0)}ms</span><span>{Math.round(buckets.at(-1)?.end ?? 0)}ms</span></div>
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
