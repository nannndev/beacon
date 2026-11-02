import { describe, expect, it } from 'vitest'
import { restoreFieldTypes } from './PayloadEditor'

describe('restoreFieldTypes', () => {
  it('keeps non-string values typed after a text edit elsewhere', () => {
    const previous = { title: 'a', userId: 1, active: true, tags: ['x'], meta: { n: 2 }, gone: null }
    const next = { title: 'b', userId: '1', active: 'false', tags: '["x","y"]', meta: '{"n":2}', gone: 'null' }
    expect(restoreFieldTypes(next, previous)).toEqual({ title: 'b', userId: 1, active: false, tags: ['x', 'y'], meta: { n: 2 }, gone: null })
  })
  it('keeps text when the edit is no longer valid JSON, and new keys as text', () => {
    expect(restoreFieldTypes({ userId: '{{user_id}}', extra: '5' }, { userId: 1 })).toEqual({ userId: '{{user_id}}', extra: '5' })
  })
})
