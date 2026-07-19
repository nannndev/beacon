import { describe, expect, it } from 'vitest'

import { parseAppView, withHistoryStep } from './useAppView'


describe('app view and history run metadata', () => {
  it('maps history URLs and preserves a requested run id', () => {
    expect(parseAppView('/history', '?run=r1')).toEqual({ view: 'history', runId: 'r1' })
    expect(parseAppView('/', '')).toEqual({ view: 'workspace', runId: null })
  })

  it('adds server history group metadata to each queued endpoint', () => {
    expect(withHistoryStep({ test_id: 'e2' }, 'h1', 1)).toEqual({
      test_id: 'e2', history_id: 'h1', history_step_index: 1,
    })
  })
})
