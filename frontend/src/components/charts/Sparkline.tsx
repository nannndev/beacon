import { monotonePath } from '../../lib/chartMath'

/**
 * A stat tile's trend: one neutral line, with only the latest point in the
 * series color. Tiles share this so trends never turn into a rainbow of
 * unrelated hues.
 */
export function Sparkline({ values, width = 64, height = 32 }: { values: number[]; width?: number; height?: number }) {
  const recent = values.filter(Number.isFinite).slice(-30)
  if (recent.length < 2) return null

  const min = Math.min(...recent)
  const max = Math.max(...recent)
  const span = Math.max(1e-9, max - min)
  const coordinates = recent.map((value, index) => ({
    x: 2 + (index / (recent.length - 1)) * (width - 4),
    y: max === min ? height / 2 : height - 4 - ((value - min) / span) * (height - 8),
  }))
  const latest = coordinates[coordinates.length - 1]

  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible" aria-hidden="true">
      <path d={monotonePath(coordinates)} fill="none" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.55} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={latest.x} cy={latest.y} r={2.5} fill="var(--chart-series)" />
    </svg>
  )
}
