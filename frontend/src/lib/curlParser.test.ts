import { describe, it, expect } from 'vitest'
import { parseCurlCommand } from './curlParser'
import { toCurl } from './curl'

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

describe('request settings in cURL commands', () => {
  it('imports timeout, proxy, and --insecure without mistaking the proxy for the URL', () => {
    const parsed = parseCurlCommand('curl -x http://127.0.0.1:8888 -k --max-time 45 https://api.example.com/orders')
    expect(parsed.url).toBe('https://api.example.com/orders')
    expect(parsed.request_options).toEqual({ proxy: 'http://127.0.0.1:8888', verify_ssl: false, timeout_s: 45 })
  })

  it('leaves request_options out when none were given', () => {
    expect(parseCurlCommand('curl https://api.example.com').request_options).toBeUndefined()
  })

  it('exports the same settings back to cURL', () => {
    const command = toCurl(
      { method: 'GET', request_options: { timeout_s: 45, verify_ssl: false, proxy: 'http://127.0.0.1:8888' } },
      'https://api.example.com/orders',
    )
    expect(command).toContain('-L')
    expect(command).toContain('--max-time 45')
    expect(command).toContain('-k')
    expect(command).toContain("--proxy 'http://127.0.0.1:8888'")
    expect(toCurl({ method: 'GET', request_options: { follow_redirects: false } }, 'https://x.test')).not.toContain('-L')
  })
})
