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

  it('filters samples when the selected timeframe changes', async () => {
    const user = userEvent.setup()
    const longRun: ChartPoint[] = [
      { attempt: 1, elapsed: 0, latency: 20, rps: 1, errorRate: 0, errorCount: 0 },
      { attempt: 2, elapsed: 100, latency: 30, rps: 2, errorRate: 0, errorCount: 0 },
      { attempt: 3, elapsed: 400, latency: 40, rps: 3, errorRate: 0, errorCount: 0 },
    ]
    render(<OperationsChart points={longRun} p95={30} expanded={false} onToggleExpanded={vi.fn()} />)

    expect(screen.getByText('Last 5 min · 2 samples')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '1m' }))
    expect(screen.getByText('Last 1 min · 1 samples')).toBeInTheDocument()
    expect(screen.getAllByText('Waiting for live samples')).toHaveLength(3)
  })

  it('freezes incoming samples without stopping the run', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<OperationsChart points={points} p95={41} expanded={false} onToggleExpanded={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Pause live chart' }))
    rerender(<OperationsChart points={[...points, { attempt: 3, elapsed: 2, latency: 50, rps: 12, errorRate: 0, errorCount: 0 }]} p95={41} expanded={false} onToggleExpanded={vi.fn()} />)

    expect(screen.getByText(/Frozen/)).toBeInTheDocument()
    expect(screen.getByText(/1s captured/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume live chart' }))
    expect(screen.getByText(/2s captured/)).toBeInTheDocument()
  })
})
