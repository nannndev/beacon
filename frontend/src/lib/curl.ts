// Build a copy-pasteable `curl` command from an endpoint form. Template tokens
// ({{var}}) are left literal so the user can substitute them. Best-effort — meant
// as a starting point to paste into a terminal, not a byte-exact reproduction.

interface CurlSource {
  method?: string
  headers?: Record<string, string>
  cookies?: Record<string, string>
  payload?: unknown
  payload_type?: string
}

function shellQuote(value: string): string {
  // Single-quote and escape embedded single quotes for POSIX shells.
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase())
}

export function toCurl(source: CurlSource, absoluteUrl: string): string {
  const method = (source.method || 'GET').toUpperCase()
  const headers = { ...(source.headers || {}) }
  const cookies = source.cookies || {}
  const payloadType = source.payload_type || 'json'
  const payload = source.payload

  const parts: string[] = [`curl -X ${method} ${shellQuote(absoluteUrl)}`]

  for (const [key, value] of Object.entries(headers)) {
    if (key && value != null) parts.push(`-H ${shellQuote(`${key}: ${value}`)}`)
  }

  const cookieStr = Object.entries(cookies)
    .filter(([k]) => k)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  if (cookieStr) parts.push(`-b ${shellQuote(cookieStr)}`)

  const bodyAllowed = method !== 'GET' && method !== 'HEAD'
  if (bodyAllowed && payload != null) {
    if (payloadType === 'form') {
      for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
        if (k) parts.push(`--data-urlencode ${shellQuote(`${k}=${v ?? ''}`)}`)
      }
    } else if (payloadType === 'multipart') {
      for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
        if (k) parts.push(`-F ${shellQuote(`${k}=${v ?? ''}`)}`)
      }
    } else {
      // json / raw
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
      if (body && body !== '{}' && body !== '""' && body !== 'null') {
        if (payloadType === 'json' && !hasHeader(headers, 'content-type')) {
          parts.push(`-H ${shellQuote('Content-Type: application/json')}`)
        }
        parts.push(`-d ${shellQuote(body)}`)
      }
    }
  }

  return parts.join(' \\\n  ')
}
