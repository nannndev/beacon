import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { formatClock, monotonePath, niceTicks, timeTicks } from '../../lib/chartMath'

export interface TimePoint {
  /** Seconds since the run started. */
  t: number
  /** null leaves a gap (no data for that moment). */
  v: number | null
}

export interface TimeSeries {
  label: string
  color: string
  data: TimePoint[]
}

interface Props {
  /** A single series; use `series` for several on the same scale. */
  data?: TimePoint[]
  series?: TimeSeries[]
  /** Visible time window in seconds; defaults to the data's extent. */
  domain?: [number, number]
  /** Short unit shown on the y-axis ticks, e.g. "/s", "ms", "%". */
  unit: string
  format: (value: number) => string
  /** Accessible name, e.g. "Requests per second". */
  label: string
  height: number
  color?: string
  /** A horizontal reference such as p95 latency, drawn as a labeled hairline. */
  reference?: { value: number; label: string } | null
  /** The y-axis always reaches at least this value (e.g. 1% for error rate). */
  minMax?: number
  /** Extra rows for the tooltip at a data index (other metrics at that time). */
  details?: (index: number) => ReactNode
}

const MARGIN = { top: 10, right: 10, bottom: 20, left: 44 }

/**
 * One-series time chart drawn in real pixels (measured, never stretched), so
 * dots stay round and text stays crisp. Hairline solid grid on round ticks,
 * 2px monotone line with a 10% wash, a ringed live-edge dot, and a crosshair
 * that snaps to the nearest second; the same readout is available from the
 * keyboard (focus, then ←/→, Home/End).
 */
export function TimeSeriesChart({
  data: singleData = [], series: seriesProp, domain, unit, format, label, height, color = 'var(--chart-series)', reference, minMax = 0, details,
}: Props) {
  const series: TimeSeries[] = useMemo(
    () => seriesProp ?? [{ label, color, data: singleData }],
    [seriesProp, label, color, singleData],
  )
  // The primary series drives the crosshair positions and the summary.
  const data = series[0]?.data ?? []
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(400)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const measure = () => setWidth(Math.max(120, node.clientWidth))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const chart = useMemo(() => {
    const plotWidth = width - MARGIN.left - MARGIN.right
    const plotHeight = height - MARGIN.top - MARGIN.bottom
    const all = series.flatMap((item) => item.data)
    const values = all.map((point) => point.v).filter((value): value is number => value != null && Number.isFinite(value))
    const yTicks = niceTicks(Math.max(minMax, reference?.value ?? 0, ...values, 0))
    const yMax = yTicks[yTicks.length - 1]
    const times = all.map((point) => point.t)
    const start = domain?.[0] ?? (times.length ? Math.min(...times) : 0)
    const end = Math.max(start + 1, domain?.[1] ?? (times.length ? Math.max(...times) : 1))
    const x = (t: number) => MARGIN.left + ((t - start) / (end - start)) * plotWidth
    const y = (value: number) => MARGIN.top + plotHeight * (1 - value / yMax)

    const baseline = y(0)
    const shapes = series.map((item) => {
      // Split at gaps so a missing second isn't drawn as a straight bridge.
      const runs: Array<Array<{ x: number; y: number }>> = []
      let current: Array<{ x: number; y: number }> = []
      for (const point of item.data) {
        if (point.v == null || !Number.isFinite(point.v)) {
          if (current.length) runs.push(current)
          current = []
          continue
        }
        current.push({ x: x(point.t), y: y(point.v) })
      }
      if (current.length) runs.push(current)
      const lines = runs.map((run) => monotonePath(run))
      // A wash under one series only; overlapping washes muddy each other.
      const areas = series.length === 1
        ? runs.map((run, index) => (run.length > 1 ? `${lines[index]} L ${run[run.length - 1].x} ${baseline} L ${run[0].x} ${baseline} Z` : ''))
        : []
      return { color: item.color, label: item.label, lines, areas }
    })
    const lastValueIndex = [...data].reverse().findIndex((point) => point.v != null)
    const lastIndex = lastValueIndex === -1 ? null : data.length - 1 - lastValueIndex
    return { plotWidth, plotHeight, yTicks, start, end, x, y, shapes, baseline, lastIndex }
  }, [series, data, domain, height, minMax, reference?.value, width])

  const nearestIndex = (clientX: number) => {
    const bounds = containerRef.current?.getBoundingClientRect()
    if (!bounds || data.length === 0) return null
    const t = chart.start + ((clientX - bounds.left - MARGIN.left) / chart.plotWidth) * (chart.end - chart.start)
    let best = 0
    for (let i = 1; i < data.length; i++) {
      if (Math.abs(data[i].t - t) < Math.abs(data[best].t - t)) best = i
    }
    return best
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (data.length === 0) return
    const last = data.length - 1
    const next = {
      ArrowLeft: Math.max(0, (active ?? last) - 1),
      ArrowRight: Math.min(last, (active ?? last) + 1),
      Home: 0,
      End: last,
    }[event.key]
    if (next != null) {
      event.preventDefault()
      setActive(next)
    } else if (event.key === 'Escape') {
      setActive(null)
    }
  }

  const point = active == null ? null : data[active]
  const pointX = point ? chart.x(point.t) : 0
  // One readout lists every series at the crosshair's time.
  const readout = point ? series.map((item, index) => ({
    label: item.label,
    color: item.color,
    value: index === 0 ? point.v : nearestValue(item.data, point.t),
  })) : []
  const xTicks = timeTicks(chart.start, chart.end, Math.max(2, Math.floor(chart.plotWidth / 70)))
  const latest = chart.lastIndex == null ? null : data[chart.lastIndex]
  const summary = latest?.v != null ? `${label}: latest ${format(latest.v)}${unit}` : `${label}: no data yet`

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-md"
      style={{ height }}
      tabIndex={0}
      role="img"
      aria-label={summary}
      onPointerMove={(event) => setActive(nearestIndex(event.clientX))}
      onPointerLeave={() => setActive(null)}
      onFocus={() => setActive((current) => current ?? chart.lastIndex)}
      onBlur={() => setActive(null)}
      onKeyDown={onKeyDown}
    >
      <svg width={width} height={height} className="block overflow-visible" aria-hidden="true">
        {chart.yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={MARGIN.left} x2={width - MARGIN.right} y1={chart.y(tick)} y2={chart.y(tick)}
              stroke="hsl(var(--border))" strokeWidth={1} shapeRendering="crispEdges"
            />
            <text x={MARGIN.left - 6} y={chart.y(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
              {format(tick)}{tick === chart.yTicks[chart.yTicks.length - 1] ? unit : ''}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text
            key={tick} x={chart.x(tick)} y={height - 4}
            textAnchor={tick === chart.start ? 'start' : 'middle'}
            className="fill-muted-foreground text-[10px] tabular-nums"
          >
            {formatClock(tick)}
          </text>
        ))}

        {chart.shapes.map((shape, s) => (
          <g key={shape.label}>
            {shape.areas.map((area, index) => area && <path key={`a${s}-${index}`} d={area} fill={shape.color} fillOpacity={0.1} />)}
            {shape.lines.map((line, index) => (
              <path key={`l${s}-${index}`} d={line} fill="none" stroke={shape.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
          </g>
        ))}

        {reference && reference.value > 0 && (
          <g>
            <line
              x1={MARGIN.left} x2={width - MARGIN.right} y1={chart.y(reference.value)} y2={chart.y(reference.value)}
              stroke="hsl(var(--muted-foreground))" strokeOpacity={0.8} strokeWidth={1} strokeDasharray="4 3" shapeRendering="crispEdges"
            />
            <text x={width - MARGIN.right} y={chart.y(reference.value) - 4} textAnchor="end" className="fill-muted-foreground text-[10px] font-medium">
              {reference.label}
            </text>
          </g>
        )}

        {series.length === 1 && latest?.v != null && active == null && (
          <circle cx={chart.x(latest.t)} cy={chart.y(latest.v)} r={4} fill={series[0].color} stroke="hsl(var(--card))" strokeWidth={2} />
        )}

        {point && (
          <g>
            <line x1={pointX} x2={pointX} y1={MARGIN.top} y2={chart.baseline} stroke="hsl(var(--foreground))" strokeOpacity={0.35} strokeWidth={1} shapeRendering="crispEdges" />
            {readout.map((row) => row.value != null && (
              <circle key={row.label} cx={pointX} cy={chart.y(row.value)} r={4} fill={row.color} stroke="hsl(var(--card))" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>

      {point && active != null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-[140px] rounded-lg border border-border bg-popover/95 px-2.5 py-2 text-[11px] shadow-lg backdrop-blur-md"
          style={pointX > width * 0.6 ? { right: width - pointX + 10 } : { left: pointX + 10 }}
        >
          <div className="text-[10px] tabular-nums text-muted-foreground">{formatClock(point.t)}</div>
          {readout.map((row) => (
            <div key={row.label} className="mt-0.5 flex items-center gap-1.5">
              <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: row.color }} aria-hidden="true" />
              <span className="font-semibold tabular-nums text-foreground">{row.value == null ? 'No data' : `${format(row.value)}${unit}`}</span>
              {series.length > 1 && <span className="text-muted-foreground">{row.label}</span>}
            </div>
          ))}
          {details?.(active)}
        </div>
      )}
    </div>
  )
}

function nearestValue(data: TimePoint[], t: number): number | null {
  let best: TimePoint | null = null
  for (const point of data) {
    if (point.v == null) continue
    if (!best || Math.abs(point.t - t) < Math.abs(best.t - t)) best = point
  }
  // Only report a value from the same moment, not a far-away sample.
  return best && Math.abs(best.t - t) <= 1 ? best.v : null
}
