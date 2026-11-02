import { describe, expect, it } from 'vitest'
import { applyToken, findOpenToken, isGeneratorName } from './templateTokens'

describe('findOpenToken', () => {
  it('finds an unclosed token ending at the caret', () => {
    expect(findOpenToken('{"email": "{{rand', 17)).toEqual({ start: 11, query: 'rand' })
    expect(findOpenToken('/users/{{', 9)).toEqual({ start: 7, query: '' })
  })
  it('ignores closed tokens and plain text', () => {
    expect(findOpenToken('{{uuid}} next', 13)).toBeNull()
    expect(findOpenToken('hello', 5)).toBeNull()
  })
})

describe('applyToken', () => {
  it('replaces the partial and swallows an auto-closed brace pair', () => {
    expect(applyToken('a {{ra}} b', 2, 6, '{{random_name}}')).toEqual({ text: 'a {{random_name}} b', caret: 17 })
    expect(applyToken('x={{u', 2, 5, '{{uuid}}')).toEqual({ text: 'x={{uuid}}', caret: 10 })
  })
})

describe('isGeneratorName', () => {
  it('matches generators with or without parameters', () => {
    expect(isGeneratorName('random_int:5:9')).toBe(true)
    expect(isGeneratorName('random_choice:x|y')).toBe(true)
    expect(isGeneratorName('random_uuid')).toBe(true)
    expect(isGeneratorName('access_token')).toBe(false)
  })
})
