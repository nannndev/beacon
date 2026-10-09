import { useEffect, useState } from 'react'
import { Expand, Minimize2 } from 'lucide-react'

import { TimeSeriesChart, type TimeSeries } from '../charts/TimeSeriesChart'

interface Props {
  title: string
  subtitle?: string
  /** Points are seconds since the run started. */
  series: TimeSeries[]
  unit: string
  format: (value: number) => string
}

/**
 * A run-history chart card. Two or more series always get a legend (line
 * keys), so identity never rests on color alone; a single series is named by
 * the title.
 */
export function HistoryChart({ title, subtitle, series, unit, format }: Props) {
  const [expanded, setExpanded] = useState(false)
  const hasData = series.some((item) => item.data.filter((point) => point.v != null).length >= 2)

  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const content = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs hover:bg-muted"
          aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
        >
          {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
          {series.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
              {item.label}
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {hasData ? (
          <TimeSeriesChart series={series} unit={unit} format={format} label={title} height={expanded ? 520 : 210} />
        ) : (
          <div className="grid h-[210px] place-items-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            Not enough samples to chart
          </div>
        )}
      </div>
    </div>
  )

  if (expanded) {
    return (
      <div className="fixed inset-0 z-[80] bg-background/95 p-5 backdrop-blur md:p-10" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mx-auto max-w-7xl rounded-2xl border border-border bg-card p-5 shadow-2xl md:p-8">{content}</div>
      </div>
    )
  }
  return <div className="rounded-2xl border border-border bg-card p-4">{content}</div>
}
