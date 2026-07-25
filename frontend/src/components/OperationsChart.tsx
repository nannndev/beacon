import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, BarChart3, Maximize2, Minimize2 } from 'lucide-react'

import { Button } from './ui/button'
import type { ChartPoint } from './liveMonitorMetrics'

interface Props {
  points: ChartPoint[]
  p95: number | null
  expanded: boolean
  onToggleExpanded: () => void
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

const WIDTH = 420
const HEIGHT = 150
const PAD = 12

export function OperationsChart({ points, p95, expanded, onToggleExpanded }: Props) {
  const [range, setRange] = useState<RangeSeconds>(300)
  const [tab, setTab] = useState<'charts' | 'errors'>('charts')
  const [focusedMetric, setFocusedMetric] = useState<MetricKey | null>(null)
  const visible = useMemo(() => {
    const latest = points[points.length - 1]?.elapsed ?? 0
    return points.filter((point) => point.elapsed >= latest - range)
  }, [points, range])
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
          <div className="flex rounded-md border border-border bg-background/40 p-0.5" aria-label="Chart time range">
            {ranges.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setRange(item.value)}
                className={`rounded px-2 py-1 text-[10px] transition-colors ${range === item.value ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300' : 'text-muted-foreground hover:text-foreground'}`}
                aria-pressed={range === item.value}
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
          {(!focusedMetric || focusedMetric === 'rps') && <MetricChart title="Requests per second" points={visible} metric="rps" suffix="/s" color="cyan" focused={focusedMetric === 'rps'} onFocus={() => focusChart(focusedMetric === 'rps' ? null : 'rps')} />}
          {(!focusedMetric || focusedMetric === 'latency') && <MetricChart title="Response time" points={visible} metric="latency" suffix="ms" color="emerald" reference={p95} focused={focusedMetric === 'latency'} onFocus={() => focusChart(focusedMetric === 'latency' ? null : 'latency')} />}
          {(!focusedMetric || focusedMetric === 'errorRate') && <MetricChart title="Error rate" points={visible} metric="errorRate" suffix="%" color="red" focused={focusedMetric === 'errorRate'} onFocus={() => focusChart(focusedMetric === 'errorRate' ? null : 'errorRate')} />}
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

function MetricChart({ title, points, metric, suffix, color, reference, focused, onFocus }: {
  title: string
  points: ChartPoint[]
  metric: MetricKey
  suffix: string
  color: 'cyan' | 'emerald' | 'red'
  reference?: number | null
  focused: boolean
  onFocus: () => void
}) {
  const values = points.map((point) => point[metric])
  const max = Math.max(...values, reference ?? 0, metric === 'errorRate' ? 1 : 0, 1)
  const path = points.map((point, index) => {
    const x = points.length <= 1 ? WIDTH / 2 : (index / (points.length - 1)) * WIDTH
    const y = PAD + (HEIGHT - PAD * 2) * (1 - point[metric] / max)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const area = path ? `0,${HEIGHT - PAD} ${path} ${WIDTH},${HEIGHT - PAD}` : ''
  const current = values[values.length - 1] ?? 0
  const peak = Math.max(...values, 0)
  const stroke = color === 'red' ? '#ef5b4f' : color === 'emerald' ? '#35d399' : '#22d3ee'

  return (
    <div className="min-w-0 rounded-lg border border-border/80 bg-background/35 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium">{title}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Peak {formatValue(peak)}{suffix}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: stroke }}>{formatValue(current)}<small className="ml-0.5 text-[9px] font-normal text-muted-foreground">{suffix}</small></span>
          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" onClick={onFocus} aria-label={focused ? `Collapse ${title}` : `Expand ${title}`} title={focused ? 'Show all charts' : `Focus ${title}`}>
            {focused ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
      <div className={`relative transition-[height] duration-200 ${focused ? 'h-[300px] md:h-[420px]' : 'h-[124px]'} ${points.length < 2 ? 'grid place-items-center' : ''}`}>
        {points.length < 2 ? (
          <span className="text-[10px] text-muted-foreground">Waiting for live samples</span>
        ) : (
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={`${title} trend`}>
            <defs>
              <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={stroke} stopOpacity="0.25" />
                <stop offset="1" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75, 1].map((fraction) => <line key={fraction} x1="0" y1={PAD + (HEIGHT - PAD * 2) * fraction} x2={WIDTH} y2={PAD + (HEIGHT - PAD * 2) * fraction} className="stroke-border/60" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
            {reference != null && <line x1="0" y1={PAD + (HEIGHT - PAD * 2) * (1 - reference / max)} x2={WIDTH} y2={PAD + (HEIGHT - PAD * 2) * (1 - reference / max)} className="stroke-amber-500/60" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
            <polygon points={area} fill={`url(#fill-${metric})`} />
            <polyline points={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
        <span>{points[0] ? formatElapsed(points[0].elapsed) : '00:00'}</span>
        {reference != null && <span className="text-amber-500">P95 {Math.round(reference)}ms</span>}
        <span>{points.at(-1) ? formatElapsed(points.at(-1)!.elapsed) : '00:00'}</span>
      </div>
    </div>
  )
}

function formatValue(value: number) {
  return value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1)
}

function formatElapsed(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}
