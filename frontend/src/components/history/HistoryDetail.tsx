import { Download, Pin, PinOff, Tag, Trash2 } from 'lucide-react'

import type { HistoryDetail as Detail } from '../../types/history'
import { HistoryChart } from './HistoryChart'


interface Props {
  detail: Detail
  onPin: () => void
  onLabel: () => void
  onExport: () => void
  onDelete: () => void
}

const Metric = ({ label, value, unit = '' }: { label: string; value: number | null | undefined; unit?: string }) => (
  <div className="rounded-xl border border-border bg-card p-3">
    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className="mt-1 text-xl font-bold tabular-nums">{value == null ? '—' : `${Number(value).toFixed(value % 1 ? 1 : 0)}${unit}`}</div>
  </div>
)

export function HistoryDetail({ detail, onPin, onLabel, onExport, onDelete }: Props) {
  const latency = detail.samples.filter((sample) => sample.latency_ms != null).map((sample) => ({ x: sample.elapsed_ms, y: sample.latency_ms! }))
  const throughput = detail.samples.map((sample) => ({ x: sample.elapsed_ms, y: sample.instantaneous_rps }))
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
          <button onClick={onExport} className="history-action"><Download className="h-3.5 w-3.5" /> Export</button>
          <button onClick={onDelete} className="history-action text-red-500"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="Attempts" value={detail.metrics.attempts} />
        <Metric label="Success" value={detail.metrics.success} />
        <Metric label="Errors" value={detail.metrics.errors} />
        <Metric label="P50" value={detail.metrics.p50_ms} unit=" ms" />
        <Metric label="P95" value={detail.metrics.p95_ms} unit=" ms" />
        <Metric label="Avg RPS" value={detail.metrics.average_rps} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <HistoryChart title="Latency over time" subtitle="Response timing across retained samples" series={[{ label: 'Latency', color: '#22d3ee', points: latency }]} unit="ms" />
        <HistoryChart title="Throughput over time" subtitle="Instantaneous requests per second" series={[{ label: 'Throughput', color: '#34d399', points: throughput }]} unit="rps" />
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
