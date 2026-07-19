import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { HistoryPage } from '../../pages/HistoryPage'
import type { HistoryDetail, HistorySummary } from '../../types/history'


const runs: HistorySummary[] = [
  {
    id: 'r1', project_id: 'p1', project_name: 'Demo', source_type: 'endpoint',
    target_id: 'e1', target_name: 'GET /posts', mode: 'load', status: 'completed',
    label: null, is_pinned: false, started_at: '2026-07-19T01:00:00Z',
    completed_at: '2026-07-19T01:00:01Z', duration_ms: 1000, attempts: 10,
    success: 10, errors: 0, rate_limited: 0, average_rps: 10, p95_ms: 40,
  },
  {
    id: 'r2', project_id: 'p1', project_name: 'Demo', source_type: 'endpoint',
    target_id: 'e2', target_name: 'POST /posts', mode: 'spike', status: 'completed',
    label: null, is_pinned: false, started_at: '2026-07-19T02:00:00Z',
    completed_at: '2026-07-19T02:00:02Z', duration_ms: 2000, attempts: 20,
    success: 18, errors: 2, rate_limited: 0, average_rps: 9, p95_ms: 60,
  },
]

const metrics = {
  attempts: 10, success: 10, rate_limited: 0, errors: 0,
  average_rps: 10, peak_rps: 12, min_latency_ms: 10, average_latency_ms: 25,
  p50_ms: 20, p95_ms: 40, p99_ms: 45, max_latency_ms: 50,
}

function detail(summary: HistorySummary): HistoryDetail {
  return {
    ...summary,
    config_snapshot: { concurrency: 1 },
    metrics,
    steps: [],
    samples: [
      { sequence: 0, elapsed_ms: 0, attempts: 1, success: 1, rate_limited: 0, errors: 0, instantaneous_rps: 1, latency_ms: 20 },
      { sequence: 1, elapsed_ms: 1000, attempts: 10, success: 10, rate_limited: 0, errors: 0, instantaneous_rps: 10, latency_ms: 40 },
    ],
    events: [],
  }
}

function fakeClient() {
  return {
    listHistory: async () => ({ items: runs, next_cursor: null }),
    historyDetail: async (id: string) => detail(runs.find((run) => run.id === id)!),
    compareHistory: async () => ({
      baseline: detail(runs[0]), candidate: detail(runs[1]), same_mode: false,
      deltas: { p95_ms: { value: 60, change: 20, percent_change: 50, improved: false } },
      config_changes: {}, series: [],
    }),
    historyHealth: async () => ({ available: true, error_code: null, backup_available: false }),
    updateHistory: async (id: string) => detail(runs.find((run) => run.id === id)!),
    deleteHistory: async () => ({}),
    exportHistory: async () => ({}),
    rebuildHistory: async () => ({}),
  }
}

describe('HistoryPage', () => {
  it('selects one run for detail and exactly two for comparison', async () => {
    const user = userEvent.setup()
    render(<HistoryPage projectId="p1" client={fakeClient() as any} onBack={() => {}} />)

    await user.click(await screen.findByText('GET /posts'))
    expect(await screen.findByRole('heading', { name: 'GET /posts' })).toBeInTheDocument()
    await user.click(screen.getByLabelText('Compare GET /posts'))
    await user.click(screen.getByLabelText('Compare POST /posts'))
    expect(await screen.findByText('Baseline')).toBeInTheDocument()
    expect(screen.getByText('Candidate')).toBeInTheDocument()
  })

  it('renders unavailable history without blocking workspace navigation', async () => {
    const client = {
      ...fakeClient(),
      listHistory: async () => { throw new Error('unavailable') },
      historyHealth: async () => ({ available: false, error_code: 'history_unavailable', backup_available: true }),
    }
    render(<HistoryPage projectId="p1" client={client as any} onBack={() => {}} />)

    expect(await screen.findByText(/tests still work/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back to workspace/i })).toBeEnabled()
  })
})
