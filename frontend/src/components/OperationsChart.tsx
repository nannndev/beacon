import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, BarChart3, Maximize2, Minimize2, Pause, Play } from 'lucide-react'

import { Button } from './ui/button'
import { TimeSeriesChart, type TimePoint } from './charts/TimeSeriesChart'
import { bucketBySecond, type SecondBucket } from '../lib/chartMath'
import type { ChartPoint } from './liveMonitorMetrics'

interface Props {
  points: ChartPoint[]
  p95: number | null
  expanded: boolean
  onToggleExpanded: () => void
  /** While the run is live, the still-filling current second is not drawn. */
  live?: boolean
}

type RangeSeconds = 60 | 300 | 900 | 1800 | 3600
type MetricKey = 'rps' | 'latency' | 'errorRate'

const ranges: Array<{ label: string; value: RangeSeconds }> = [
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
  { label: '15m', value: 900 },
  { label: '30m', value: 1800 },
  { label: '1h', value: 3600 },
]

export function OperationsChart({ points, p95, expanded, onToggleExpanded, live = false }: Props) {
  const [range, setRange] = useState<RangeSeconds>(300)
  const [tab, setTab] = useState<'charts' | 'errors'>('charts')
  const [focusedMetric, setFocusedMetric] = useState<MetricKey | null>(null)
  const [pausedPoints, setPausedPoints] = useState<ChartPoint[] | null>(null)
  const displayedPoints = pausedPoints ?? points
  const visible = useMemo(() => {
    const latest = displayedPoints[displayedPoints.length - 1]?.elapsed ?? 0
    return displayedPoints.filter((point) => point.elapsed >= latest - range)
  }, [displayedPoints, range])
  // Charts plot one-second windows: per-update rates swing wildly because
  // stats arrive per response.
  const buckets = useMemo(() => bucketBySecond(
    visible.map((point) => ({ elapsed: point.elapsed, attempts: point.attempt, errors: point.errorCount, latency: point.latency })),
    live && !pausedPoints,
  ), [visible, live, pausedPoints])
  const availableSeconds = Math.max(0, (displayedPoints.at(-1)?.elapsed ?? 0) - (displayedPoints[0]?.elapsed ?? 0))
  const clipped = displayedPoints.length > visible.length
  const errorSamples = visible.filter((point, index) => point.errorCount > (visible[index - 1]?.errorCount ?? 0))
  const focusChart = (metric: MetricKey | null) => {
    if ((focusedMetric == null) !== (metric == null)) onToggleExpanded()
    setFocusedMetric(metric)
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-muted/15">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex items-center gap-1">
          <DashboardTab active={tab === 'charts'} onClick={() => setTab('charts')}>
            <BarChart3 className="h-3.5 w-3.5" /> Charts
          </DashboardTab>
          {focusedMetric && (
            <span className="ml-2 hidden items-center gap-2 text-[10px] text-muted-foreground sm:flex">
              <span className="h-3 w-px bg-border" /> Focus mode
            </span>
          )}
          <DashboardTab active={tab === 'errors'} onClick={() => setTab('errors')}>
            <AlertTriangle className="h-3.5 w-3.5" /> Errors
            {errorSamples.length > 0 && <span className="text-red-500">{errorSamples.length}</span>}
          </DashboardTab>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={`h-7 gap-1.5 px-2 text-[10px] ${pausedPoints ? 'text-amber-500' : 'text-muted-foreground'}`}
            onClick={() => setPausedPoints((snapshot) => snapshot ? null : [...points])}
            aria-label={pausedPoints ? 'Resume live chart' : 'Pause live chart'}
            title={pausedPoints ? 'Resume incoming chart samples' : 'Freeze the chart while the test keeps running'}
          >
            {pausedPoints ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {pausedPoints ? 'Resume' : 'Pause'}
          </Button>
          <span className="hidden text-[10px] text-muted-foreground lg:inline">
            {pausedPoints && <span className="mr-1 text-amber-500">Frozen ·</span>}
            {clipped ? `Last ${formatRange(range)}` : `${formatDuration(availableSeconds)} captured`} · per-second view
          </span>
          <div className="flex rounded-md border border-border bg-background/40 p-0.5" aria-label="Chart time range">
            {ranges.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setRange(item.value)}
                className={`rounded px-2 py-1 text-[10px] transition-colors ${range === item.value ? 'bg-cyan-500/15 text-cyan-600 shadow-sm ring-1 ring-cyan-500/15 dark:text-cyan-300' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}
                aria-pressed={range === item.value}
                title={availableSeconds < item.value ? `Run has ${formatDuration(availableSeconds)} of data; this window currently shows all samples` : `Show the last ${formatRange(item.value)}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {focusedMetric && (
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[10px]" onClick={() => focusChart(null)} aria-label="Show all charts">
              <Minimize2 className="h-3.5 w-3.5" /> Show all
            </Button>
          )}
        </div>
      </div>

      {tab === 'charts' ? (
        <div className={`grid grid-cols-1 gap-2 p-2 ${focusedMetric ? '' : 'md:grid-cols-3'}`}>
          {(['rps', 'latency', 'errorRate'] as const)
            .filter((metric) => !focusedMetric || focusedMetric === metric)
            .map((metric) => (
              <MetricChart
                key={metric}
                metric={metric}
                buckets={buckets}
                p95={metric === 'latency' ? p95 : null}
                focused={focusedMetric === metric}
                onFocus={() => focusChart(focusedMetric === metric ? null : metric)}
              />
            ))}
        </div>
      ) : (
        <div className={`p-3 ${expanded ? 'min-h-[360px]' : 'min-h-[196px]'}`}>
          {errorSamples.length === 0 ? (
            <div className="flex h-full min-h-[170px] flex-col items-center justify-center rounded-lg border border-dashed border-border text-center">
              <div className="mb-2 grid h-9 w-9 place-items-center rounded-full bg-emerald-500/10 text-emerald-500">✓</div>
              <p className="text-xs font-medium">No errors in this range</p>
              <p className="mt-1 text-[10px] text-muted-foreground">All sampled requests completed without errors.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {errorSamples.slice().reverse().slice(0, 20).map((point) => (
                <div key={`${point.attempt}-${point.elapsed}`} className="flex items-center gap-3 rounded-lg border border-red-500/15 bg-red-500/5 px-3 py-2 text-xs">
                  <span className="font-mono text-muted-foreground">#{point.attempt}</span>
                  <span className="text-red-500">Request error · rate {point.errorRate.toFixed(1)}%</span>
                  <span className="ml-auto font-mono text-muted-foreground">{formatElapsed(point.elapsed)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function DashboardTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors ${active ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-300' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}>
      {children}
    </button>
  )
}

const METRICS: Record<MetricKey, { title: string; unit: string; empty: string }> = {
  rps: { title: 'Requests per second', unit: '/s', empty: 'Waiting for live samples' },
  latency: { title: 'Response time', unit: ' ms', empty: 'Waiting for live samples' },
  errorRate: { title: 'Error rate', unit: '%', empty: 'Waiting for live samples' },
}

function metricValue(bucket: SecondBucket, metric: MetricKey): number | null {
  return metric === 'rps' ? bucket.rps : metric === 'latency' ? bucket.latency : bucket.errorRate
}

function MetricChart({ metric, buckets, p95, focused, onFocus }: {
  metric: MetricKey
  buckets: SecondBucket[]
  p95: number | null
  focused: boolean
  onFocus: () => void
}) {
  const { title, unit, empty } = METRICS[metric]
  const data: TimePoint[] = buckets.map((bucket) => ({ t: bucket.second, v: metricValue(bucket, metric) }))
  const values = data.map((point) => point.v).filter((value): value is number => value != null)
  const current = [...data].reverse().find((point) => point.v != null)?.v ?? null
  const peak = values.length ? Math.max(...values) : null
  const noErrors = metric === 'errorRate' && values.every((value) => value === 0)
  const height = focused ? 380 : 150
  const domain: [number, number] | undefined = buckets.length
    ? [buckets[0].second, Math.max(buckets[0].second + 1, buckets[buckets.length - 1].second)]
    : undefined

  return (
    <div className="group min-w-0 rounded-lg border border-border/70 bg-card p-3 transition-colors hover:border-border">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
          <p className="mt-0.5 text-lg font-semibold leading-tight text-foreground">
            {current == null ? '—' : formatValue(current)}
            {current != null && <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">{unit.trim()}</span>}
          </p>
          {peak != null && !noErrors && (
            <p className="text-[10px] text-muted-foreground">Peak {formatValue(peak)}{unit}</p>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" onClick={onFocus} aria-label={focused ? `Collapse ${title}` : `Expand ${title}`} title={focused ? 'Show all charts' : `Focus ${title}`}>
          {focused ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {buckets.length < 2 ? (
        <div className="grid place-items-center text-[10px] text-muted-foreground" style={{ height }}>{empty}</div>
      ) : noErrors ? (
        // A flat red line at zero reads as a problem; say what it means instead.
        <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-center" style={{ height }}>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--chart-good)' }} aria-hidden="true" />
            No errors
          </span>
          <span className="text-[10px] text-muted-foreground">Every request in this window succeeded.</span>
        </div>
      ) : (
        <TimeSeriesChart
          data={data}
          domain={domain}
          unit={unit}
          format={formatValue}
          label={title}
          height={height}
          color={metric === 'errorRate' ? 'var(--chart-critical)' : 'var(--chart-series)'}
          minMax={metric === 'errorRate' ? 1 : 0}
          reference={p95 != null ? { value: p95, label: `p95 ${Math.round(p95)} ms` } : null}
          details={(index) => <BucketDetails bucket={buckets[index]} exclude={metric} />}
        />
      )}
    </div>
  )
}

/** The other metrics at the hovered second, so one hover reads all three. */
function BucketDetails({ bucket, exclude }: { bucket: SecondBucket; exclude: MetricKey }) {
  if (!bucket) return null
  const rows = (Object.keys(METRICS) as MetricKey[])
    .filter((metric) => metric !== exclude)
    .map((metric) => {
      const value = metricValue(bucket, metric)
      return [METRICS[metric].title, value == null ? '—' : `${formatValue(value)}${METRICS[metric].unit}`] as const
    })
  return (
    <div className="mt-1.5 space-y-0.5 border-t border-border/60 pt-1.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 text-muted-foreground">
          <span>{label}</span>
          <span className="tabular-nums text-foreground">{value}</span>
        </div>
      ))}
    </div>
  )
}

function formatValue(value: number) {
  if (value >= 100) return Math.round(value).toLocaleString()
  if (value >= 10 || Number.isInteger(value)) return String(Math.round(value * 10) / 10)
  return value.toFixed(1)
}

function formatElapsed(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

function formatRange(seconds: RangeSeconds) {
  return seconds === 3600 ? '1 hour' : `${seconds / 60} min`
}

function formatDuration(seconds: number) {
  if (seconds < 1) return 'Starting'
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`
}
