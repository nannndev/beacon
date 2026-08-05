import { describe, it, expect } from 'vitest'
import { parseCurlCommand } from './curlParser'

describe('curlParser', () => {
  it('parses simple GET request', () => {
    const curl = 'curl https://api.example.com/v1/users'
    const result = parseCurlCommand(curl)
    expect(result.url).toBe('https://api.example.com/v1/users')
    expect(result.method).toBe('GET')
    expect(result.headers).toEqual({})
  })

  it('parses POST request with headers and JSON body', () => {
    const curl = `curl -X POST "https://api.retailku.com/v1/auth/login" \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer test_token" \\
      -d '{"email":"admin@example.com","password":"secret"}'`
    
    const result = parseCurlCommand(curl)
    expect(result.url).toBe('https://api.retailku.com/v1/auth/login')
    expect(result.method).toBe('POST')
    expect(result.headers['Content-Type']).toBe('application/json')
    expect(result.headers['Authorization']).toBe('Bearer test_token')
    expect(result.payload_type).toBe('json')
    expect(result.payload).toEqual({ email: 'admin@example.com', password: 'secret' })
  })

  it('infers POST method when -d is passed without -X', () => {
    const curl = 'curl "https://api.example.com/v1/data" -d "raw_data_string"'
    const result = parseCurlCommand(curl)
    expect(result.method).toBe('POST')
    expect(result.payload).toBe('raw_data_string')
  })

  it('throws on empty string', () => {
    expect(() => parseCurlCommand('')).toThrow('Empty cURL command')
  })
})
