export type MetricTone = 'positive' | 'negative' | 'neutral'

const LOWER_IS_BETTER = new Set([
  'p50_ms',
  'p95_ms',
  'p99_ms',
  'errors',
  'rate_limited',
])
const HIGHER_IS_BETTER = new Set(['success', 'average_rps', 'peak_rps'])


export function metricTone(metric: string, change: number | null): MetricTone {
  if (change == null || change === 0) return 'neutral'
  if (LOWER_IS_BETTER.has(metric)) return change < 0 ? 'positive' : 'negative'
  if (HIGHER_IS_BETTER.has(metric)) return change > 0 ? 'positive' : 'negative'
  return 'neutral'
}

export function formatMetricDelta(change: number | null, unit = ''): string {
  if (change == null || !Number.isFinite(change)) return '—'
  const sign = change > 0 ? '+' : ''
  const suffix = unit ? ` ${unit}` : ''
  return `${sign}${change.toFixed(1)}${suffix}`
}

export function buildSvgPoints(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): string {
  const valid = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  )
  if (valid.length < 2) return ''
  const xs = valid.map((point) => point.x)
  const ys = valid.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const xRange = maxX - minX || 1
  const yRange = maxY - minY || 1
  return valid
    .map((point) => {
      const x = ((point.x - minX) / xRange) * width
      const y = height - ((point.y - minY) / yRange) * height
      return `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`
    })
    .join(' ')
}
