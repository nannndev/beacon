import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScenarioMonitor } from './ScenarioMonitor'
import { MODE_DEFAULTS, type ScenarioParams } from '../types/testModes'
import type { ScenarioRunStatus } from '../lib/api'

const plan = {
  params: { ...(MODE_DEFAULTS.scenario as ScenarioParams), virtual_users: 10, iterations: 2 },
  startedAt: Date.now(),
}

describe('ScenarioMonitor live execution states', () => {
  it('uses request language for a single endpoint and explains failures', () => {
    const live: ScenarioRunStatus = {
      status: 'running',
      progress: {
        scope: 'endpoint', total_flows: 20, completed_flows: 8,
        successful_flows: 6, failed_flows: 2, active_users: 5,
        requests_completed: 8, successful_requests: 6, failed_requests: 2,
        rate_limited: 0,
      },
      scenario_steps: [{
        test_id: 'login', name: 'Login', method: 'POST', state: 'failed',
        attempts: 8, successful: 6, failed: 2, success_rate: 75,
        p95_ms: 180, failure: {
          kind: 'assertion_failed', message: 'Expected status code 200, received 403', status: 403,
          assertion_failures: [{ expected: 200, actual: 403 }],
        },
      }],
      recent_events: [],
    }

    render(<ScenarioMonitor busy plan={plan} result={null} live={live} endpoints={[{ id: 'login', name: 'Login', method: 'POST' }]} onClear={vi.fn()} />)

    expect(screen.getByText('Endpoint run')).toBeInTheDocument()
    expect(screen.getByText('8/20')).toBeInTheDocument()
    expect(screen.getByText('Why it failed')).toBeInTheDocument()
    expect(screen.getByText('Expected status code 200, received 403')).toBeInTheDocument()
    expect(screen.getByText('Following')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Following'))
    expect(screen.getByText('Paused')).toBeInTheDocument()
  })

  it('uses journey language for multiple endpoints', () => {
    const live: ScenarioRunStatus = {
      status: 'running',
      progress: {
        scope: 'journey', total_flows: 20, completed_flows: 4,
        successful_flows: 4, failed_flows: 0, active_users: 6,
        requests_completed: 8, successful_requests: 8, failed_requests: 0,
        rate_limited: 0,
      },
      scenario_steps: [],
      recent_events: [],
    }

    render(<ScenarioMonitor busy plan={plan} result={null} live={live} endpoints={[
      { id: 'login', name: 'Login', method: 'POST' },
      { id: 'profile', name: 'Profile', method: 'GET' },
    ]} onClear={vi.fn()} />)

    expect(screen.getByText('Scenario journey')).toBeInTheDocument()
    expect(screen.getByText('20 journeys · 2 steps')).toBeInTheDocument()
  })

  it('explains that a web endpoint measures the document request, not browser rendering', () => {
    render(<ScenarioMonitor busy plan={plan} result={null} live={null} endpoints={[
      { id: 'home', name: 'Homepage', method: 'GET', targetType: 'web' },
    ]} onClear={vi.fn()} />)

    expect(screen.getByText('Web request run')).toBeInTheDocument()
    expect(screen.getByText(/Browser rendering is not included/)).toBeInTheDocument()
  })
})
