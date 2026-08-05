/**
 * Robust cURL command parser for Beacon.
 * Tokenizes multi-line and single-line cURL commands into HTTP method,
 * target URL, headers map, and body payload (JSON or raw string).
 */

export interface ParsedCurl {
  url: string
  method: string
  headers: Record<string, string>
  payload: any
  payload_type: 'json' | 'raw' | 'form'
}

export function parseCurlCommand(curlString: string): ParsedCurl {
  if (!curlString || !curlString.trim()) {
    throw new Error('Empty cURL command')
  }

  // 1. Normalize line breaks and backslash continuation lines (\)
  const normalized = curlString
    .replace(/\\\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    throw new Error('Invalid cURL command')
  }

  // 2. Tokenize honoring quotes (single and double)
  const tokens: string[] = []
  let current = ''
  let inDouble = false
  let inSingle = false
  let escape = false

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i]

    if (escape) {
      current += char
      escape = false
      continue
    }

    if (char === '\\') {
      escape = true
      continue
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }

    if (char === ' ' && !inDouble && !inSingle) {
      if (current) tokens.push(current)
      current = ''
      continue
    }

    current += char
  }
  if (current) tokens.push(current)

  if (tokens.length === 0) {
    throw new Error('Could not parse cURL tokens')
  }

  let method = ''
  let url = ''
  const headers: Record<string, string> = {}
  let bodyRaw = ''

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    // Skip `curl` / `curl.exe`
    if (token === 'curl' || token === 'curl.exe') continue

    // Method flags
    if (token === '-X' || token === '--request') {
      if (tokens[i + 1]) {
        method = tokens[i + 1].toUpperCase()
        i++
      }
      continue
    }

    // Header flags
    if (token === '-H' || token === '--header') {
      const headerStr = tokens[i + 1] || ''
      const colonIdx = headerStr.indexOf(':')
      if (colonIdx > 0) {
        const key = headerStr.slice(0, colonIdx).trim()
        const val = headerStr.slice(colonIdx + 1).trim()
        headers[key] = val
      }
      i++
      continue
    }

    // Data / Body flags
    if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary' || token === '--data-urlencode') {
      bodyRaw = tokens[i + 1] || ''
      if (!method) method = 'POST'
      i++
      continue
    }

    // URL parameter (first non-flag token that isn't sub-parameter)
    if (!url && !token.startsWith('-')) {
      url = token
    }
  }

  if (!method) {
    method = bodyRaw ? 'POST' : 'GET'
  }

  // Sanitize URL (remove quotes if present)
  url = url.replace(/^['"]|['"]$/g, '')

  // Determine payload type
  let payload: any = bodyRaw
  let payload_type: 'json' | 'raw' | 'form' = 'raw'

  const contentTypeKey = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type')
  const contentTypeVal = contentTypeKey ? headers[contentTypeKey].toLowerCase() : ''

  if (bodyRaw) {
    const trimmedBody = bodyRaw.trim()
    if (contentTypeVal.includes('application/json') || (trimmedBody.startsWith('{') && trimmedBody.endsWith('}')) || (trimmedBody.startsWith('[') && trimmedBody.endsWith(']'))) {
      try {
        payload = JSON.parse(bodyRaw)
        payload_type = 'json'
      } catch {
        payload = bodyRaw
        payload_type = 'raw'
      }
    } else if (contentTypeVal.includes('application/x-www-form-urlencoded')) {
      payload_type = 'form'
    }
  }

  return {
    url,
    method,
    headers,
    payload,
    payload_type,
  }
}
