import { MODE_DEFAULTS, MODE_INFO, type ModeParams, type TestMode } from '../types/testModes'

export const TEST_MODE_PREFERENCES_KEY = 'beacon_test_mode_preferences_v1'

export type ModeParamsByMode = Record<TestMode, ModeParams['params']>

export interface TestModePreferences {
  selectedMode: TestMode
  paramsByMode: ModeParamsByMode
}

interface StorageLike {
  getItem(key: string): string | null
  setItem?(key: string, value: string): void
}

const modeIds = MODE_INFO.map((item) => item.id)

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function defaultModeParams(mode: TestMode): ModeParams['params'] {
  return clone(MODE_DEFAULTS[mode])
}

export function defaultTestModePreferences(): TestModePreferences {
  return {
    selectedMode: 'load',
    paramsByMode: Object.fromEntries(
      modeIds.map((mode) => [mode, defaultModeParams(mode)]),
    ) as ModeParamsByMode,
  }
}

export function loadTestModePreferences(
  storage: StorageLike | undefined = typeof window === 'undefined' ? undefined : window.localStorage,
): TestModePreferences {
  const defaults = defaultTestModePreferences()
  if (!storage) return defaults

  try {
    const raw = storage.getItem(TEST_MODE_PREFERENCES_KEY)
    if (!raw) return defaults

    const saved = JSON.parse(raw) as Partial<TestModePreferences>
    const selectedMode = modeIds.includes(saved.selectedMode as TestMode)
      ? saved.selectedMode as TestMode
      : defaults.selectedMode

    for (const mode of modeIds) {
      const candidate = saved.paramsByMode?.[mode]
      if (candidate && typeof candidate === 'object') {
        defaults.paramsByMode[mode] = {
          ...defaults.paramsByMode[mode],
          ...candidate,
        } as ModeParams['params']
      }
    }

    return { selectedMode, paramsByMode: defaults.paramsByMode }
  } catch {
    return defaults
  }
}

export function saveTestModePreferences(
  preferences: TestModePreferences,
  storage: StorageLike | undefined = typeof window === 'undefined' ? undefined : window.localStorage,
) {
  try {
    storage?.setItem?.(TEST_MODE_PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // Storage can be unavailable in privacy mode; test execution should still work.
  }
}
