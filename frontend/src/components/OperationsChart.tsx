import { Expand, Minimize2 } from 'lucide-react'

import { Button } from './ui/button'
import type { ChartPoint } from './liveMonitorMetrics'

interface Props {
  points: ChartPoint[]
  p95: number | null
  expanded: boolean
  onToggleExpanded: () => void
}

const WIDTH = 600
const HEIGHT = 160
const TOP = 10
const BOTTOM = 18

export function OperationsChart({ points, p95, expanded, onToggleExpanded }: Props) {
  const visible = points.slice(-90)
  const maxLatency = Math.max(p95 ?? 0, ...visible.map((point) => point.latency), 1)
  const maxRps = Math.max(...visible.map((point) => point.rps), 1)
  const plotHeight = HEIGHT - TOP - BOTTOM
  const step = visible.length > 1 ? WIDTH / (visible.length - 1) : WIDTH
  const barWidth = Math.max(2, Math.min(12, WIDTH / Math.max(visible.length, 1) - 2))
  const latencyPoints = visible
    .map((point, index) => {
      const x = visible.length === 1 ? WIDTH / 2 : index * step
      const y = TOP + plotHeight - (point.latency / maxLatency) * plotHeight
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const p95Y = p95 == null ? null : TOP + plotHeight - (p95 / maxLatency) * plotHeight

  return (
    <section className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border/70">
        <div className="min-w-0">
          <div className="text-[11px] font-medium">Latency + throughput</div>
          <div className="text-[10px] text-muted-foreground">
            {visible.length > 0 ? `${visible.length} live samples` : 'Waiting for live samples'}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 shrink-0"
          onClick={onToggleExpanded}
          aria-label={expanded ? 'Collapse chart' : 'Expand chart'}
          aria-expanded={expanded}
          title={expanded ? 'Collapse chart' : 'Expand chart'}
        >
          {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className={`relative px-3 py-2 transition-[height] duration-200 ${
        expanded ? 'h-[260px] md:h-[336px]' : 'h-[168px] md:h-[184px]'
      }`}>
        {visible.length < 2 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            Waiting for live samples
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="h-full w-full"
            role="img"
            aria-label={`Latency and throughput trend from ${visible.length} samples`}
          >
            {[0.25, 0.5, 0.75].map((fraction) => (
              <line
                key={fraction}
                x1="0"
                y1={TOP + plotHeight * fraction}
                x2={WIDTH}
                y2={TOP + plotHeight * fraction}
                className="stroke-border/70"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {visible.map((point, index) => {
              const x = visible.length === 1 ? WIDTH / 2 : index * step
              const height = Math.max(2, (point.rps / maxRps) * plotHeight)
              return (
                <rect
                  key={`${point.attempt}-${index}`}
                  x={Math.max(0, x - barWidth / 2)}
                  y={TOP + plotHeight - height}
                  width={barWidth}
                  height={height}
                  rx="1"
                  className="fill-emerald-500/20"
                />
              )
            })}

            {p95Y != null && (
              <line
                x1="0"
                y1={p95Y}
                x2={WIDTH}
                y2={p95Y}
                className="stroke-amber-500/70"
                strokeWidth="1"
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            )}

            <polyline
              points={latencyPoints}
              fill="none"
              className="stroke-cyan-500"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-t border-border/70 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-3 bg-cyan-500" />Latency</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-3 rounded-sm bg-emerald-500/30" />Req/s</span>
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-3 border-t border-dashed border-amber-500" />P95</span>
        {visible.length > 0 && (
          <span className="ml-auto font-mono">latest {Math.round(visible[visible.length - 1].latency)}ms</span>
        )}
      </div>
    </section>
  )
}
