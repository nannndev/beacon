import { describe, expect, it } from 'vitest'

import { buildSvgPoints, formatMetricDelta, metricTone } from './historyMetrics'


describe('history metric presentation', () => {
  it('understands lower and higher is better metrics', () => {
    expect(metricTone('p95_ms', -80)).toBe('positive')
    expect(metricTone('errors', 3)).toBe('negative')
    expect(metricTone('success', 3)).toBe('positive')
    expect(metricTone('average_rps', -2)).toBe('negative')
    expect(metricTone('attempts', 2)).toBe('neutral')
  })

  it('formats signed deltas and rejects invalid chart points', () => {
    expect(formatMetricDelta(12.345, 'ms')).toBe('+12.3 ms')
    expect(formatMetricDelta(null, 'ms')).toBe('—')
    expect(buildSvgPoints([{ x: 0, y: 1 }], 100, 40)).toBe('')
    expect(
      buildSvgPoints(
        [{ x: 0, y: 1 }, { x: 10, y: 3 }, { x: 20, y: Number.NaN }],
        100,
        40,
      ),
    ).toBe('0,40 100,0')
  })
})
