import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { OperationsChart } from './OperationsChart'
import type { ChartPoint } from './liveMonitorMetrics'

const points: ChartPoint[] = [
  { attempt: 1, elapsed: 0, latency: 32, rps: 8, errorRate: 0, errorCount: 0 },
  { attempt: 2, elapsed: 1, latency: 41, rps: 10, errorRate: 0, errorCount: 0 },
]

describe('OperationsChart focus mode', () => {
  it('expands one chart and restores the dashboard', async () => {
    const user = userEvent.setup()
    const onToggleExpanded = vi.fn()
    render(
      <OperationsChart
        points={points}
        p95={41}
        expanded={false}
        onToggleExpanded={onToggleExpanded}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Expand Response time' }))

    expect(screen.getByText('Response time')).toBeInTheDocument()
    expect(screen.queryByText('Requests per second')).not.toBeInTheDocument()
    expect(screen.queryByText('Error rate')).not.toBeInTheDocument()
    expect(screen.getByText('Focus mode')).toBeInTheDocument()
    expect(onToggleExpanded).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Show all charts' }))

    expect(screen.getByText('Requests per second')).toBeInTheDocument()
    expect(screen.getByText('Error rate')).toBeInTheDocument()
    expect(onToggleExpanded).toHaveBeenCalledTimes(2)
  })
})
