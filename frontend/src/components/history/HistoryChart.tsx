import { useState } from 'react'
import { Expand, Minimize2 } from 'lucide-react'

import { buildSvgPoints } from '../../lib/historyMetrics'


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

export function HistoryChart({ title, subtitle, series, unit = '' }: Props) {
  const [expanded, setExpanded] = useState(false)
  const content = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
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
      <div className="relative min-h-[180px] flex-1 overflow-hidden rounded-xl border border-border/70 bg-muted/20 p-4">
        <div className="pointer-events-none absolute inset-x-4 top-1/4 border-t border-dashed border-border/60" />
        <div className="pointer-events-none absolute inset-x-4 top-1/2 border-t border-dashed border-border/60" />
        <div className="pointer-events-none absolute inset-x-4 top-3/4 border-t border-dashed border-border/60" />
        <svg viewBox="0 0 1000 260" preserveAspectRatio="none" className="h-full min-h-[160px] w-full" role="img" aria-label={`${title} chart`}>
          {series.map((item) => {
            const points = buildSvgPoints(item.points, 1000, 240)
            return points ? (
              <polyline
                key={item.label}
                points={points}
                fill="none"
                stroke={item.color}
                strokeWidth="4"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null
          })}
        </svg>
        {series.every((item) => item.points.length < 2) && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Not enough samples yet</div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}{unit ? ` (${unit})` : ''}
          </span>
        ))}
      </div>
    </div>
  )

  if (expanded) {
    return (
      <div className="fixed inset-0 z-[80] bg-background/95 p-5 backdrop-blur md:p-10">
        <div className="mx-auto h-full max-w-7xl rounded-2xl border border-border bg-card p-5 shadow-2xl md:p-8">
          {content}
        </div>
      </div>
    )
  }
  return <div className="h-[300px] rounded-2xl border border-border bg-card p-4">{content}</div>
}
