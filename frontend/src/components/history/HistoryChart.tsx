import { useMemo, useState } from 'react'
import { Expand, Minimize2 } from 'lucide-react'


interface Series {
  label: string
  color: string
  points: Array<{ x: number; y: number }>
}

interface Props {
  title: string
  subtitle?: string
  series: Series[]
  unit?: string
}

const WIDTH = 1000
const HEIGHT = 260
const PAD_X = 28
const PAD_Y = 20

export function HistoryChart({ title, subtitle, series, unit = '' }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const chart = useMemo(() => buildChart(series), [series])
  const hoverX = hoverRatio == null ? null : PAD_X + hoverRatio * (WIDTH - PAD_X * 2)
  const hovered = hoverRatio == null ? [] : series.map((item) => ({
    ...item,
    point: nearestPoint(item.points, chart.minX + hoverRatio * (chart.maxX - chart.minX)),
  })).filter((item) => item.point != null)

  const content = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs hover:bg-muted"
          aria-label={expanded ? 'Collapse chart' : 'Expand chart'}
        >
          {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      <div className="relative min-h-[180px] flex-1 overflow-hidden rounded-xl border border-border/70 bg-gradient-to-b from-muted/25 to-background/30">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-full min-h-[160px] w-full cursor-crosshair"
          role="img"
          aria-label={`${title} chart`}
          onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect()
            setHoverRatio(Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)))
          }}
          onMouseLeave={() => setHoverRatio(null)}
        >
          <defs>
            {series.map((item, index) => (
              <linearGradient key={item.label} id={`history-fill-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={item.color} stopOpacity="0.2" />
                <stop offset="1" stopColor={item.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const y = PAD_Y + fraction * (HEIGHT - PAD_Y * 2)
            return <line key={fraction} x1={PAD_X} y1={y} x2={WIDTH - PAD_X} y2={y} className="stroke-border/60" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
          })}
          {chart.series.map((item, index) => item.path ? (
            <g key={item.label}>
              {chart.series.length === 1 ? <path d={`${item.path} L ${WIDTH - PAD_X} ${HEIGHT - PAD_Y} L ${PAD_X} ${HEIGHT - PAD_Y} Z`} fill={`url(#history-fill-${index})`} /> : null}
              <path d={item.path} fill="none" stroke={item.color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ) : null)}
          {hoverX != null ? <line x1={hoverX} y1={PAD_Y} x2={hoverX} y2={HEIGHT - PAD_Y} className="stroke-foreground/35" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" /> : null}
          {hovered.map((item) => item.point ? (
            <circle
              key={item.label}
              cx={scale(item.point.x, chart.minX, chart.maxX, PAD_X, WIDTH - PAD_X)}
              cy={scale(item.point.y, chart.minY, chart.maxY, HEIGHT - PAD_Y, PAD_Y)}
              r="4"
              fill="hsl(var(--background))"
              stroke={item.color}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ) : null)}
        </svg>

        <div className="pointer-events-none absolute inset-y-3 left-2 flex flex-col justify-between font-mono text-[9px] text-muted-foreground/75">
          <span>{formatValue(chart.maxY, unit)}</span>
          <span>{formatValue((chart.maxY + chart.minY) / 2, unit)}</span>
          <span>{formatValue(chart.minY, unit)}</span>
        </div>
        <div className="pointer-events-none absolute inset-x-7 bottom-1 flex justify-between font-mono text-[9px] text-muted-foreground/70">
          <span>{formatElapsed(chart.minX)}</span><span>{formatElapsed(chart.maxX)}</span>
        </div>

        {hoverX != null && hovered.length > 0 ? (
          <div
            className="pointer-events-none absolute top-3 z-10 min-w-[170px] rounded-lg border border-border bg-popover/95 p-2.5 text-[10px] shadow-xl backdrop-blur"
            style={{ left: `${Math.min(76, Math.max(4, hoverRatio! * 100))}%`, transform: hoverRatio! > 0.58 ? 'translateX(-100%)' : undefined }}
          >
            <div className="mb-1.5 border-b border-border/60 pb-1.5 font-mono text-muted-foreground">{formatElapsed(chart.minX + hoverRatio! * (chart.maxX - chart.minX))}</div>
            {hovered.map((item) => item.point ? (
              <div key={item.label} className="flex items-center gap-2 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-muted-foreground">{item.label}</span>
                <span className="ml-auto font-mono font-medium">{formatValue(item.point.y, unit)}</span>
              </div>
            ) : null)}
          </div>
        ) : null}

        {series.every((item) => item.points.length < 2) ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Not enough samples yet</div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}{unit ? ` (${unit})` : ''}
          </span>
        ))}
        <span className="ml-auto hidden font-mono text-[10px] sm:inline">shared scale</span>
      </div>
    </div>
  )

  if (expanded) {
    return (
      <div className="fixed inset-0 z-[80] bg-background/95 p-5 backdrop-blur md:p-10">
        <div className="mx-auto h-full max-w-7xl rounded-2xl border border-border bg-card p-5 shadow-2xl md:p-8">{content}</div>
      </div>
    )
  }
  return <div className="h-[320px] rounded-2xl border border-border bg-card p-4">{content}</div>
}

function buildChart(series: Series[]) {
  const all = series.flatMap((item) => item.points).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  const xs = all.map((point) => point.x)
  const ys = all.map((point) => point.y)
  const minX = Math.min(...xs, 0)
  const maxX = Math.max(...xs, 1)
  const rawMinY = Math.min(...ys, 0)
  const rawMaxY = Math.max(...ys, 1)
  const padding = Math.max(1, (rawMaxY - rawMinY) * 0.08)
  const minY = Math.max(0, rawMinY - padding)
  const maxY = rawMaxY + padding
  return {
    minX, maxX, minY, maxY,
    series: series.map((item) => ({
      ...item,
      path: smoothPath(item.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)).map((point) => ({
        x: scale(point.x, minX, maxX, PAD_X, WIDTH - PAD_X),
        y: scale(point.y, minY, maxY, HEIGHT - PAD_Y, PAD_Y),
      }))),
    })),
  }
}

function scale(value: number, min: number, max: number, outMin: number, outMax: number) {
  return outMin + ((value - min) / (max - min || 1)) * (outMax - outMin)
}

function nearestPoint(points: Array<{ x: number; y: number }>, target: number) {
  let nearest: { x: number; y: number } | null = null
  let distance = Number.POSITIVE_INFINITY
  for (const point of points) {
    const nextDistance = Math.abs(point.x - target)
    if (nextDistance < distance) { nearest = point; distance = nextDistance }
  }
  return nearest
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return ''
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]
    const midpoint = (previous.x + point.x) / 2
    return `${path} C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`
  }, `M ${points[0].x} ${points[0].y}`)
}

function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, milliseconds / 1000)
  return seconds < 60 ? `${seconds.toFixed(seconds < 10 ? 1 : 0)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
}

function formatValue(value: number, unit: string) {
  const number = value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1)
  return unit ? `${number}${unit}` : number
}
