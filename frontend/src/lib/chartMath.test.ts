import { describe, expect, it } from 'vitest'

import { bucketBySecond, formatClock, monotonePath, niceTicks, timeTicks } from './chartMath'

describe('niceTicks', () => {
  it('produces round steps that cover the maximum', () => {
    expect(niceTicks(47)).toEqual([0, 20, 40, 60])
    expect(niceTicks(205)).toEqual([0, 100, 200, 300])
    expect(niceTicks(0.8)).toEqual([0, 0.2, 0.4, 0.6, 0.8])
    expect(niceTicks(0)).toEqual([0, 1])
  })
})

describe('timeTicks', () => {
  it('picks a readable interval for the visible span', () => {
    expect(timeTicks(0, 12)).toEqual([0, 5, 10])
    expect(timeTicks(0, 300)).toEqual([0, 60, 120, 180, 240, 300])
    expect(timeTicks(3, 3)).toEqual([3])
  })

  it('formats elapsed seconds as a clock', () => {
    expect(formatClock(65)).toBe('01:05')
    expect(formatClock(3725)).toBe('1:02:05')
  })
})

describe('monotonePath', () => {
  it('never overshoots between points', () => {
    const path = monotonePath([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 10 }])
    const ys = [...path.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((match) => Number(match[2]))
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(10)
  })
})

describe('bucketBySecond', () => {
  it('counts completions per second instead of per-sample rates', () => {
    const buckets = bucketBySecond([
      { elapsed: 0.2, attempts: 1, errors: 0, latency: 100 },
      { elapsed: 0.202, attempts: 2, errors: 0, latency: 120 },
      { elapsed: 0.9, attempts: 5, errors: 1, latency: 80 },
      { elapsed: 2.5, attempts: 8, errors: 1, latency: 90 },
    ])
    expect(buckets).toEqual([
      { second: 0, rps: 5, latency: 100, errorRate: 20, errors: 1 },
      { second: 1, rps: 0, latency: null, errorRate: 0, errors: 0 },
      // The run ended 0.5 s into second 2: 3 requests => 6/s.
      { second: 2, rps: 6, latency: 90, errorRate: 0, errors: 0 },
    ])
  })

  it('can leave out the still-filling current second', () => {
    const samples = [
      { elapsed: 0.5, attempts: 10, errors: 0, latency: 50 },
      { elapsed: 1.1, attempts: 12, errors: 0, latency: 50 },
    ]
    expect(bucketBySecond(samples, true).map((bucket) => bucket.second)).toEqual([0])
    expect(bucketBySecond([])).toEqual([])
  })

  it("scales a finished run's partial last second instead of showing a drop", () => {
    const samples = [
      { elapsed: 0.9, attempts: 30, errors: 0, latency: 50 },
      { elapsed: 1.5, attempts: 45, errors: 0, latency: 50 },
    ]
    // 15 requests in the half second covered => 30/s, not 15/s.
    expect(bucketBySecond(samples).map((bucket) => bucket.rps)).toEqual([30, 30])
    // A 0.1 s sliver is dropped rather than extrapolated.
    expect(bucketBySecond([samples[0], { ...samples[1], elapsed: 1.1 }]).map((bucket) => bucket.second)).toEqual([0])
  })
})

describe('bucketBySecond for thinned-out history samples', () => {
  it('spreads a gap over the seconds it covers instead of reporting zero traffic', () => {
    const samples = [
      { elapsed: 0.9, attempts: 10, errors: 0, latency: 50 },
      { elapsed: 3.9, attempts: 40, errors: 0, latency: 60 },
    ]
    // The last second covered only 0.9 s, so its 10 requests read as 11.1/s.
    expect(bucketBySecond(samples, false, 'spread').map((bucket) => bucket.rps)).toEqual([10, 10, 10, 11.1])
    expect(bucketBySecond(samples, false, 'zero').map((bucket) => bucket.rps)).toEqual([10, 0, 0, 33.3])
  })
})

