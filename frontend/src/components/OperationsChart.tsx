import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, BarChart3, Maximize2, Minimize2, Pause, Play } from 'lucide-react'

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
  const [pausedPoints, setPausedPoints] = useState<ChartPoint[] | null>(null)
  const displayedPoints = pausedPoints ?? points
  const visible = useMemo(() => {
    const latest = displayedPoints[displayedPoints.length - 1]?.elapsed ?? 0
    return displayedPoints.filter((point) => point.elapsed >= latest - range)
  }, [displayedPoints, range])
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
            {clipped ? `Last ${formatRange(range)}` : `${formatDuration(availableSeconds)} captured`} · {visible.length} samples
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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const values = points.map((point) => point[metric])
  const max = Math.max(...values, reference ?? 0, metric === 'errorRate' ? 1 : 0, 1)
  const coordinates = points.map((point, index) => {
    const x = points.length <= 1 ? WIDTH / 2 : (index / (points.length - 1)) * WIDTH
    const y = PAD + (HEIGHT - PAD * 2) * (1 - point[metric] / max)
    return { x, y }
  })
  const path = smoothPath(coordinates)
  const area = path ? `${path} L ${WIDTH} ${HEIGHT - PAD} L 0 ${HEIGHT - PAD} Z` : ''
  const current = values[values.length - 1] ?? 0
  const peak = Math.max(...values, 0)
  const stroke = color === 'red' ? '#ef5b4f' : color === 'emerald' ? '#35d399' : '#22d3ee'
  const hovered = hoveredIndex == null ? null : points[hoveredIndex]
  const hoveredCoordinate = hoveredIndex == null ? null : coordinates[hoveredIndex]
  const markers = coordinates.flatMap((coordinate, index) => {
    const point = points[index]
    const previousErrors = points[index - 1]?.errorCount ?? 0
    if (point.errorCount > previousErrors) return [{ ...coordinate, tone: '#ef5b4f', label: 'Error recorded' }]
    if (metric === 'latency' && reference != null && point.latency >= reference) return [{ ...coordinate, tone: '#f59e0b', label: 'P95 latency breach' }]
    return []
  })

  const inspectPoint = (clientX: number, bounds: DOMRect) => {
    if (points.length === 0) return
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width))
    setHoveredIndex(Math.round(ratio * (points.length - 1)))
  }

  return (
    <div className="group min-w-0 rounded-xl border border-border/70 bg-gradient-to-b from-background/70 to-background/30 p-3 shadow-[inset_0_1px_0_hsl(var(--border)/0.25)] transition-colors hover:border-border">
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
          <>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="h-full w-full cursor-crosshair"
            role="img"
            aria-label={`${title} trend`}
            onMouseMove={(event) => inspectPoint(event.clientX, event.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <defs>
              <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={stroke} stopOpacity="0.25" />
                <stop offset="1" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75, 1].map((fraction) => <line key={fraction} x1="0" y1={PAD + (HEIGHT - PAD * 2) * fraction} x2={WIDTH} y2={PAD + (HEIGHT - PAD * 2) * fraction} className="stroke-border/60" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
            {reference != null && <line x1="0" y1={PAD + (HEIGHT - PAD * 2) * (1 - reference / max)} x2={WIDTH} y2={PAD + (HEIGHT - PAD * 2) * (1 - reference / max)} className="stroke-amber-500/60" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
            <path d={area} fill={`url(#fill-${metric})`} />
            <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {markers.map((marker, index) => (
              <g key={`${marker.label}-${index}`}>
                <line x1={marker.x} y1={PAD} x2={marker.x} y2={HEIGHT - PAD} stroke={marker.tone} strokeOpacity="0.18" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
                <circle cx={marker.x} cy={marker.y} r="3" fill={marker.tone} stroke="hsl(var(--background))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </g>
            ))}
            {coordinates.at(-1) && (
              <>
                <circle cx={coordinates.at(-1)!.x} cy={coordinates.at(-1)!.y} r="5" fill={stroke} opacity="0.14" />
                <circle cx={coordinates.at(-1)!.x} cy={coordinates.at(-1)!.y} r="2.5" fill={stroke} />
              </>
            )}
            {hoveredCoordinate && (
              <g>
                <line x1={hoveredCoordinate.x} y1="0" x2={hoveredCoordinate.x} y2={HEIGHT} stroke="hsl(var(--foreground))" strokeOpacity="0.32" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                <circle cx={hoveredCoordinate.x} cy={hoveredCoordinate.y} r="4" fill="hsl(var(--background))" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </g>
            )}
          </svg>
          <div className="pointer-events-none absolute inset-y-1 left-1 flex flex-col justify-between font-mono text-[8px] text-muted-foreground/70">
            <span>{formatValue(max)}</span><span>{formatValue(max / 2)}</span><span>0</span>
          </div>
          {hovered && hoveredCoordinate && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-[152px] rounded-lg border border-border bg-popover/95 p-2.5 text-[10px] shadow-xl backdrop-blur-md"
              style={{ left: `${Math.min(72, Math.max(2, (hoveredCoordinate.x / WIDTH) * 100))}%`, transform: hoveredCoordinate.x > WIDTH * 0.58 ? 'translateX(-100%)' : undefined }}
            >
              <div className="mb-2 flex items-center justify-between gap-3 border-b border-border/60 pb-1.5 font-mono text-muted-foreground">
                <span>{formatElapsed(hovered.elapsed)}</span><span>#{hovered.attempt}</span>
              </div>
              <TooltipRow label="RPS" value={hovered.rps.toFixed(1)} tone="#22d3ee" />
              <TooltipRow label="Latency" value={`${Math.round(hovered.latency)}ms`} tone="#35d399" />
              <TooltipRow label="Error rate" value={`${hovered.errorRate.toFixed(1)}%`} tone="#ef5b4f" />
            </div>
          )}
          </>
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

function TooltipRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-mono font-medium text-foreground">{value}</span>
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

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]
    const midpoint = (previous.x + point.x) / 2
    return `${path} C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`
  }, `M ${points[0].x} ${points[0].y}`)
}
