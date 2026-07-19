export interface StatsSnapshot {
  attempts: number
  elapsed_s: number
}

export interface ChartPoint {
  attempt: number
  elapsed: number
  latency: number
  rps: number
}

export function percentile(
  values: number[],
  fraction: number,
  minSamples = 1,
): number | null {
  const samples = values.filter(Number.isFinite)
  if (samples.length < minSamples || samples.length === 0) return null

  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.ceil(Math.min(1, Math.max(0, fraction)) * sorted.length)
  return sorted[Math.max(0, rank - 1)]
}

export function deriveInstantRps(
  previous: StatsSnapshot,
  current: StatsSnapshot,
): number | null {
  const attempts = current.attempts - previous.attempts
  const elapsed = current.elapsed_s - previous.elapsed_s
  if (!Number.isFinite(attempts) || !Number.isFinite(elapsed) || attempts < 0 || elapsed <= 0) {
    return null
  }
  return Math.round((attempts / elapsed) * 10) / 10
}

export function appendBounded<T>(history: T[], value: T, limit: number): T[] {
  if (limit <= 0) return []
  return [...history, value].slice(-limit)
}
