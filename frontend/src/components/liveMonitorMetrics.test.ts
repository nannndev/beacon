import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendBounded,
  deriveInstantRps,
  percentile,
} from './liveMonitorMetrics.ts'

test('percentile uses nearest rank without mutating unsorted samples', () => {
  const samples = [50, 10, 40, 20, 30]

  assert.equal(percentile(samples, 0.95), 50)
  assert.deepEqual(samples, [50, 10, 40, 20, 30])
})

test('percentile waits for the required sample count', () => {
  assert.equal(percentile([10, 20, 30, 40], 0.95, 5), null)
})

test('deriveInstantRps calculates throughput from snapshot deltas', () => {
  assert.equal(
    deriveInstantRps(
      { attempts: 10, elapsed_s: 5 },
      { attempts: 16, elapsed_s: 7 },
    ),
    3,
  )
})

test('deriveInstantRps rejects zero-time and backwards snapshots', () => {
  assert.equal(
    deriveInstantRps(
      { attempts: 10, elapsed_s: 5 },
      { attempts: 11, elapsed_s: 5 },
    ),
    null,
  )
  assert.equal(
    deriveInstantRps(
      { attempts: 10, elapsed_s: 5 },
      { attempts: 9, elapsed_s: 6 },
    ),
    null,
  )
})

test('appendBounded keeps only the newest values', () => {
  assert.deepEqual(appendBounded([1, 2, 3], 4, 3), [2, 3, 4])
  assert.deepEqual(appendBounded([], 1, 0), [])
})
