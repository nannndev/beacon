import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('combines conditional classes and resolves Tailwind conflicts', () => {
    expect(cn('rounded-md px-2', false && 'hidden', ['px-4', 'font-semibold'])).toBe(
      'rounded-md px-4 font-semibold',
    )
  })
})
