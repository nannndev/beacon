import { CollectionItem, Endpoint, Environment } from '../types'
import { parseQueryParams } from './queryParams'
import { toCurl } from './curl'
import { toJsFetch, toPythonRequests } from './codeSnippets'

export type ProjectExportFormat = 'html' | 'beacon' | 'openapi' | 'postman' | 'markdown'

export interface ExportedProjectEnvelope {
  format: string
  version: number
  project: {
    name: string
    environments: Array<{
      name: string
      base_url: string
      variables: Record<string, string>
    }>
    items: CollectionItem[]
  }
  secrets_included?: boolean
}

export interface FlattenedEndpointItem {
  folderPath: string[]
  endpoint: Endpoint
}

export function flattenExportItems(items: CollectionItem[] = [], parentPath: string[] = []): FlattenedEndpointItem[] {
  const out: FlattenedEndpointItem[] = []
  for (const item of items) {
    if (item.type === 'folder') {
      out.push(...flattenExportItems(item.items || [], [...parentPath, item.name || 'Folder']))
    } else {
      out.push({
        folderPath: parentPath,
        endpoint: item as unknown as Endpoint,
      })
    }
  }
  return out
}

export function slugifyFileName(name: string): string {
  return (name || 'project')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'project'
}

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function highlightJsonHtml(jsonStr: string): string {
  if (!jsonStr) return ''
  const safe = String(jsonStr)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return safe.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\\-]?\d+)?|[{}[\],:])/g,
    (match) => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          const key = match.slice(0, -1)
          return `<span class="hl-key">${key}</span><span class="hl-punct">:</span>`
        }
        return `<span class="hl-string">${match}</span>`
      }
      if (/true|false/.test(match)) return `<span class="hl-bool">${match}</span>`
      if (/null/.test(match)) return `<span class="hl-null">${match}</span>`
      if (/-?\d/.test(match)) return `<span class="hl-number">${match}</span>`
      if (/[{}[\],:]/.test(match)) return `<span class="hl-punct">${match}</span>`
      return match
    },
  )
}

function resolveFullUrl(baseUrl: string, pathUrl: string): string {
  const url = (pathUrl || '').trim()
  if (!url) return baseUrl || 'https://api.example.com'
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(url)) return url
  const base = (baseUrl || 'https://api.example.com').replace(/\/$/, '')
  return `${base}/${url.replace(/^\//, '')}`
}

function inferJsonSchema(value: unknown): Record<string, unknown> {
  if (value === null) return { type: 'string', nullable: true }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      items: value.length > 0 ? inferJsonSchema(value[0]) : { type: 'string' },
    }
  }
  if (typeof value === 'object') {
    const properties: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      properties[k] = inferJsonSchema(v)
    }
    return { type: 'object', properties }
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'integer', example: value } : { type: 'number', example: value }
  }
  if (typeof value === 'boolean') return { type: 'boolean', example: value }
  return { type: 'string', example: String(value) }
}

function describeAuth(ep: Endpoint): string {
  const auth = ep.auth
  if (auth?.type === 'bearer') return `Bearer Token (${auth.token || '{{access_token}}'})`
  if (auth?.type === 'apikey') return `API Key in ${auth.in || 'header'}: ${auth.key || 'X-API-Key'}`
  if (auth?.type === 'basic') return `Basic Auth (${auth.username || 'username'})`
  if (auth?.type === 'custom') return `Custom (${auth.header || 'Authorization'}: ${auth.value || ''})`
  if (auth?.type === 'none') return 'None'
  if (ep.headers?.Authorization) return `Header (${ep.headers.Authorization})`
  return 'Inherit / Default'
}

// ---- OpenAPI 3.0.3 Generator ------------------------------------------------

export function generateOpenApiSpec(envelope: ExportedProjectEnvelope): Record<string, unknown> {
  const project = envelope.project
  const flat = flattenExportItems(project.items || [])
  const envs = project.environments || []

  const servers = envs
    .filter((e) => e.base_url)
    .map((e) => ({
      url: e.base_url,
      description: e.name || 'Environment',
    }))
  if (servers.length === 0) {
    servers.push({ url: 'https://api.example.com', description: 'Default Server' })
  }

  const paths: Record<string, Record<string, unknown>> = {}
  const tagsSet = new Set<string>()

  for (const { folderPath, endpoint } of flat) {
    const rawUrl = endpoint.url || '/'
    let pathPart = rawUrl
    if (/^https?:\/\//i.test(rawUrl)) {
      try {
        const parsed = new URL(rawUrl)
        pathPart = parsed.pathname || '/'
      } catch {
        pathPart = '/' + rawUrl.replace(/^https?:\/\/[^/]+\/?/, '')
      }
    } else {
      pathPart = rawUrl.split('?')[0] || '/'
    }
    if (!pathPart.startsWith('/')) pathPart = '/' + pathPart

    const pathParams: string[] = []
    pathPart = pathPart.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, varName: string) => {
      if (!pathParams.includes(varName)) pathParams.push(varName)
      return `{${varName}}`
    })

    const method = (endpoint.method || 'GET').toLowerCase()
    const tag = folderPath.length > 0 ? folderPath.join(' / ') : 'General'
    tagsSet.add(tag)

    const queryParams = parseQueryParams(rawUrl)
    const parameters: Array<Record<string, unknown>> = []

    for (const pName of pathParams) {
      parameters.push({
        name: pName,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })
    }

    for (const qp of queryParams) {
      if (!qp.key) continue
      parameters.push({
        name: qp.key,
        in: 'query',
        required: false,
        schema: { type: 'string', default: qp.value },
      })
    }

    for (const [hk, hv] of Object.entries(endpoint.headers || {})) {
      if (!hk || hk.toLowerCase() === 'content-type' || hk.toLowerCase() === 'authorization') continue
      parameters.push({
        name: hk,
        in: 'header',
        required: false,
        schema: { type: 'string', default: String(hv) },
      })
    }

    const operation: Record<string, unknown> = {
      summary: endpoint.name || `${endpoint.method} ${pathPart}`,
      tags: [tag],
      parameters: parameters.length > 0 ? parameters : undefined,
      responses: {
        '200': {
          description: 'Successful response',
        },
      },
    }

    if (endpoint.mock_response?.body) {
      const statusCode = String(endpoint.mock_response.status || 200)
      const mockHeaders = endpoint.mock_response.headers || {}
      const respCt = mockHeaders['content-type'] || mockHeaders['Content-Type'] || 'application/json'
      let parsedExample: unknown = endpoint.mock_response.body
      let schema: Record<string, unknown> = { type: 'string' }
      try {
        parsedExample = JSON.parse(endpoint.mock_response.body)
        schema = inferJsonSchema(parsedExample)
      } catch {
        // use raw string
      }
      operation.responses = {
        [statusCode]: {
          description: statusCode.startsWith('2') ? 'Documented example baseline' : `Response (${statusCode})`,
          content: {
            [respCt.split(';')[0].trim()]: {
              schema,
              example: parsedExample,
            },
          },
        },
      }
    }

    const hasBody = !['get', 'head'].includes(method) && endpoint.payload_type !== 'none'
    if (hasBody && endpoint.payload && Object.keys(endpoint.payload).length > 0) {
      const contentType =
        endpoint.payload_type === 'form'
          ? 'application/x-www-form-urlencoded'
          : endpoint.payload_type === 'multipart'
          ? 'multipart/form-data'
          : 'application/json'
      operation.requestBody = {
        required: true,
        content: {
          [contentType]: {
            schema: inferJsonSchema(endpoint.payload),
            example: endpoint.payload,
          },
        },
      }
    }

    if (!paths[pathPart]) paths[pathPart] = {}
    paths[pathPart][method] = operation
  }

  return {
    openapi: '3.0.3',
    info: {
      title: project.name || 'Beacon API Project',
      version: '1.0.0',
      description: `Exported from Beacon API Workspace (${flat.length} endpoints across ${envs.length} environments).`,
    },
    servers,
    tags: Array.from(tagsSet).map((name) => ({ name })),
    paths,
  }
}

// ---- Postman Collection v2.1 Generator --------------------------------------

export function generatePostmanCollection(envelope: ExportedProjectEnvelope): Record<string, unknown> {
  const project = envelope.project
  const firstEnv = project.environments?.[0]
  const baseUrl = firstEnv?.base_url || '{{base_url}}'

  const convertNode = (node: CollectionItem): Record<string, unknown> => {
    if (node.type === 'folder') {
      return {
        name: node.name || 'Folder',
        item: (node.items || []).map(convertNode),
      }
    }
    const ep = node as unknown as Endpoint
    const rawUrl = ep.url || '/'
    const fullUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl)
      ? rawUrl
      : `{{base_url}}/${rawUrl.replace(/^\//, '')}`

    const header = Object.entries(ep.headers || {})
      .filter(([k]) => Boolean(k))
      .map(([key, value]) => ({ key, value: String(value) }))

    let body: Record<string, unknown> | undefined
    if (ep.payload_type === 'form') {
      body = {
        mode: 'urlencoded',
        urlencoded: Object.entries(ep.payload || {}).map(([key, value]) => ({
          key,
          value: String(value),
          type: 'text',
        })),
      }
    } else if (ep.payload_type === 'raw') {
      body = {
        mode: 'raw',
        raw: typeof ep.payload === 'string' ? ep.payload : JSON.stringify(ep.payload || {}, null, 2),
      }
    } else if (ep.payload && Object.keys(ep.payload).length > 0) {
      body = {
        mode: 'raw',
        raw: JSON.stringify(ep.payload, null, 2),
        options: { raw: { language: 'json' } },
      }
    }

    const responseExamples: Array<Record<string, unknown>> = []
    if (ep.mock_response?.body) {
      const mockHeaders = Object.entries(ep.mock_response.headers || {}).map(([key, value]) => ({
        key,
        value: String(value),
      }))
      const statusCode = ep.mock_response.status || 200
      responseExamples.push({
        name: `${statusCode} Documented Example`,
        originalRequest: {
          method: ep.method || 'GET',
          header,
          ...(body ? { body } : {}),
          url: { raw: fullUrl },
        },
        status: statusCode === 200 ? 'OK' : String(statusCode),
        code: statusCode,
        _postman_previewlanguage: 'json',
        header: mockHeaders,
        body: ep.mock_response.body,
      })
    }

    return {
      name: ep.name || 'Request',
      request: {
        method: ep.method || 'GET',
        header,
        ...(body ? { body } : {}),
        url: {
          raw: fullUrl,
        },
      },
      response: responseExamples,
    }
  }

  const variables: Array<{ key: string; value: string }> = [
    { key: 'base_url', value: baseUrl === '{{base_url}}' ? 'https://api.example.com' : baseUrl },
  ]
  if (firstEnv?.variables) {
    for (const [k, v] of Object.entries(firstEnv.variables)) {
      if (k && k !== 'base_url') variables.push({ key: k, value: String(v ?? '') })
    }
  }

  return {
    info: {
      name: project.name || 'Beacon Project',
      description: 'Exported from Beacon API Workspace',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: (project.items || []).map(convertNode),
    variable: variables,
  }
}

// ---- Markdown Documentation Generator ---------------------------------------

export function generateMarkdownDocs(envelope: ExportedProjectEnvelope): string {
  const project = envelope.project
  const envs = project.environments || []
  const flat = flattenExportItems(project.items || [])
  const primaryBaseUrl = envs.find((e) => e.base_url)?.base_url || 'https://api.example.com'

  const lines: string[] = []
  lines.push(`# ${project.name || 'API Documentation'}`)
  lines.push('')
  lines.push(`> Generated by **Beacon API Workspace** · ${flat.length} endpoint${flat.length === 1 ? '' : 's'} · ${envs.length} environment${envs.length === 1 ? '' : 's'}`)
  lines.push('')

  if (envs.length > 0) {
    lines.push('## Environments')
    lines.push('')
    lines.push('| Environment | Base URL | Variables |')
    lines.push('| --- | --- | --- |')
    for (const env of envs) {
      const varKeys = Object.keys(env.variables || {}).filter(Boolean)
      const varsDisplay = varKeys.length ? varKeys.map((k) => `\`{{${k}}}\``).join(', ') : '—'
      lines.push(`| **${env.name || 'Environment'}** | \`${env.base_url || '—'}\` | ${varsDisplay} |`)
    }
    lines.push('')
  }

  lines.push('## Endpoints Summary')
  lines.push('')
  lines.push('| # | Folder | Method | Name | Path / URL |')
  lines.push('| --- | --- | --- | --- | --- |')
  flat.forEach(({ folderPath, endpoint }, idx) => {
    const folder = folderPath.length ? folderPath.join(' / ') : 'Root'
    lines.push(`| ${idx + 1} | ${folder} | \`${endpoint.method}\` | **${endpoint.name}** | \`${endpoint.url}\` |`)
  })
  lines.push('')

  lines.push('---')
  lines.push('')
  lines.push('## Endpoint Reference')
  lines.push('')

  flat.forEach(({ folderPath, endpoint }, idx) => {
    const fullUrl = resolveFullUrl(primaryBaseUrl, endpoint.url)
    const folderLabel = folderPath.length ? `${folderPath.join(' / ')} / ` : ''
    lines.push(`### ${idx + 1}. \`${endpoint.method}\` ${folderLabel}${endpoint.name}`)
    lines.push('')
    lines.push(`- **Path / URL:** \`${endpoint.url}\``)
    lines.push(`- **Resolved URL:** \`${fullUrl}\``)
    lines.push(`- **Target Type:** \`${(endpoint.target_type || 'api').toUpperCase()}\``)
    lines.push(`- **Authorization:** ${describeAuth(endpoint)}`)
    lines.push('')

    const queryParams = parseQueryParams(endpoint.url || '').filter((q) => q.key)
    if (queryParams.length > 0) {
      lines.push('#### Query Parameters')
      lines.push('')
      lines.push('| Parameter | Value |')
      lines.push('| --- | --- |')
      for (const qp of queryParams) {
        lines.push(`| \`${qp.key}\` | \`${qp.value}\` |`)
      }
      lines.push('')
    }

    const headers = Object.entries(endpoint.headers || {}).filter(([k]) => Boolean(k))
    if (headers.length > 0) {
      lines.push('#### Headers')
      lines.push('')
      lines.push('| Header | Value |')
      lines.push('| --- | --- |')
      for (const [hk, hv] of headers) {
        lines.push(`| \`${hk}\` | \`${hv}\` |`)
      }
      lines.push('')
    }

    const hasPayload =
      endpoint.payload_type !== 'none' &&
      endpoint.payload &&
      (typeof endpoint.payload === 'string'
        ? endpoint.payload.trim().length > 0
        : Object.keys(endpoint.payload).length > 0)

    if (hasPayload) {
      lines.push(`#### Request Body (\`${endpoint.payload_type || 'json'}\`)`)
      lines.push('')
      const bodyStr =
        typeof endpoint.payload === 'string'
          ? endpoint.payload
          : JSON.stringify(endpoint.payload, null, 2)
      lines.push('```json')
      lines.push(bodyStr)
      lines.push('```')
      lines.push('')
    }

    const extractors = Object.entries(endpoint.extractors || {}).filter(([k]) => Boolean(k))
    if (extractors.length > 0) {
      lines.push('#### Response Extractors')
      lines.push('')
      for (const [varName, sourcePath] of extractors) {
        lines.push(`- \`{{${varName}}}\` ← \`${sourcePath}\``)
      }
      lines.push('')
    }

    if (endpoint.mock_response?.body) {
      lines.push(`#### Documented Example Response (${endpoint.mock_response.status || 200})`)
      lines.push('')
      lines.push('```json')
      lines.push(endpoint.mock_response.body)
      lines.push('```')
      lines.push('')
    }

    const curl = toCurl(endpoint as any, fullUrl)
    lines.push('#### Example cURL')
    lines.push('')
    lines.push('```bash')
    lines.push(curl)
    lines.push('```')
    lines.push('')
  })

  return lines.join('\n')
}

// ---- Interactive HTML API Explorer & Preview UI Generator -------------------

export function generateInteractiveHtmlDocs(envelope: ExportedProjectEnvelope): string {
  const project = envelope.project
  const envs: Array< Pick<Environment, 'name' | 'base_url' | 'variables'>> =
    project.environments?.length
      ? project.environments
      : [{ name: 'Default', base_url: 'https://api.example.com', variables: {} }]
  const flat = flattenExportItems(project.items || [])
  const defaultBaseUrl = envs[0]?.base_url || 'https://api.example.com'

  // Group by folder path for sidebar navigation
  const groups = new Map<string, Array<{ index: number; endpoint: Endpoint }>>()
  flat.forEach(({ folderPath, endpoint }, index) => {
    const groupName = folderPath.length ? folderPath.join(' / ') : 'Endpoints'
    if (!groups.has(groupName)) groups.set(groupName, [])
    groups.get(groupName)!.push({ index, endpoint })
  })

  const methodColors: Record<string, { bg: string; text: string; border: string }> = {
    GET: { bg: 'rgba(16, 185, 129, 0.14)', text: '#34d399', border: 'rgba(16, 185, 129, 0.35)' },
    POST: { bg: 'rgba(6, 182, 212, 0.14)', text: '#22d3ee', border: 'rgba(6, 182, 212, 0.35)' },
    PUT: { bg: 'rgba(245, 158, 11, 0.14)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.35)' },
    PATCH: { bg: 'rgba(139, 92, 246, 0.14)', text: '#a78bfa', border: 'rgba(139, 92, 246, 0.35)' },
    DELETE: { bg: 'rgba(239, 68, 68, 0.14)', text: '#f87171', border: 'rgba(239, 68, 68, 0.35)' },
  }

  const sidebarHtml = Array.from(groups.entries())
    .map(([groupName, entries]) => {
      const itemsHtml = entries
        .map(({ index, endpoint }) => {
          const m = (endpoint.method || 'GET').toUpperCase()
          const mc = methodColors[m] || methodColors.GET
          return `
            <a href="#ep-${index}" class="nav-item" data-method="${escapeHtml(m)}" data-search="${escapeHtml((endpoint.name + ' ' + endpoint.url + ' ' + m + ' ' + groupName).toLowerCase())}">
              <span class="method-pill" style="background:${mc.bg};color:${mc.text};border-color:${mc.border}">${escapeHtml(m)}</span>
              <span class="nav-name">${escapeHtml(endpoint.name || 'Untitled')}</span>
            </a>`
        })
        .join('')
      return `
        <div class="nav-group">
          <div class="nav-group-title">${escapeHtml(groupName)} <span>(${entries.length})</span></div>
          ${itemsHtml}
        </div>`
    })
    .join('')

  const cardsHtml = flat
    .map(({ folderPath, endpoint }, index) => {
      const m = (endpoint.method || 'GET').toUpperCase()
      const mc = methodColors[m] || methodColors.GET
      const fullUrl = resolveFullUrl(defaultBaseUrl, endpoint.url)
      const folderBadge = folderPath.length ? folderPath.join(' / ') : 'Root'
      const queryParams = parseQueryParams(endpoint.url || '').filter((q) => q.key)
      const headers = Object.entries(endpoint.headers || {}).filter(([k]) => Boolean(k))
      const extractors = Object.entries(endpoint.extractors || {}).filter(([k]) => Boolean(k))
      const assertions = endpoint.assertions || []

      const hasPayload =
        endpoint.payload_type !== 'none' &&
        endpoint.payload &&
        (typeof endpoint.payload === 'string'
          ? endpoint.payload.trim().length > 0
          : Object.keys(endpoint.payload).length > 0)

      const payloadFormatted = hasPayload
        ? typeof endpoint.payload === 'string'
          ? endpoint.payload
          : JSON.stringify(endpoint.payload, null, 2)
        : ''

      const curlSnippet = toCurl(endpoint as any, fullUrl)
      const jsSnippet = toJsFetch(endpoint as any, fullUrl)
      const pySnippet = toPythonRequests(endpoint as any, fullUrl)

      return `
      <article id="ep-${index}" class="ep-card" data-method="${escapeHtml(m)}" data-raw-url="${escapeHtml(endpoint.url || '/')}" data-search="${escapeHtml((endpoint.name + ' ' + endpoint.url + ' ' + m + ' ' + folderBadge).toLowerCase())}">
        <div class="ep-header">
          <div class="ep-meta">
            <span class="method-badge" style="background:${mc.bg};color:${mc.text};border-color:${mc.border}">${escapeHtml(m)}</span>
            <span class="folder-tag">${escapeHtml(folderBadge)}</span>
            <span class="target-tag">${escapeHtml((endpoint.target_type || 'api').toUpperCase())}</span>
            ${endpoint.payload_type && endpoint.payload_type !== 'none' ? `<span class="target-tag">${escapeHtml(endpoint.payload_type.toUpperCase())}</span>` : ''}
          </div>
          <h3 class="ep-title">${escapeHtml(endpoint.name || 'Endpoint')}</h3>
          <div class="url-bar">
            <code class="url-resolved" data-url-template="${escapeHtml(endpoint.url || '/')}">${escapeHtml(fullUrl)}</code>
            <button type="button" class="copy-btn" onclick="copyText(this, this.previousElementSibling.textContent)">Copy URL</button>
          </div>
        </div>

        <div class="ep-body">
          <div class="ep-grid">
            <div class="ep-col">
              <div class="sec-label">Authorization</div>
              <div class="info-box font-mono">${escapeHtml(describeAuth(endpoint))}</div>

              ${
                queryParams.length > 0
                  ? `
                <div class="sec-label">Query Parameters (${queryParams.length})</div>
                <table class="kv-table">
                  <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
                  <tbody>
                    ${queryParams.map((q) => `<tr><td class="k">${escapeHtml(q.key)}</td><td class="v">${escapeHtml(q.value)}</td></tr>`).join('')}
                  </tbody>
                </table>`
                  : ''
              }

              ${
                headers.length > 0
                  ? `
                <div class="sec-label">Headers (${headers.length})</div>
                <table class="kv-table">
                  <thead><tr><th>Header</th><th>Value</th></tr></thead>
                  <tbody>
                    ${headers.map(([hk, hv]) => `<tr><td class="k">${escapeHtml(hk)}</td><td class="v">${escapeHtml(String(hv))}</td></tr>`).join('')}
                  </tbody>
                </table>`
                  : '<div class="sec-label">Headers</div><div class="empty-note">No custom headers configured.</div>'
              }

              ${
                extractors.length > 0
                  ? `
                <div class="sec-label">Response Extractors (${extractors.length})</div>
                <table class="kv-table">
                  <thead><tr><th>Variable</th><th>Source Path</th></tr></thead>
                  <tbody>
                    ${extractors.map(([vk, vp]) => `<tr><td class="k">{{${escapeHtml(vk)}}}</td><td class="v">${escapeHtml(String(vp))}</td></tr>`).join('')}
                  </tbody>
                </table>`
                  : ''
              }

              ${
                assertions.length > 0
                  ? `
                <div class="sec-label">Assertions (${assertions.length})</div>
                <div class="chips">
                  ${assertions.map((a: any) => `<span class="chip">${escapeHtml(`${a.type} ${a.op} ${JSON.stringify(a.value ?? '')}`)}</span>`).join('')}
                </div>`
                  : ''
              }
            </div>

            <div class="ep-col">
              ${
                hasPayload
                  ? `
                <div class="code-panel">
                  <div class="code-panel-head">
                    <span>Request Payload (${escapeHtml((endpoint.payload_type || 'json').toUpperCase())})</span>
                    <button type="button" class="copy-btn" onclick="copyCodeBlock(this)">Copy JSON</button>
                  </div>
                  <pre class="code-pre json-highlight">${highlightJsonHtml(payloadFormatted)}</pre>
                </div>`
                  : '<div class="sec-label">Request Payload</div><div class="empty-note">No request body for this endpoint.</div>'
              }

              ${
                endpoint.mock_response?.body
                  ? `
                <div class="code-panel" style="margin-top:12px">
                  <div class="code-panel-head">
                    <span style="display:inline-flex;align-items:center;gap:6px">
                      <span style="color:#10b981;font-weight:700">● Documented Response Example</span>
                      <span class="chip" style="font-size:10px;padding:1px 6px">HTTP ${endpoint.mock_response.status || 200}</span>
                    </span>
                    <button type="button" class="copy-btn" onclick="copyCodeBlock(this)">Copy Response</button>
                  </div>
                  <pre class="code-pre json-highlight">${highlightJsonHtml(endpoint.mock_response.body)}</pre>
                </div>`
                  : ''
              }

              <div class="code-panel" style="margin-top:12px">
                <div class="code-panel-head">
                  <div class="snippet-tabs">
                    <button type="button" class="snip-tab active" onclick="switchSnippet(this, 'curl-${index}')">cURL</button>
                    <button type="button" class="snip-tab" onclick="switchSnippet(this, 'js-${index}')">Fetch (JS)</button>
                    <button type="button" class="snip-tab" onclick="switchSnippet(this, 'py-${index}')">Python</button>
                  </div>
                  <button type="button" class="copy-btn" onclick="copyActiveSnippet(this)">Copy Snippet</button>
                </div>
                <pre id="curl-${index}" class="code-pre snippet-pane">${escapeHtml(curlSnippet)}</pre>
                <pre id="js-${index}" class="code-pre snippet-pane hidden">${escapeHtml(jsSnippet)}</pre>
                <pre id="py-${index}" class="code-pre snippet-pane hidden">${escapeHtml(pySnippet)}</pre>
              </div>

              <div class="code-panel" style="margin-top:12px">
                <div class="code-panel-head">
                  <span style="display:inline-flex;align-items:center;gap:6px">
                    <span style="color:#06b6d4;font-size:12px">⚡</span>
                    <span>Interactive Playground</span>
                  </span>
                  <button
                    type="button"
                    class="action-btn-sm btn-send"
                    data-ep-index="${index}"
                    data-ep-method="${escapeHtml(m)}"
                    data-ep-url="${escapeHtml(endpoint.url || '/')}"
                    onclick="sendLiveRequest(this)"
                  >
                    Send Live Request
                  </button>
                </div>
                <div id="live-container-${index}" class="playground-output hidden">
                  <div class="playground-status-bar" id="live-meta-${index}"></div>
                  <pre id="live-res-${index}" class="code-pre playground-pre"></pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>`
    })
    .join('\n')

  const envsJson = JSON.stringify(envs).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(project.name || 'API Explorer')} — Beacon API Preview</title>
  <style>
    :root, [data-theme="dark"] {
      --bg: #070a10;
      --surface: #0d121c;
      --surface-2: #131b29;
      --border: #1e293b;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --accent: #06b6d4;
      --code-bg: #05070b;
    }
    [data-theme="light"] {
      --bg: #f8fafc;
      --surface: #ffffff;
      --surface-2: #f1f5f9;
      --border: #e2e8f0;
      --text: #0f172a;
      --muted: #64748b;
      --accent: #0284c7;
      --code-bg: #0f172a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .layout {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      min-height: 100vh;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position: static !important; height: auto !important; border-right: none !important; border-bottom: 1px solid var(--border); }
    }
    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 18px 14px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .brand-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 12px var(--accent);
    }
    .brand-title { font-weight: 800; font-size: 14px; letter-spacing: -0.01em; }
    .brand-sub { font-size: 11px; color: var(--muted); }
    .search-box {
      width: 100%;
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 8px;
      padding: 7px 10px;
      font-size: 12px;
      outline: none;
    }
    .search-box:focus { border-color: var(--accent); }
    .method-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .filter-btn {
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: 6px;
      padding: 3px 7px;
      font-size: 10px;
      font-weight: 700;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      cursor: pointer;
    }
    .filter-btn.active {
      border-color: var(--accent);
      color: var(--accent);
      background: rgba(6, 182, 212, 0.12);
    }
    .nav-group-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin: 8px 4px 6px;
      display: flex;
      justify-content: space-between;
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 7px;
      text-decoration: none;
      color: var(--text);
      font-size: 12px;
      transition: background 0.15s;
    }
    .nav-item:hover { background: var(--surface-2); }
    .nav-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .method-pill {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 9px;
      font-weight: 800;
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid transparent;
      flex-shrink: 0;
      min-width: 38px;
      text-align: center;
    }
    .main {
      padding: 24px 32px 64px;
      max-width: 1180px;
      width: 100%;
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px 20px;
      margin-bottom: 20px;
    }
    .topbar h1 { margin: 0; font-size: 20px; font-weight: 800; }
    .topbar-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .topbar-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .env-select, .action-btn {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 11px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .env-bar {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 16px;
      margin-bottom: 20px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 12px;
    }
    .env-bar-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 280px;
    }
    .base-url-input-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
      max-width: 520px;
    }
    .base-url-input {
      width: 100%;
      background: var(--surface-2);
      color: var(--accent);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      font-weight: 600;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .base-url-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .action-btn-sm {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 9px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s;
    }
    .action-btn-sm:hover { background: var(--border); }
    .btn-send {
      background: rgba(6, 182, 212, 0.15);
      color: #22d3ee;
      border-color: rgba(6, 182, 212, 0.35);
    }
    .btn-send:hover { background: rgba(6, 182, 212, 0.25); }
    .env-url {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--accent);
      font-weight: 600;
    }
    .ep-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      margin-bottom: 20px;
      overflow: hidden;
      box-shadow: 0 4px 20px -12px rgba(0, 0, 0, 0.35);
    }
    .ep-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      background: var(--surface-2);
    }
    .ep-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .method-badge {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      font-weight: 800;
      padding: 3px 9px;
      border-radius: 6px;
      border: 1px solid transparent;
    }
    .folder-tag, .target-tag {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .ep-title { margin: 0 0 10px; font-size: 16px; font-weight: 700; }
    .url-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: var(--code-bg);
      color: #e2e8f0;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      overflow-x: auto;
    }
    .ep-body { padding: 18px 20px; }
    .ep-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 18px;
    }
    .sec-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin: 12px 0 6px;
    }
    .sec-label:first-child { margin-top: 0; }
    .info-box, .empty-note {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 11px;
      font-size: 12px;
      color: var(--muted);
    }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text); }
    .kv-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      font-size: 12px;
    }
    .kv-table th, .kv-table td {
      padding: 7px 10px;
      border-bottom: 1px solid var(--border);
      text-align: left;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .kv-table th {
      background: var(--surface-2);
      color: var(--muted);
      font-size: 10px;
      text-transform: uppercase;
    }
    .kv-table td.k { color: #38bdf8; font-weight: 600; width: 38%; }
    .kv-table td.v { word-break: break-all; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 3px 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
    }
    .code-panel {
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: var(--code-bg);
      color: #f8fafc;
    }
    .code-panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 12px;
      background: rgba(255, 255, 255, 0.04);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
    }
    .code-pre {
      margin: 0;
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11.5px;
      line-height: 1.55;
      max-height: 380px;
      overflow-y: auto;
      overflow-x: auto;
      white-space: pre;
      word-break: normal;
      color: #e2e8f0;
      tab-size: 2;
    }
    .playground-output {
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .playground-status-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 11px;
    }
    .playground-pre {
      max-height: 360px;
      overflow-y: auto;
      overflow-x: auto;
      white-space: pre;
      word-break: normal;
      padding: 12px;
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11.5px;
      line-height: 1.55;
      background: var(--code-bg);
      color: #f1f5f9;
    }
    .status-badge {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10.5px;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .status-2xx {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .status-3xx, .status-4xx {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .status-5xx, .status-err {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .status-loading {
      color: #38bdf8;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      font-size: 11px;
    }
    .meta-pill {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      color: var(--muted);
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1px 6px;
    }
    /* Syntax Highlighting */
    .hl-key { color: #38bdf8; font-weight: 600; }
    .hl-string { color: #34d399; }
    .hl-number { color: #fbbf24; }
    .hl-bool { color: #c084fc; font-weight: 600; }
    .hl-null { color: #94a3b8; font-style: italic; }
    .hl-punct { color: #64748b; }

    [data-theme="light"] .hl-key { color: #0284c7; font-weight: 600; }
    [data-theme="light"] .hl-string { color: #059669; }
    [data-theme="light"] .hl-number { color: #d97706; }
    [data-theme="light"] .hl-bool { color: #7c3aed; font-weight: 600; }
    [data-theme="light"] .hl-null { color: #64748b; font-style: italic; }
    [data-theme="light"] .hl-punct { color: #94a3b8; }

    /* Custom Scrollbars */
    .code-pre::-webkit-scrollbar,
    .sidebar::-webkit-scrollbar,
    .playground-pre::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    .code-pre::-webkit-scrollbar-track,
    .sidebar::-webkit-scrollbar-track,
    .playground-pre::-webkit-scrollbar-track {
      background: transparent;
    }
    .code-pre::-webkit-scrollbar-thumb,
    .sidebar::-webkit-scrollbar-thumb,
    .playground-pre::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 4px;
    }
    .code-pre::-webkit-scrollbar-thumb:hover,
    .sidebar::-webkit-scrollbar-thumb:hover,
    .playground-pre::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.28);
    }
    [data-theme="light"] .code-pre::-webkit-scrollbar-thumb,
    [data-theme="light"] .playground-pre::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.18);
    }

    .snippet-tabs { display: flex; gap: 4px; }
    .snip-tab {
      background: transparent;
      border: none;
      color: #94a3b8;
      padding: 3px 8px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .snip-tab.active { background: rgba(6, 182, 212, 0.2); color: #22d3ee; }
    .copy-btn {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #e2e8f0;
      border-radius: 6px;
      padding: 3px 9px;
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      flex-shrink: 0;
    }
    .copy-btn:hover { background: rgba(255, 255, 255, 0.15); }
    .hidden { display: none !important; }
    @media print {
      .sidebar, .topbar-controls, .copy-btn { display: none !important; }
      .layout { display: block; }
      .ep-card { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-dot"></span>
        <div>
          <div class="brand-title">${escapeHtml(project.name || 'Beacon API')}</div>
          <div class="brand-sub">${flat.length} endpoints · Beacon Explorer</div>
        </div>
      </div>

      <input
        type="search"
        id="ep-search"
        class="search-box"
        placeholder="Search endpoints, paths…"
        oninput="filterEndpoints()"
      />

      <div class="method-filters" id="method-filters">
        <button type="button" class="filter-btn active" data-method="ALL" onclick="setMethodFilter('ALL')">ALL</button>
        <button type="button" class="filter-btn" data-method="GET" onclick="setMethodFilter('GET')">GET</button>
        <button type="button" class="filter-btn" data-method="POST" onclick="setMethodFilter('POST')">POST</button>
        <button type="button" class="filter-btn" data-method="PUT" onclick="setMethodFilter('PUT')">PUT</button>
        <button type="button" class="filter-btn" data-method="PATCH" onclick="setMethodFilter('PATCH')">PATCH</button>
        <button type="button" class="filter-btn" data-method="DELETE" onclick="setMethodFilter('DELETE')">DELETE</button>
      </div>

      <nav id="sidebar-nav">${sidebarHtml}</nav>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <h1>${escapeHtml(project.name || 'API Documentation')}</h1>
          <div class="topbar-sub">Interactive API Reference &amp; Endpoint Preview · Exported from Beacon</div>
        </div>
        <div class="topbar-controls">
          <label style="font-size:11px;color:var(--muted)">Environment:</label>
          <select id="env-select" class="env-select" onchange="onSwitchEnv(this.value)">
            ${envs.map((e, i) => `<option value="${i}">${escapeHtml(e.name || `Env ${i + 1}`)}</option>`).join('')}
          </select>
          <button type="button" class="action-btn" onclick="toggleTheme()">Theme</button>
          <button type="button" class="action-btn" onclick="window.print()">Print / PDF</button>
        </div>
      </header>

      <section class="env-bar">
        <div class="env-bar-left">
          <label for="base-url-input" style="font-weight:700;color:var(--muted)">Base URL:</label>
          <div class="base-url-input-wrap">
            <input
              type="text"
              id="base-url-input"
              class="base-url-input"
              value="${escapeHtml(defaultBaseUrl)}"
              placeholder="https://api.example.com"
              oninput="onBaseUrlChange(this.value)"
            />
            <button type="button" class="action-btn-sm" onclick="resetBaseUrl()" title="Reset to environment default">Reset</button>
          </div>
        </div>
        <div class="env-bar-right">
          <span id="active-vars-summary" style="color:var(--muted)"></span>
        </div>
      </section>

      <div id="endpoints-container">
        ${cardsHtml || '<div class="empty-note">No endpoints in this project yet.</div>'}
      </div>
    </main>
  </div>

  <script>
    const ENVS = ${envsJson};
    let currentMethod = 'ALL';
    let customBaseUrlOverride = null;

    function getActiveBaseUrl() {
      if (customBaseUrlOverride !== null && customBaseUrlOverride.trim() !== '') {
        return customBaseUrlOverride.trim();
      }
      const envSelect = document.getElementById('env-select');
      const env = ENVS[Number(envSelect ? envSelect.value : 0)] || ENVS[0] || { base_url: 'https://api.example.com', variables: {} };
      return env.base_url || 'https://api.example.com';
    }

    function onBaseUrlChange(val) {
      customBaseUrlOverride = val.trim();
      updateAllUrls();
    }

    function resetBaseUrl() {
      const envSelect = document.getElementById('env-select');
      const env = ENVS[Number(envSelect ? envSelect.value : 0)] || ENVS[0] || { base_url: 'https://api.example.com', variables: {} };
      customBaseUrlOverride = null;
      const input = document.getElementById('base-url-input');
      if (input) input.value = env.base_url || 'https://api.example.com';
      updateAllUrls();
    }

    function resolveUrl(baseUrl, rawUrl, vars) {
      let u = (rawUrl || '/').trim();
      if (!/^[a-z][a-z0-9+.-]*:\\/\\//i.test(u)) {
        const b = (baseUrl || 'https://api.example.com').replace(/\\/$/, '');
        u = b + '/' + u.replace(/^\\//, '');
      }
      if (vars && typeof vars === 'object') {
        u = u.replace(/\\{\\{([^{}]+)\\}\\}/g, (tok, name) => {
          return Object.prototype.hasOwnProperty.call(vars, name) && vars[name] ? vars[name] : tok;
        });
      }
      return u;
    }

    function onSwitchEnv(idxStr) {
      const env = ENVS[Number(idxStr)] || ENVS[0] || { base_url: 'https://api.example.com', variables: {} };
      customBaseUrlOverride = null;
      const input = document.getElementById('base-url-input');
      if (input) input.value = env.base_url || 'https://api.example.com';
      const varKeys = Object.keys(env.variables || {}).filter(Boolean);
      document.getElementById('active-vars-summary').textContent = varKeys.length
        ? 'Variables: ' + varKeys.map(k => '{{' + k + '}}').join(', ')
        : 'No environment variables defined';
      updateAllUrls();
    }

    function updateAllUrls() {
      const base = getActiveBaseUrl();
      const envSelect = document.getElementById('env-select');
      const env = ENVS[Number(envSelect ? envSelect.value : 0)] || ENVS[0] || { base_url: 'https://api.example.com', variables: {} };
      document.querySelectorAll('.url-resolved').forEach(el => {
        const raw = el.getAttribute('data-url-template') || '/';
        el.textContent = resolveUrl(base, raw, env.variables);
      });
      document.querySelectorAll('.ep-card').forEach((card, idx) => {
        const raw = card.getAttribute('data-raw-url') || '/';
        const fullUrl = resolveUrl(base, raw, env.variables);
        const curlPane = document.getElementById('curl-' + idx);
        const jsPane = document.getElementById('js-' + idx);
        const pyPane = document.getElementById('py-' + idx);
        if (curlPane) curlPane.textContent = curlPane.textContent.replace(/https?:\\/\\/[^\\s'"]+/, fullUrl);
        if (jsPane) jsPane.textContent = jsPane.textContent.replace(/https?:\\/\\/[^\\s'"]+/, fullUrl);
        if (pyPane) pyPane.textContent = pyPane.textContent.replace(/https?:\\/\\/[^\\s'"]+/, fullUrl);
      });
    }

    function setMethodFilter(method) {
      currentMethod = method;
      document.querySelectorAll('#method-filters .filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-method') === method);
      });
      filterEndpoints();
    }

    function filterEndpoints() {
      const q = (document.getElementById('ep-search').value || '').trim().toLowerCase();
      document.querySelectorAll('.ep-card, .nav-item').forEach(el => {
        const m = el.getAttribute('data-method') || '';
        const s = el.getAttribute('data-search') || '';
        const matchM = currentMethod === 'ALL' || m === currentMethod;
        const matchQ = !q || s.includes(q);
        el.classList.toggle('hidden', !(matchM && matchQ));
      });
    }

    function switchSnippet(btn, targetId) {
      const panel = btn.closest('.code-panel');
      panel.querySelectorAll('.snip-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      panel.querySelectorAll('.snippet-pane').forEach(p => {
        p.classList.toggle('hidden', p.id !== targetId);
      });
    }

    function copyText(btn, text) {
      navigator.clipboard?.writeText(text || '').then(() => {
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = prev; }, 1200);
      });
    }

    function copyCodeBlock(btn) {
      const pre = btn.closest('.code-panel').querySelector('pre');
      copyText(btn, pre ? pre.textContent : '');
    }

    function copyActiveSnippet(btn) {
      const pre = btn.closest('.code-panel').querySelector('.snippet-pane:not(.hidden)');
      copyText(btn, pre ? pre.textContent : '');
    }

    function fmtBytes(bytes) {
      if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function highlightJson(jsonStr) {
      if (typeof jsonStr !== 'string') {
        try { jsonStr = JSON.stringify(jsonStr, null, 2); } catch { jsonStr = String(jsonStr); }
      }
      const safe = jsonStr
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return safe.replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\\-]?\d+)?|[{}[\],:])/g,
        function (match) {
          if (/^"/.test(match)) {
            if (/:$/.test(match)) {
              return '<span class="hl-key">' + match.slice(0, -1) + '</span><span class="hl-punct">:</span>';
            }
            return '<span class="hl-string">' + match + '</span>';
          }
          if (/true|false/.test(match)) return '<span class="hl-bool">' + match + '</span>';
          if (/null/.test(match)) return '<span class="hl-null">' + match + '</span>';
          if (/-?\\d/.test(match)) return '<span class="hl-number">' + match + '</span>';
          if (/[{}[\],:]/.test(match)) return '<span class="hl-punct">' + match + '</span>';
          return match;
        }
      );
    }

    async function sendLiveRequest(btn) {
      const idx = btn.getAttribute('data-ep-index');
      const method = btn.getAttribute('data-ep-method') || 'GET';
      const rawUrl = btn.getAttribute('data-ep-url') || '/';
      const envSelect = document.getElementById('env-select');
      const env = ENVS[Number(envSelect ? envSelect.value : 0)] || ENVS[0] || { base_url: 'https://api.example.com', variables: {} };
      const base = getActiveBaseUrl();
      const targetUrl = resolveUrl(base, rawUrl, env.variables);
      const container = document.getElementById('live-container-' + idx);
      const meta = document.getElementById('live-meta-' + idx);
      const out = document.getElementById('live-res-' + idx);
      if (!out || !container) return;

      container.classList.remove('hidden');
      meta.innerHTML = '<span class="status-loading">● Sending ' + method + ' request...</span>';
      out.textContent = 'Awaiting response from ' + targetUrl + ' ...';

      const card = btn.closest('.ep-card');
      const payloadEl = card ? card.querySelector('.json-highlight') : null;
      let body = undefined;
      const headers = {};
      if (['POST', 'PUT', 'PATCH'].includes(method) && payloadEl && payloadEl.textContent.trim()) {
        body = payloadEl.textContent.trim();
        headers['Content-Type'] = 'application/json';
      }

      const t0 = performance.now();
      let statusCode = 200;
      let statusText = 'OK';
      let ms = 0;
      let text = '';
      let isProxied = false;

      try {
        try {
          const res = await fetch(targetUrl, { method, headers, body });
          ms = Math.round(performance.now() - t0);
          statusCode = res.status;
          statusText = res.statusText || '';
          text = await res.text();
        } catch (directErr) {
          // Direct fetch failed (e.g. browser CORS restriction on third-party APIs).
          // Automatically try local Beacon backend proxy fallback:
          try {
            const proxyRes = await fetch('http://127.0.0.1:8000/proxy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: targetUrl,
                method: method,
                headers: headers,
                body: body,
              }),
            });
            if (proxyRes.ok) {
              const data = await proxyRes.json();
              ms = data.time_ms || Math.round(performance.now() - t0);
              statusCode = data.status || (data.ok ? 200 : 500);
              statusText = data.reason || (data.ok ? 'OK' : 'Error');
              text = typeof data.body === 'string' ? data.body : (data.json ? JSON.stringify(data.json, null, 2) : '');
              if (!text && data.error) {
                text = data.error;
              }
              isProxied = true;
            } else {
              throw directErr;
            }
          } catch (_proxyErr) {
            throw directErr;
          }
        }

        const statusCls = statusCode >= 200 && statusCode < 300 ? 'status-2xx' : statusCode < 500 ? 'status-4xx' : 'status-5xx';

        meta.innerHTML =
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<span class="status-badge ' + statusCls + '">HTTP ' + statusCode + (statusText ? ' ' + statusText : '') + '</span>' +
            (isProxied ? '<span class="meta-pill" style="color:var(--accent);border-color:var(--accent);font-weight:600;">⚡ Proxied</span>' : '') +
            '<span class="meta-pill">' + ms + ' ms</span>' +
            '<span class="meta-pill">' + fmtBytes(text.length) + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<button type="button" class="action-btn-sm" onclick="copyPlayground(' + idx + ')">Copy Response</button>' +
            '<button type="button" class="action-btn-sm" onclick="clearPlayground(' + idx + ')">Clear</button>' +
          '</div>';

        let isJson = false;
        let formatted = text;
        try {
          const parsed = JSON.parse(text);
          formatted = JSON.stringify(parsed, null, 2);
          isJson = true;
        } catch {}

        if (isJson) {
          out.innerHTML = highlightJson(formatted);
        } else {
          out.textContent = text;
        }
      } catch (err) {
        meta.innerHTML =
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<span class="status-badge status-err">Network / CORS Error</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<button type="button" class="action-btn-sm" onclick="copyCurl(' + idx + ')">Copy as cURL</button>' +
            '<button type="button" class="action-btn-sm" onclick="clearPlayground(' + idx + ')">Clear</button>' +
          '</div>';
        out.textContent = 'Request failed: ' + (err && err.message ? err.message : String(err)) +
          '\\n\\nNote: If sending requests from an offline HTML file in a browser, remote APIs without CORS headers (Access-Control-Allow-Origin: *) will be blocked by browser security.\\n' +
          '💡 Solutions:\\n' +
          '• Keep Beacon running on http://127.0.0.1:8000 — requests will automatically proxy through Beacon to bypass CORS.\\n' +
          '• Or click "Copy as cURL" above to run this request directly in your terminal without CORS limits.';
      }
    }

    function copyCurl(idx) {
      const el = document.getElementById('curl-' + idx);
      if (el) {
        navigator.clipboard?.writeText(el.textContent || '').then(() => {
          const btn = event.target;
          if (btn) {
            const prev = btn.textContent;
            btn.textContent = 'cURL Copied!';
            setTimeout(() => { btn.textContent = prev; }, 1200);
          }
        });
      }
    }

    function copyPlayground(idx) {
      const out = document.getElementById('live-res-' + idx);
      if (out) {
        const text = out.textContent || '';
        navigator.clipboard?.writeText(text).then(() => {
          const btn = event.target;
          if (btn) {
            const prev = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = prev; }, 1200);
          }
        });
      }
    }

    function clearPlayground(idx) {
      const container = document.getElementById('live-container-' + idx);
      if (container) container.classList.add('hidden');
    }

    function toggleTheme() {
      const html = document.documentElement;
      html.setAttribute('data-theme', html.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    }

    onSwitchEnv('0');
  </script>
</body>
</html>`
}

export function buildExportOutput(
  format: ProjectExportFormat,
  envelope: ExportedProjectEnvelope,
): { content: string; extension: string; mimeType: string; isJson: boolean } {
  switch (format) {
    case 'html':
      return {
        content: generateInteractiveHtmlDocs(envelope),
        extension: 'api-docs.html',
        mimeType: 'text/html;charset=utf-8',
        isJson: false,
      }
    case 'openapi':
      return {
        content: JSON.stringify(generateOpenApiSpec(envelope), null, 2),
        extension: 'openapi.json',
        mimeType: 'application/json',
        isJson: true,
      }
    case 'postman':
      return {
        content: JSON.stringify(generatePostmanCollection(envelope), null, 2),
        extension: 'postman_collection.json',
        mimeType: 'application/json',
        isJson: true,
      }
    case 'markdown':
      return {
        content: generateMarkdownDocs(envelope),
        extension: 'api-docs.md',
        mimeType: 'text/markdown;charset=utf-8',
        isJson: false,
      }
    case 'beacon':
    default:
      return {
        content: JSON.stringify(envelope, null, 2),
        extension: 'project.json',
        mimeType: 'application/json',
        isJson: true,
      }
  }
}
