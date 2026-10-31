import { describe, expect, it } from 'vitest'
import {
  buildExportOutput,
  generateInteractiveHtmlDocs,
  generateMarkdownDocs,
  generateOpenApiSpec,
  generatePostmanCollection,
  highlightJsonHtml,
  type ExportedProjectEnvelope,
} from './projectExport'

const sampleEnvelope: ExportedProjectEnvelope = {
  format: 'beacon.project',
  version: 1,
  secrets_included: false,
  project: {
    name: 'Retailku API',
    environments: [
      {
        name: 'Production',
        base_url: 'https://api.retailku.com',
        variables: {
          api_key: '',
          tenant_id: 'acme-corp',
        },
      },
    ],
    items: [
      {
        id: 'folder-auth',
        name: 'Authentication',
        type: 'folder',
        items: [
          {
            id: 'ep-login',
            name: 'User Login',
            type: 'request',
            method: 'POST',
            url: '/v1/auth/login',
            headers: { 'Content-Type': 'application/json' },
            payload: { email: '{{random_email}}', password: 'secret' },
            extractors: { access_token: 'body.access_token' },
            assertions: [{ type: 'status', expected: 200 }],
          },
        ],
      },
      {
        id: 'ep-orders',
        name: 'List Orders',
        type: 'request',
        method: 'GET',
        url: '/v1/orders/{{order_id}}?limit=20',
        headers: { Authorization: 'Bearer {{access_token}}' },
      },
    ],
  },
}

describe('projectExport', () => {
  it('generates self-contained interactive HTML API explorer', () => {
    const html = generateInteractiveHtmlDocs(sampleEnvelope)
    expect(html.toLowerCase()).toContain('<!doctype html>')
    expect(html).toContain('Retailku API')
    expect(html).toContain('/v1/auth/login')
    expect(html).toContain('/v1/orders/{{order_id}}?limit=20')
    expect(html).toContain('Send Live Request')
    expect(html).toContain('acme-corp')
  })

  it('generates a valid OpenAPI 3.0.3 specification from project endpoints', () => {
    const spec = generateOpenApiSpec(sampleEnvelope) as any
    expect(spec.openapi).toBe('3.0.3')
    expect(spec.info.title).toBe('Retailku API')
    expect(spec.servers[0].url).toBe('https://api.retailku.com')
    expect(spec.paths['/v1/auth/login'].post.summary).toBe('User Login')
    expect(spec.paths['/v1/orders/{order_id}'].get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'order_id', in: 'path', required: true }),
        expect.objectContaining({ name: 'limit', in: 'query' }),
      ]),
    )
  })

  it('generates a Postman v2.1 collection preserving folder hierarchy', () => {
    const col = generatePostmanCollection(sampleEnvelope) as any
    expect(col.info.name).toBe('Retailku API')
    expect(col.item).toHaveLength(2)
    expect(col.item[0].name).toBe('Authentication')
    expect(col.item[0].item[0].name).toBe('User Login')
  })

  it('generates Markdown documentation and buildExportOutput metadata', () => {
    const md = generateMarkdownDocs(sampleEnvelope)
    expect(md).toContain('# Retailku API')
    expect(md).toContain('## Endpoint Reference')
    expect(md).toContain('`/v1/auth/login`')

    const out = buildExportOutput('html', sampleEnvelope)
    expect(out.extension).toBe('api-docs.html')
    expect(out.mimeType).toBe('text/html;charset=utf-8')
    expect(out.isJson).toBe(false)
  })

  it('includes documented example response across OpenAPI, Postman, Markdown, and HTML exports', () => {
    const envelopeWithMock: ExportedProjectEnvelope = {
      ...sampleEnvelope,
      project: {
        ...sampleEnvelope.project,
        items: [
          {
            id: 'ep-mocked',
            name: 'Get User Profile',
            type: 'request',
            method: 'GET',
            url: '/v1/users/me',
            mock_response: {
              enabled: true,
              status: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: 'usr_123', name: 'Alice', role: 'admin' }, null, 2),
            },
          } as any,
        ],
      },
    }

    const openApi = generateOpenApiSpec(envelopeWithMock) as any
    expect(openApi.paths['/v1/users/me'].get.responses['200']).toBeDefined()
    expect(openApi.paths['/v1/users/me'].get.responses['200'].content['application/json'].example).toEqual({
      id: 'usr_123',
      name: 'Alice',
      role: 'admin',
    })

    const postman = generatePostmanCollection(envelopeWithMock) as any
    expect(postman.item[0].response).toHaveLength(1)
    expect(postman.item[0].response[0].code).toBe(200)
    expect(postman.item[0].response[0].body).toContain('usr_123')

    const md = generateMarkdownDocs(envelopeWithMock)
    expect(md).toContain('#### Documented Example Response (200)')
    expect(md).toContain('"id": "usr_123"')

    const html = generateInteractiveHtmlDocs(envelopeWithMock)
    expect(html).toContain('Documented Response Example')
    expect(html).toContain('usr_123')
    expect(html).toContain('hl-key')
    expect(html).toContain('id="base-url-input"')
    expect(html).toContain('playground-pre')
  })

  it('highlights JSON syntax with pure HTML spans', () => {
    const raw = JSON.stringify({ name: 'Alice', age: 30, active: true, notes: null }, null, 2)
    const highlighted = highlightJsonHtml(raw)
    expect(highlighted).toContain('<span class="hl-key">"name"</span>')
    expect(highlighted).toContain('<span class="hl-string">"Alice"</span>')
    expect(highlighted).toContain('<span class="hl-number">30</span>')
    expect(highlighted).toContain('<span class="hl-bool">true</span>')
    expect(highlighted).toContain('<span class="hl-null">null</span>')
  })
})
