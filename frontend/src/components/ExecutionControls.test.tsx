import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionControls, DEFAULT_SETTINGS } from './ExecutionControls'
import { defaultTestModePreferences, TEST_MODE_PREFERENCES_KEY } from '../lib/testModePreferences'

describe('ExecutionControls scenario scope', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    })
    const preferences = defaultTestModePreferences()
    preferences.selectedMode = 'scenario'
    localStorage.setItem(TEST_MODE_PREFERENCES_KEY, JSON.stringify(preferences))
  })

  it('offers separate selected-endpoint and project-journey actions', () => {
    const onRun = vi.fn()
    const onRunAll = vi.fn()
    render(
      <ExecutionControls
        settings={DEFAULT_SETTINGS}
        onChange={vi.fn()}
        status="idle"
        selectedName="Protected profile"
        hasSelection
        endpointCount={3}
        overrideEnabled={false}
        onToggleOverride={vi.fn()}
        onRun={onRun}
        onRunAll={onRunAll}
        onStop={vi.fn()}
        selectedTestId="profile"
      />,
    )

    expect(screen.getByText('Protected profile')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run selected endpoint' }))

    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ __scenario: true, virtual_users: 1, iterations: 1 }))
    expect(onRunAll).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Run project journey' }))

    expect(onRunAll).toHaveBeenCalledWith('scenario', expect.objectContaining({ virtual_users: 1, iterations: 1 }))
  })

  it('keeps Stop enabled while an asynchronous scenario is running', () => {
    const onStop = vi.fn()
    render(
      <ExecutionControls
        settings={DEFAULT_SETTINGS}
        onChange={vi.fn()}
        status="idle"
        selectedName="Protected profile"
        hasSelection
        endpointCount={3}
        overrideEnabled={false}
        onToggleOverride={vi.fn()}
        onRun={vi.fn()}
        onRunAll={vi.fn()}
        onStop={onStop}
        selectedTestId="profile"
        scenarioBusy
      />,
    )

    const stop = screen.getByRole('button', { name: /stop/i })
    expect(stop).toBeEnabled()
    fireEvent.click(stop)
    expect(onStop).toHaveBeenCalledOnce()
  })
})
