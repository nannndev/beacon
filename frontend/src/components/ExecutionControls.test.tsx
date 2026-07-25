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

  it('runs the full project journey instead of only the selected endpoint', () => {
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

    expect(screen.getByText('Project journey · 3 endpoints')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /run project scenario/i }))

    expect(onRunAll).toHaveBeenCalledWith('scenario', expect.objectContaining({ virtual_users: 1, iterations: 1 }))
    expect(onRun).not.toHaveBeenCalled()
  })
})
