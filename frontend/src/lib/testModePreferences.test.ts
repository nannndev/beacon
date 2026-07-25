import { describe, expect, it } from 'vitest'
import {
  TEST_MODE_PREFERENCES_KEY,
  defaultTestModePreferences,
  loadTestModePreferences,
  saveTestModePreferences,
} from './testModePreferences'
import type { ScenarioParams } from '../types/testModes'

function memoryStorage(initial?: string) {
  let value = initial ?? null
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
    value: () => value,
  }
}

describe('test mode preferences', () => {
  it('persists the selected mode and independent values per mode', () => {
    const storage = memoryStorage()
    const preferences = defaultTestModePreferences()
    preferences.selectedMode = 'scenario'
    preferences.paramsByMode.scenario = {
      ...(preferences.paramsByMode.scenario as ScenarioParams),
      virtual_users: 12,
      iterations: 4,
    }

    saveTestModePreferences(preferences, storage)
    const restored = loadTestModePreferences(storage)

    expect(storage.value()).toContain(TEST_MODE_PREFERENCES_KEY.slice(0, 0))
    expect(restored.selectedMode).toBe('scenario')
    expect(restored.paramsByMode.scenario).toMatchObject({ virtual_users: 12, iterations: 4 })
  })

  it('merges new default fields into older saved configurations', () => {
    const storage = memoryStorage(JSON.stringify({
      selectedMode: 'scenario',
      paramsByMode: { scenario: { virtual_users: 8 } },
    }))

    const restored = loadTestModePreferences(storage)
    expect(restored.paramsByMode.scenario).toMatchObject({
      virtual_users: 8,
      iterations: 1,
      retry_delay_ms: 500,
    })
  })

  it('falls back safely when stored data is invalid', () => {
    const restored = loadTestModePreferences(memoryStorage('{broken'))
    expect(restored.selectedMode).toBe('load')
    expect(restored.paramsByMode.load).toMatchObject({ concurrency: 4 })
  })
})
