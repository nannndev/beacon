import { describe, expect, it } from 'vitest'

import { hasJsonPlaceholderSample } from './sampleProject'


describe('hasJsonPlaceholderSample', () => {
  it('uses template_id instead of the display name', () => {
    expect(
      hasJsonPlaceholderSample([
        { id: '1', name: 'Renamed', template_id: 'jsonplaceholder-v1' } as any,
      ]),
    ).toBe(true)
    expect(
      hasJsonPlaceholderSample([
        { id: '2', name: 'JSONPlaceholder API' } as any,
      ]),
    ).toBe(false)
  })
})
