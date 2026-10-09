// Pure helpers shared by Beacon's time-series charts: axis ticks, the line
// shape, and one-second aggregation of live run samples.

/** Round tick values covering 0..max: 0, 20, 40, 60 rather than 0, 23.4, 46.8. */
export function niceTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]
  const rough = max / target
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough) ?? 10 * magnitude
  const ticks: number[] = []
  for (let value = 0; value < max + step * 0.999; value += step) {
    ticks.push(Number(value.toPrecision(12)))
  }
  return ticks.length > 1 ? ticks : [0, step]
}

const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

/** Evenly spaced elapsed-time ticks (seconds) inside [start, end], at most `max`. */
export function timeTicks(start: number, end: number, max = 6): number[] {
  const span = Math.max(0, end - start)
  if (span === 0) return [start]
  const step = TIME_STEPS.find((candidate) => span / candidate <= max - 1) ?? Math.ceil(span / (max - 1))
  const ticks: number[] = []
  for (let value = Math.ceil(start / step) * step; value <= end + 1e-9; value += step) ticks.push(value)
  return ticks
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const rest = safe % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(rest).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * Monotone cubic path (Fritsch–Carlson). Unlike midpoint Béziers it never
 * overshoots the data, so a curve can't show a peak or a dip below zero that
 * didn't happen.
 */
export function monotonePath(points: Array<{ x: number; y: number }>): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return `M ${points[0].x} ${points[0].y}`
  if (n === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`

  const slopes: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x
    slopes.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx)
  }
  const tangents: number[] = [slopes[0]]
  for (let i = 1; i < n - 1; i++) {
    tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2)
  }
  tangents.push(slopes[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    const a = tangents[i] / slopes[i]
    const b = tangents[i + 1] / slopes[i]
    const h = a * a + b * b
    if (h > 9) {
      const t = 3 / Math.sqrt(h)
      tangents[i] = t * a * slopes[i]
      tangents[i + 1] = t * b * slopes[i]
    }
  }

  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const dx = (p1.x - p0.x) / 3
    path += ` C ${p0.x + dx} ${p0.y + tangents[i] * dx}, ${p1.x - dx} ${p1.y - tangents[i + 1] * dx}, ${p1.x} ${p1.y}`
  }
  return path
}

export interface RunSamplePoint {
  /** Seconds since the run started. */
  elapsed: number
  /** Cumulative attempts at this sample. */
  attempts: number
  /** Cumulative errors (including rate limited) at this sample. */
  errors: number
  /** A response latency observed at this sample, in ms. */
  latency: number | null
}

export interface SecondBucket {
  /** Start of the one-second window, in seconds since the run started. */
  second: number
  /** Requests completed in this second. */
  rps: number
  /** Mean of the latencies sampled in this second; null when none. */
  latency: number | null
  /** Share of this second's requests that failed or were rate limited. */
  errorRate: number
  errors: number
}

/**
 * Aggregate run samples into one-second windows. Live stats arrive per
 * response, so per-sample rates swing wildly (two updates 2 ms apart read as
 * 500 rps); counting completions per second is what "requests per second"
 * means. Seconds without samples are zero-traffic seconds. When `dropPartial`
 * is set, the still-filling current second is left out so the line doesn't
 * dip at the live edge.
 */
export function bucketBySecond(
  samples: RunSamplePoint[],
  dropPartial = false,
  /** "zero": a second without samples had no traffic (live stats arrive per
   *  response). "spread": samples were thinned out (run history), so a gap's
   *  completions are spread evenly over the seconds it covers. */
  gaps: 'zero' | 'spread' = 'zero',
): SecondBucket[] {
  if (samples.length === 0) return []
  const bySecond = new Map<number, { attempts: number; errors: number; latencies: number[]; lastElapsed: number }>()
  for (const sample of samples) {
    const second = Math.max(0, Math.floor(sample.elapsed))
    const bucket = bySecond.get(second) ?? { attempts: 0, errors: 0, latencies: [], lastElapsed: second }
    bucket.attempts = Math.max(bucket.attempts, sample.attempts)
    bucket.lastElapsed = Math.max(bucket.lastElapsed, sample.elapsed)
    bucket.errors = Math.max(bucket.errors, sample.errors)
    if (sample.latency != null && Number.isFinite(sample.latency)) bucket.latencies.push(sample.latency)
    bySecond.set(second, bucket)
  }
  const seconds = [...bySecond.keys()].sort((a, b) => a - b)
  const last = seconds[seconds.length - 1] - (dropPartial ? 1 : 0)
  const result: SecondBucket[] = []
  let previousAttempts = 0
  let previousErrors = 0
  for (let second = seconds[0]; second <= last; second++) {
    const bucket = bySecond.get(second)
    if (!bucket && gaps === 'spread') {
      const next = seconds.find((candidate) => candidate > second)
      const nextBucket = next == null ? undefined : bySecond.get(next)
      if (next != null && nextBucket) {
        const span = next - second + 1
        const rate = Math.max(0, nextBucket.attempts - previousAttempts) / span
        const failed = Math.max(0, nextBucket.errors - previousErrors) / span
        result.push({ second, rps: Math.round(rate * 10) / 10, latency: null, errorRate: rate > 0 ? Math.min(100, (failed / rate) * 100) : 0, errors: Math.round(failed) })
        previousAttempts += rate
        previousErrors += failed
        continue
      }
    }
    const attempts = bucket ? bucket.attempts : previousAttempts
    const errors = bucket ? bucket.errors : previousErrors
    let done = Math.max(0, attempts - previousAttempts)
    // A finished run's final second is usually partial (it ended at 12.2 s):
    // scale it by the time it actually covered instead of showing a fake
    // drop, and skip slivers too short to be a meaningful rate.
    if (!dropPartial && bucket && second === seconds[seconds.length - 1]) {
      const covered = bucket.lastElapsed - second
      if (covered < 0.25 && result.length > 0) break
      if (covered < 1) done = Math.round((done / Math.max(covered, 0.25)) * 10) / 10
    }
    const failed = Math.max(0, errors - previousErrors)
    const latencies = bucket?.latencies ?? []
    result.push({
      second,
      rps: done,
      latency: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
      errorRate: attempts - previousAttempts > 0 ? Math.min(100, (failed / (attempts - previousAttempts)) * 100) : 0,
      errors: failed,
    })
    previousAttempts = attempts
    previousErrors = errors
  }
  return result
}
