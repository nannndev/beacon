import assert from 'node:assert/strict'
import test from 'node:test'

import { buildLoadRunPayload } from './runPayload.ts'

test('buildLoadRunPayload includes the endpoint identity and load mode', () => {
  const payload = buildLoadRunPayload('endpoint-1', {
    concurrency: 2,
    max_requests: 50,
    delay: 0.5,
    use_min_delay: false,
  })

  assert.deepEqual(payload, {
    test_id: 'endpoint-1',
    mode: 'load',
    concurrency: 2,
    max_requests: 50,
    delay: 0.5,
    use_min_delay: false,
  })
})
