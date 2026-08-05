export interface CurlSource {
  method?: string
  headers?: Record<string, string>
  cookies?: Record<string, string>
  payload?: unknown
  payload_type?: string
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase())
}

export function toJsFetch(source: CurlSource, absoluteUrl: string): string {
  const method = (source.method || 'GET').toUpperCase()
  const headers = { ...(source.headers || {}) }
  const payloadType = source.payload_type || 'json'
  const payload = source.payload

  const cookies = source.cookies || {}
  const cookieStr = Object.entries(cookies)
    .filter(([k]) => k)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  if (cookieStr) {
    headers['Cookie'] = cookieStr
  }

  const options: Record<string, any> = {
    method,
  }

  const bodyAllowed = method !== 'GET' && method !== 'HEAD'
  let bodyCode = ''
  let customHeaders = { ...headers }

  if (bodyAllowed && payload != null) {
    if (payloadType === 'form') {
      const entries = Object.entries(payload as Record<string, unknown>).filter(([k]) => k)
      if (entries.length > 0) {
        bodyCode = `const params = new URLSearchParams();\n`
        for (const [k, v] of entries) {
          bodyCode += `params.append("${k}", "${String(v ?? '').replace(/"/g, '\\"')}");\n`
        }
        options.body = 'params'
        if (!hasHeader(customHeaders, 'content-type')) {
          customHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
        }
      }
    } else if (payloadType === 'multipart') {
      const entries = Object.entries(payload as Record<string, unknown>).filter(([k]) => k)
      if (entries.length > 0) {
        bodyCode = `const formData = new FormData();\n`
        for (const [k, v] of entries) {
          bodyCode += `formData.append("${k}", "${String(v ?? '').replace(/"/g, '\\"')}");\n`
        }
        options.body = 'formData'
        // The browser automatically adds content-type with boundary, so remove it
        delete customHeaders['Content-Type']
        delete customHeaders['content-type']
      }
    } else {
      // json / raw
      const bodyStr = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
      if (bodyStr && bodyStr !== '{}' && bodyStr !== '""' && bodyStr !== 'null') {
        if (payloadType === 'json') {
          if (!hasHeader(customHeaders, 'content-type')) {
            customHeaders['Content-Type'] = 'application/json'
          }
          bodyCode = `const payload = ${bodyStr};\n`
          options.body = 'JSON.stringify(payload)'
        } else {
          bodyCode = `const payload = \`${bodyStr.replace(/`/g, '\\`').replace(/\${/g, '\\${')}\`;\n`
          options.body = 'payload'
        }
      }
    }
  }

  options.headers = customHeaders

  let headersStr = ''
  if (Object.keys(customHeaders).length > 0) {
    headersStr = '  headers: {\n' + Object.entries(customHeaders)
      .map(([k, v]) => `    "${k}": "${String(v).replace(/"/g, '\\"')}"`)
      .join(',\n') + '\n  },'
  }

  let fetchCode = ''
  if (bodyCode) fetchCode += bodyCode + '\n'

  fetchCode += `fetch("${absoluteUrl}", {\n`
  fetchCode += `  method: "${method}",\n`
  if (headersStr) fetchCode += headersStr + '\n'
  if (options.body) fetchCode += `  body: ${options.body}\n`
  fetchCode += `})\n`
  fetchCode += `  .then(response => response.json())\n`
  fetchCode += `  .then(result => console.log(result))\n`
  fetchCode += `  .catch(error => console.error('Error:', error));`

  return fetchCode
}

export function toPythonRequests(source: CurlSource, absoluteUrl: string): string {
  const method = (source.method || 'GET').toUpperCase()
  const headers = { ...(source.headers || {}) }
  const payloadType = source.payload_type || 'json'
  const payload = source.payload

  const cookies = source.cookies || {}
  const cookieStr = Object.entries(cookies)
    .filter(([k]) => k)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  if (cookieStr) {
    headers['Cookie'] = cookieStr
  }

  let code = `import requests\n`
  if (payloadType === 'json' && payload != null) {
    code += `import json\n`
  }
  code += `\nurl = "${absoluteUrl}"\n\n`

  const bodyAllowed = method !== 'GET' && method !== 'HEAD'
  let payloadStr = ''
  let reqDataArg = ''

  if (bodyAllowed && payload != null) {
    if (payloadType === 'form') {
      const entries = Object.entries(payload as Record<string, unknown>).filter(([k]) => k)
      if (entries.length > 0) {
        payloadStr = `payload = {\n` + entries
          .map(([k, v]) => `    '${k}': '${String(v ?? '').replace(/'/g, "\\'")}'`)
          .join(',\n') + `\n}\n`
        reqDataArg = `, data=payload`
        if (!hasHeader(headers, 'content-type')) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded'
        }
      }
    } else if (payloadType === 'multipart') {
      const entries = Object.entries(payload as Record<string, unknown>).filter(([k]) => k)
      if (entries.length > 0) {
        payloadStr = `files = {\n` + entries
          .map(([k, v]) => `    '${k}': (None, '${String(v ?? '').replace(/'/g, "\\'")}')`)
          .join(',\n') + `\n}\n`
        reqDataArg = `, files=files`
        delete headers['Content-Type']
        delete headers['content-type']
      }
    } else {
      // json / raw
      const bodyStr = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
      if (bodyStr && bodyStr !== '{}' && bodyStr !== '""' && bodyStr !== 'null') {
        if (payloadType === 'json') {
          payloadStr = `payload = ${bodyStr}\n`
          reqDataArg = `, json=payload`
          if (!hasHeader(headers, 'content-type')) {
            headers['Content-Type'] = 'application/json'
          }
        } else {
          payloadStr = `payload = """${bodyStr}"""\n`
          reqDataArg = `, data=payload`
        }
      }
    }
  }

  let headersStr = ''
  if (Object.keys(headers).length > 0) {
    headersStr = `headers = {\n` + Object.entries(headers)
      .map(([k, v]) => `    '${k}': '${String(v).replace(/'/g, "\\'")}'`)
      .join(',\n') + `\n}\n`
  }

  if (payloadStr) code += payloadStr + '\n'
  if (headersStr) code += headersStr + '\n'

  code += `response = requests.request(\n`
  code += `    "${method}",\n`
  code += `    url`
  if (headersStr) code += `,\n    headers=headers`
  if (reqDataArg) code += `,\n    ${reqDataArg.replace(', ', '')}`
  code += `\n)\n\n`
  code += `print(response.status_code)\n`
  code += `print(response.text)\n`

  return code
}

export function toGoHttp(source: CurlSource, absoluteUrl: string): string {
  const method = (source.method || 'GET').toUpperCase()
  const headers = { ...(source.headers || {}) }
  const payloadType = source.payload_type || 'json'
  const payload = source.payload

  const cookies = source.cookies || {}
  const cookieStr = Object.entries(cookies)
    .filter(([k]) => k)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  if (cookieStr) {
    headers['Cookie'] = cookieStr
  }

  const bodyAllowed = method !== 'GET' && method !== 'HEAD'
  let payloadSetup = ''
  let readerSource = 'nil'

  if (bodyAllowed && payload != null) {
    if (payloadType === 'form') {
      const entries = Object.entries(payload as Record<string, unknown>).filter(([k]) => k)
      if (entries.length > 0) {
        const formVals = entries
          .map(([k, v]) => `data.Set("${k}", "${String(v ?? '').replace(/"/g, '\\"')}")`)
          .join('\n\t')
        payloadSetup = `data := url.Values{}\n\t${formVals}\n\tpayload := strings.NewReader(data.Encode())\n`
        readerSource = 'payload'
        if (!hasHeader(headers, 'content-type')) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded'
        }
      }
    } else if (payloadType === 'multipart') {
      const entries = Object.entries(payload as Record<string, unknown>).filter(([k]) => k)
      if (entries.length > 0) {
        payloadSetup = `payload := &bytes.Buffer{}\n\twriter := multipart.NewWriter(payload)\n`
        for (const [k, v] of entries) {
          payloadSetup += `\t_ = writer.WriteField("${k}", "${String(v ?? '').replace(/"/g, '\\"')}")\n`
        }
        payloadSetup += `\terr := writer.Close()\n\tif err != nil {\n\t\tfmt.Println(err)\n\t\treturn\n\t}\n`
        readerSource = 'payload'
        headers['Content-Type'] = 'writer.FormDataContentType()'
      }
    } else {
      const bodyStr = typeof payload === 'string' ? payload : JSON.stringify(payload)
      if (bodyStr && bodyStr !== '{}' && bodyStr !== '""' && bodyStr !== 'null') {
        payloadSetup = `payload := strings.NewReader(\`${bodyStr.replace(/`/g, '` + "`" + `')}\`)\n`
        readerSource = 'payload'
        if (payloadType === 'json' && !hasHeader(headers, 'content-type')) {
          headers['Content-Type'] = 'application/json'
        }
      }
    }
  }

  let code = `package main\n\nimport (\n`
  code += `\t"fmt"\n`
  code += `\t"io"\n`
  code += `\t"net/http"\n`
  if (payloadSetup.includes('strings.')) code += `\t"strings"\n`
  if (payloadSetup.includes('bytes.')) code += `\t"bytes"\n`
  if (payloadSetup.includes('multipart.')) code += `\t"mime/multipart"\n`
  if (payloadSetup.includes('url.Values')) code += `\t"net/url"\n`
  code += `)\n\nfunc main() {\n`
  code += `\turl := "${absoluteUrl}"\n`
  code += `\tmethod := "${method}"\n\n`

  if (payloadSetup) {
    code += `\t` + payloadSetup.replace(/\n/g, '\n\t').trim() + '\n\n'
  }

  code += `\tclient := &http.Client{}\n`
  code += `\treq, err := http.NewRequest(method, url, ${readerSource})\n`
  code += `\tif err != nil {\n\t\tfmt.Println(err)\n\t\treturn\n\t}\n`

  for (const [k, v] of Object.entries(headers)) {
    if (k && v != null) {
      if (v === 'writer.FormDataContentType()') {
        code += `\treq.Header.Set("${k}", writer.FormDataContentType())\n`
      } else {
        code += `\treq.Header.Add("${k}", "${String(v).replace(/"/g, '\\"')}")\n`
      }
    }
  }

  code += `\n\tres, err := client.Do(req)\n`
  code += `\tif err != nil {\n\t\tfmt.Println(err)\n\t\treturn\n\t}\n`
  code += `\tdefer res.Body.Close()\n\n`
  code += `\tbody, err := io.ReadAll(res.Body)\n`
  code += `\tif err != nil {\n\t\tfmt.Println(err)\n\t\treturn\n\t}\n`
  code += `\tfmt.Println(res.StatusCode)\n`
  code += `\tfmt.Println(string(body))\n}`

  return code
}

export function toRawHttp(source: CurlSource, absoluteUrl: string): string {
  const method = (source.method || 'GET').toUpperCase()
  const headers = { ...(source.headers || {}) }
  const payloadType = source.payload_type || 'json'
  const payload = source.payload

  let path = absoluteUrl
  let host = 'localhost'
  try {
    const parsedUrl = new URL(absoluteUrl)
    path = parsedUrl.pathname + parsedUrl.search
    host = parsedUrl.host
  } catch (e) {
    // Fallback if URL is a path template relative to base
  }

  const cookies = source.cookies || {}
  const cookieStr = Object.entries(cookies)
    .filter(([k]) => k)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  if (cookieStr) {
    headers['Cookie'] = cookieStr
  }

  if (!hasHeader(headers, 'host')) {
    headers['Host'] = host
  }

  const bodyAllowed = method !== 'GET' && method !== 'HEAD'
  let bodyStr = ''

  if (bodyAllowed && payload != null) {
    if (payloadType === 'form') {
      bodyStr = Object.entries(payload as Record<string, unknown>)
        .filter(([k]) => k)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ''))}`)
        .join('&')
      if (!hasHeader(headers, 'content-type')) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
    } else if (payloadType === 'multipart') {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
      headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`
      bodyStr = Object.entries(payload as Record<string, unknown>)
        .filter(([k]) => k)
        .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v ?? ''}`)
        .join('\r\n') + `\r\n--${boundary}--\r\n`
    } else {
      bodyStr = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
      if (payloadType === 'json' && !hasHeader(headers, 'content-type')) {
        headers['Content-Type'] = 'application/json'
      }
    }
  }

  if (bodyStr && !hasHeader(headers, 'content-length')) {
    headers['Content-Length'] = String(new TextEncoder().encode(bodyStr).length)
  }

  let raw = `${method} ${path} HTTP/1.1\n`
  raw += Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  raw += '\n\n'
  if (bodyStr) raw += bodyStr

  return raw
}
