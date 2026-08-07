import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  Braces,
  Cookie,
  DatabaseZap,
  FileJson,
  Globe2,
  KeyRound,
  MonitorUp,
  Radio,
  Save,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Shuffle,
} from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { KVEditor } from './KVEditor'
import { PayloadEditor } from './PayloadEditor'
import { toast } from './ui/toast'
import { TestConfig, Endpoint } from '../types'
import { api, type SendResponse } from '../lib/api'
import { CodeSnippetDialog } from './dialogs/CodeSnippetDialog'
import { CurlImportDialog } from './dialogs/CurlImportDialog'
import type { ParsedCurl } from '../lib/curlParser'
import { Terminal, ClipboardPaste } from 'lucide-react'
import ResponseInspector from './ResponseInspector'
import { WebSocketInspector } from './WebSocketInspector'
import { AssertionsEditor } from './AssertionsEditor'
import { QueryParamsEditor } from './QueryParamsEditor'
import { parseQueryParams } from '../lib/queryParams'

interface Props {
  testId: string | null
  config: TestConfig
  projectId?: string
  currentProjectName?: string
  currentEnvName?: string
  onCaptureVariable?: (name: string, value: unknown) => Promise<void>
  onClose: () => void
  /** `created` carries the new endpoint when a brand-new one was saved, so the
   *  caller can place it (e.g. inside a folder). Undefined on edits. */
  onSave: (created?: Endpoint) => void
}

type AuthType = 'none' | 'inherit' | 'bearer' | 'apikey' | 'basic' | 'custom'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const BODY_TYPES = [
  { value: 'json', label: 'JSON' },
  { value: 'form', label: 'Form' },
  { value: 'multipart', label: 'Multipart' },
  { value: 'raw', label: 'Raw (text/XML/GraphQL)' },
] as const

const METHOD_STYLES: Record<string, string> = {
  GET: 'text-emerald-600 dark:text-emerald-400',
  POST: 'text-cyan-600 dark:text-cyan-400',
  PUT: 'text-amber-600 dark:text-amber-400',
  PATCH: 'text-violet-600 dark:text-violet-400',
  DELETE: 'text-red-600 dark:text-red-400',
}

// Client-side mirrors of the backend generators (core/tester.py `_generate_dynamic`)
// purely to show an illustrative sample — the real value is generated per request.
const _rand = (n: number) =>
  Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
const _uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
const _digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')

interface DynamicHelper { token: string; label: string; sample: () => string }
const DYNAMIC_HELPERS: DynamicHelper[] = [
  { token: '{{random_email}}', label: 'Random email', sample: () => `user_${_rand(6)}@example.com` },
  { token: '{{random_phone}}', label: 'Phone (+62)', sample: () => `+62812${_digits(8)}` },
  { token: '{{uuid}}', label: 'UUID v4', sample: _uuid },
  { token: '{{timestamp}}', label: 'Unix seconds', sample: () => String(Math.floor(Date.now() / 1000)) },
  { token: '{{random_string:12}}', label: 'Random string · N chars', sample: () => _rand(12) },
  { token: '{{random_int:1:100}}', label: 'Random int · min:max', sample: () => String(1 + Math.floor(Math.random() * 100)) },
  { token: '{{random_number}}', label: 'Random number', sample: () => String(Math.floor(Math.random() * 1_000_000)) },
]
const WEB_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
const WEB_ASSERTIONS = [
  { type: 'status', op: 'eq', value: 200 },
  { type: 'time_ms', op: 'lt', value: 5000 },
  { type: 'header', name: 'content-type', op: 'contains', value: 'text/html' },
]
const TEMPLATE_TOKEN = /\{\{([^{}]+)\}\}/g

function resolvePreview(value: string, variables: Record<string, string>): { value: string; unresolved: string[] } {
  const unresolved = new Set<string>()
  const resolved = value.replace(TEMPLATE_TOKEN, (token, name: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) return String(variables[name])
    if (DYNAMIC_HELPERS.some((helper) => helper.token.includes(`{{${name.split(':')[0]}`))) return `<generated:${name}>`
    unresolved.add(name)
    return token
  })
  return { value: resolved, unresolved: [...unresolved] }
}

function getDefaultForm() {
  return {
    name: 'New Endpoint',
    url: '/your-endpoint',
    method: 'POST',
    payload_type: 'json',
    target_type: 'api',
    headers: { 'Content-Type': 'application/json' },
    cookies: {},
    payload: {},
    extractors: {},
  }
}

export default function EndpointEditor({ testId, config, projectId, currentProjectName, currentEnvName, onCaptureVariable, onClose, onSave }: Props) {
  const [form, setForm] = useState<any>(getDefaultForm())
  const [authType, setAuthType] = useState<AuthType>('inherit')
  const [isSnippetDialogOpen, setIsSnippetDialogOpen] = useState(false)
  const [isCurlImportOpen, setIsCurlImportOpen] = useState(false)
  const [backendBaseUrl, setBackendBaseUrl] = useState('')

  const handleCurlImport = (parsed: ParsedCurl) => {
    setForm((prev: any) => ({
      ...prev,
      url: parsed.url || prev.url,
      method: parsed.method || prev.method,
      headers: { ...prev.headers, ...parsed.headers },
      payload: parsed.payload !== undefined ? parsed.payload : prev.payload,
      payload_type: parsed.payload_type || prev.payload_type,
    }))
    toast.success('Imported cURL parameters successfully!')
  }

  useEffect(() => {
    api.getBaseUrl().then((url) => {
      setBackendBaseUrl(url || window.location.origin)
    }).catch(() => {
      setBackendBaseUrl(window.location.origin)
    })
  }, [])
  const [authVar, setAuthVar] = useState('access_token')
  const [basicUser, setBasicUser] = useState('')
  const [basicPassword, setBasicPassword] = useState('')
  const [apiKeyHeader, setApiKeyHeader] = useState('X-API-Key')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [response, setResponse] = useState<SendResponse | null>(null)
  const [retries, setRetries] = useState(0)
  const [helperSamples, setHelperSamples] = useState<string[]>(() => DYNAMIC_HELPERS.map((h) => h.sample()))

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [testId])

  useEffect(() => {
    if (testId) {
      const existing = (config.tests as any[]).find((t: any) => t.id === testId) || (config as any).items?.flat?.() /* rough */
      if (existing) {
        const loaded = {
          ...existing,
          headers: existing.headers || {},
          cookies: existing.cookies || {},
          payload: existing.payload || {},
          extractors: existing.extractors || {},
          target_type: existing.target_type || 'api',
        }
        setForm(loaded)

        // A structured spec is authoritative. Endpoints saved before auth
        // existed are inferred from their Authorization header instead.
        const spec = existing.auth
        if (spec?.type) {
          setAuthType(spec.type as AuthType)
          setAuthVar(spec.token || spec.value || 'access_token')
          setBasicUser(spec.username || '')
          setBasicPassword(spec.password || '')
          setApiKeyHeader(spec.key || 'X-API-Key')
        } else {
          const auth = (existing.headers?.Authorization || '').trim()
          if (!auth) {
            setAuthType('none')
          } else if (auth.startsWith('Bearer {{')) {
            setAuthType('bearer')
            const match = auth.match(/\{\{([^}]+)\}\}/)
            if (match) setAuthVar(match[1])
          } else if (auth.includes('{{')) {
            setAuthType('apikey')
            const match = auth.match(/\{\{([^}]+)\}\}/)
            if (match) setAuthVar(match[1])
          } else {
            setAuthType('custom')
          }
        }
      }
    } else {
      setForm(getDefaultForm())
      setAuthType('inherit')
      setAuthVar('access_token')
      setBasicUser('')
      setBasicPassword('')
      setApiKeyHeader('X-API-Key')
    }
  }, [testId, config])

  const headerCount = Object.keys(form.headers || {}).filter(Boolean).length
  const cookieCount = Object.keys(form.cookies || {}).filter(Boolean).length
  const extractorCount = Object.keys(form.extractors || {}).filter(Boolean).length
  const queryParamCount = parseQueryParams(form.url || '').length
  const methodClass = METHOD_STYLES[form.method] || 'text-foreground'
  const isWebTarget = form.target_type === 'web'
  const isWsTarget = form.target_type === 'websocket'
  const absoluteUrl = useMemo(() => {
    const url = form.url || ''
    if (!url) return config.base_url || 'base url not set'
    if (/^https?:\/\//i.test(url)) return url
    const base = (config.base_url || '').replace(/\/$/, '')
    return base ? `${base}/${url.replace(/^\//, '')}` : url
  }, [config.base_url, form.url])
  const resolvedUrl = useMemo(
    () => resolvePreview(absoluteUrl, config.variables || {}),
    [absoluteUrl, config.variables],
  )

  const handleChange = (field: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [field]: value }))
  }

  const changeTargetType = (targetType: 'api' | 'web' | 'websocket') => {
    setForm((prev: any) => {
      if (targetType === 'web') {
        const untouchedName = !testId && (!prev.name || prev.name === 'New Endpoint')
        const untouchedUrl = !testId && (!prev.url || prev.url === '/your-endpoint')
        const headers = { ...(prev.headers || {}) }
        if (headers['Content-Type'] === 'application/json') delete headers['Content-Type']
        headers.Accept = headers.Accept || WEB_ACCEPT
        return {
          ...prev,
          target_type: 'web',
          name: untouchedName ? 'Website homepage' : prev.name,
          url: untouchedUrl ? 'https://example.com/' : prev.url,
          method: 'GET',
          payload_type: 'none',
          headers,
          assertions: (prev.assertions || []).length > 0 ? prev.assertions : WEB_ASSERTIONS,
        }
      }

      if (targetType === 'websocket') {
        const untouchedName = !testId && (!prev.name || prev.name === 'New Endpoint')
        const untouchedUrl = !testId && (!prev.url || prev.url === '/your-endpoint')
        return {
          ...prev,
          target_type: 'websocket',
          name: untouchedName ? 'WebSocket connection' : prev.name,
          url: untouchedUrl ? 'ws://localhost:8080/ws' : prev.url,
          method: 'GET',
          payload_type: 'none',
          ws_message: prev.ws_message || '',
          ws_message_type: prev.ws_message_type || 'text',
        }
      }

      const headers = { ...(prev.headers || {}) }
      if (headers.Accept === WEB_ACCEPT) delete headers.Accept
      return {
        ...prev,
        target_type: 'api',
        payload_type: prev.payload_type === 'none' ? 'json' : prev.payload_type,
        headers,
      }
    })
  }

  // Auth is stored as a structured spec, not a pre-built header string. The
  // backend encodes Basic credentials at request time (after templating) and
  // resolves `inherit` against the enclosing folder and project.
  const buildAuthSpec = (
    type: AuthType,
    parts: { token?: string; username?: string; password?: string; header?: string },
  ) => {
    const token = parts.token ?? authVar
    switch (type) {
      case 'bearer':
        return { type, token: `{{${token}}}` }
      case 'basic':
        return {
          type,
          username: parts.username ?? basicUser,
          password: parts.password ?? basicPassword,
        }
      case 'apikey':
        return { type, in: 'header', key: parts.header ?? apiKeyHeader, value: `{{${token}}}` }
      case 'custom':
        return { type, header: 'Authorization', value: `{{${token}}}` }
      default:
        return { type }
    }
  }

  const applyAuth = (
    type: AuthType,
    parts: { token?: string; username?: string; password?: string; header?: string } = {},
  ) => {
    setAuthType(type)
    if (parts.token !== undefined) setAuthVar(parts.token)
    if (parts.username !== undefined) setBasicUser(parts.username)
    if (parts.password !== undefined) setBasicPassword(parts.password)
    if (parts.header !== undefined) setApiKeyHeader(parts.header)

    // Drop any legacy hand-written Authorization so the spec is the only
    // source of truth and a stale header can't outlive an auth-type change.
    const { Authorization, ...rest } = form.headers || {}
    setForm((prev: any) => ({ ...prev, headers: rest, auth: buildAuthSpec(type, parts) }))
  }

  // Build the endpoint payload from the form (folds cookies into a Cookie
  // header). Shared by Save and click-to-extract so they persist identically.
  const buildPayload = (): Record<string, unknown> => {
    const headers = { ...(form.headers || {}) }
    const cookies = form.cookies || {}
    if (Object.keys(cookies).length > 0) {
      headers.Cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    }
    return { ...form, name: String(form.name || '').trim(), url: String(form.url || '').trim(), headers, cookies: undefined }
  }

  // Fire one request and show the response. Only for saved endpoints (needs an id).
  const handleSend = async () => {
    if (!testId) return
    setSending(true)
    setResponse(null)
    try {
      setResponse(await api.sendOnce(testId, retries > 0 ? { retries, retry_delay: 0.3 } : undefined))
    } catch (e: any) {
      setResponse({ ok: false, error: e?.message || 'Request failed', time_ms: 0 })
    } finally {
      setSending(false)
    }
  }

  // Cmd/Ctrl+Enter sends the request from anywhere in the editor.
  const handleSendRef = useRef(handleSend)
  handleSendRef.current = handleSend
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && testId) {
        e.preventDefault()
        handleSendRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [testId])

  // One-click capture: persist the extractor for future sends and immediately
  // save the value currently visible in the response to the active environment.
  const handleExtract = async (varName: string, path: string, value: unknown) => {
    const nextExtractors = { ...(form.extractors || {}), [varName]: path }
    handleChange('extractors', nextExtractors)
    if (!testId) return
    try {
      await api.updateTest(testId, { ...buildPayload(), extractors: nextExtractors } as Partial<Endpoint>)
      if (onCaptureVariable) await onCaptureVariable(varName, value)
      toast.success(`Captured {{${varName}}} from ${path}`)
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save extractor')
      throw e
    }
  }

  const save = async () => {
    const name = String(form.name || '').trim()
    const urlValue = String(form.url || '').trim()
    if (!name) {
      toast.error('Endpoint name is required')
      return
    }
    if (!urlValue) {
      toast.error(isWebTarget ? 'Website URL is required' : 'Endpoint URL is required')
      return
    }
    if (isWebTarget && !/^https?:\/\//i.test(urlValue)) {
      toast.error('Web Page targets need a full URL starting with http:// or https://')
      return
    }
    if (isWsTarget && !/^wss?:\/\//i.test(urlValue)) {
      toast.error('WebSocket targets need a URL starting with ws:// or wss://')
      return
    }

    const payloadToSend = buildPayload()

    setSaving(true)
    try {
      // Use the api helper so this hits the resolved backend (in the desktop app
      // the backend runs on an OS-assigned port, not the webview origin). A raw
      // relative fetch() went to the wrong origin, so a created endpoint saved
      // but the subsequent refresh never saw it — it only appeared after an app
      // restart.
      const saved: Endpoint | undefined = testId
        ? await api.updateTest(testId, payloadToSend as Partial<Endpoint>)
        : await api.createTest(payloadToSend as Partial<Endpoint>)
      toast.success(testId ? 'Endpoint updated' : 'Endpoint created')
      onSave(testId ? undefined : saved)
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save endpoint')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full min-w-0 bg-background">
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 gap-1.5 shrink-0">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>

          <div className="min-w-[220px] flex-1">
            <Input
              value={form.name || ''}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="Endpoint name"
              className="h-9 border-0 bg-transparent px-1 text-lg font-bold focus-visible:ring-1"
            />
            <div className="flex flex-wrap items-center gap-2 px-1 text-[11px] text-muted-foreground">
              {currentProjectName && <span>{currentProjectName}</span>}
              {currentEnvName && <span className="text-emerald-600 dark:text-emerald-400">{currentEnvName}</span>}
              <span className="truncate font-mono" title={resolvedUrl.value}>{resolvedUrl.value}</span>
              {resolvedUrl.unresolved.length > 0 && (
                <span className="text-amber-600 dark:text-amber-400" title={`Missing: ${resolvedUrl.unresolved.join(', ')}`}>
                  {resolvedUrl.unresolved.length} unresolved
                </span>
              )}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => setIsSnippetDialogOpen(true)}
              title="Generate code snippets for this request"
            >
              <Terminal className="h-3.5 w-3.5 text-cyan-500" /> Code
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => setIsCurlImportOpen(true)}
              title="Import endpoint parameters from a cURL command"
            >
              <ClipboardPaste className="h-3.5 w-3.5 text-cyan-500" /> Import cURL
            </Button>
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            {testId && (
              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Retry while the request errors or returns a non-2xx">
                  retry
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={retries}
                    onChange={(e) => setRetries(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
                    className="h-8 w-12 rounded-md border border-input bg-background px-1.5 text-center text-xs"
                  />
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSend}
                  disabled={sending || saving}
                  className="gap-1.5"
                  title="Send this request once and inspect the response"
                >
                  <Send className="h-3.5 w-3.5" /> {sending ? 'Sending...' : 'Send'}
                </Button>
              </div>
            )}
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
              <Save className="h-3.5 w-3.5" /> {saving ? 'Saving...' : isWebTarget ? 'Save web page' : 'Save endpoint'}
            </Button>
          </div>
        </div>
      </div>

      <div className="endpoint-editor-grid px-3 pb-8 pt-4">
        <aside className="space-y-3">
          <Panel title="Request" icon={<Globe2 className="h-4 w-4" />}>
            <div className="space-y-2.5">
              <Field label="Target type">
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/35 p-1">
                  <button
                    type="button"
                    aria-pressed={!isWebTarget && !isWsTarget}
                    onClick={() => changeTargetType('api')}
                    className={`flex min-h-14 items-center gap-2 rounded-md px-2 text-left transition-colors ${
                      !isWebTarget && !isWsTarget ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/60'
                    }`}
                  >
                    <Braces className="h-4 w-4 shrink-0 text-cyan-500" />
                    <span><span className="block text-[11px] font-bold">API</span><span className="block text-[9px]">JSON, form</span></span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={isWebTarget}
                    onClick={() => changeTargetType('web')}
                    className={`flex min-h-14 items-center gap-2 rounded-md px-2 text-left transition-colors ${
                      isWebTarget ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/60'
                    }`}
                  >
                    <Globe2 className="h-4 w-4 shrink-0 text-cyan-500" />
                    <span><span className="block text-[11px] font-bold">Web</span><span className="block text-[9px]">HTML load</span></span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={isWsTarget}
                    onClick={() => changeTargetType('websocket')}
                    className={`flex min-h-14 items-center gap-2 rounded-md px-2 text-left transition-colors ${
                      isWsTarget ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/60'
                    }`}
                  >
                    <Radio className="h-4 w-4 shrink-0 text-blue-500" />
                    <span><span className="block text-[11px] font-bold">WS</span><span className="block text-[9px]">Streaming</span></span>
                  </button>
                </div>
              </Field>

              {!isWsTarget && (
                <div className="grid grid-cols-5 rounded-lg border border-border bg-muted/35 p-0.5">
                  {METHODS.map((method) => (
                    <button
                      key={method}
                      type="button"
                      disabled={isWebTarget && method !== 'GET'}
                      onClick={() => handleChange('method', method)}
                      className={`h-7 min-w-0 rounded-md px-1 text-center font-mono text-[10px] font-extrabold transition-all ${
                        form.method === method
                          ? 'bg-background shadow-sm ring-1 ring-border ' + METHOD_STYLES[method]
                          : 'text-muted-foreground hover:bg-background/70 disabled:cursor-not-allowed disabled:opacity-30'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              )}

              <Field label={isWebTarget ? 'Website URL' : isWsTarget ? 'WebSocket URL' : 'Request endpoint'}>
                <Input
                  value={form.url || ''}
                  onChange={(e) => handleChange('url', e.target.value)}
                  className="h-9 font-mono text-sm"
                  placeholder={isWebTarget ? 'https://example.com/' : isWsTarget ? 'ws://localhost:8080/ws' : '/api/endpoint'}
                />
              </Field>

              {!isWebTarget && !isWsTarget && <Field label="Body type">
                <select
                  value={form.payload_type}
                  onChange={(e) => handleChange('payload_type', e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs font-semibold"
                >
                  {BODY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </Field>}

              {isWsTarget && (
                <div className="space-y-2">
                  <Field label="Message type">
                    <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/35 p-0.5">
                      <button
                        type="button"
                        aria-pressed={form.ws_message_type !== 'binary'}
                        onClick={() => handleChange('ws_message_type', 'text')}
                        className={`h-7 rounded-md px-2 text-center text-[10px] font-bold transition-all ${
                          form.ws_message_type !== 'binary' ? 'bg-background shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/70'
                        }`}
                      >Text</button>
                      <button
                        type="button"
                        aria-pressed={form.ws_message_type === 'binary'}
                        onClick={() => handleChange('ws_message_type', 'binary')}
                        className={`h-7 rounded-md px-2 text-center text-[10px] font-bold transition-all ${
                          form.ws_message_type === 'binary' ? 'bg-background shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/70'
                        }`}
                      >Binary (base64)</button>
                    </div>
                  </Field>
                  <Field label="Message payload">
                    <textarea
                      value={form.ws_message || ''}
                      onChange={(e) => handleChange('ws_message', e.target.value)}
                      className="h-24 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs resize-y"
                      placeholder={form.ws_message_type === 'binary' ? 'SGVsbG8gV29ybGQ=' : '{"type": "hello", "data": "world"}'}
                    />
                  </Field>
                </div>
              )}

              {isWebTarget && (
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-[11px] leading-5 text-muted-foreground">
                  Measures the HTML document request, redirects, response size, TTFB, latency, throughput, and failures. It does not execute JavaScript or download page assets.
                </div>
              )}

              <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold text-muted-foreground">
                <span className="rounded-md border border-border bg-background px-2 py-1">{headerCount} headers</span>
                <span className="rounded-md border border-border bg-background px-2 py-1">{cookieCount} cookies</span>
                <span className="rounded-md border border-border bg-background px-2 py-1">{extractorCount} extractors</span>
                <span className="rounded-md border border-border bg-background px-2 py-1">{queryParamCount} query params</span>
              </div>
            </div>
          </Panel>

          <Panel title="Authorization" icon={<KeyRound className="h-4 w-4" />}>
            <div className="space-y-3">
              <Field label="Auth type">
                <select
                  aria-label="Auth type"
                  value={authType}
                  onChange={(e) => applyAuth(e.target.value as AuthType)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="inherit">Inherit from folder / project</option>
                  <option value="none">None</option>
                  <option value="bearer">Bearer token</option>
                  <option value="apikey">API key</option>
                  <option value="basic">Basic auth</option>
                  <option value="custom">Custom</option>
                </select>
              </Field>

              {(authType === 'bearer' || authType === 'apikey' || authType === 'custom') && (
                <Field label="Variable / value">
                  <div className="flex gap-2">
                    <Input
                      list="beacon-environment-variables"
                      value={authVar}
                      onChange={(e) => applyAuth(authType, { token: e.target.value })}
                      className="h-9 flex-1 font-mono text-sm"
                      placeholder="access_token"
                    />
                    <datalist id="beacon-environment-variables">
                      {Object.keys(config.variables || {}).sort().map((name) => <option key={name} value={name} />)}
                    </datalist>
                    <Button variant="outline" size="sm" className="h-9" onClick={() => applyAuth(authType, { token: 'access_token' })}>token</Button>
                    <Button variant="outline" size="sm" className="h-9" onClick={() => applyAuth(authType, { token: 'api_key' })}>key</Button>
                  </div>
                </Field>
              )}

              {authType === 'apikey' && (
                <Field label="Header name">
                  <Input
                    value={apiKeyHeader}
                    onChange={(e) => applyAuth('apikey', { header: e.target.value })}
                    className="h-9 font-mono text-sm"
                    placeholder="X-API-Key"
                  />
                </Field>
              )}

              {authType === 'basic' && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Username">
                    <Input
                      value={basicUser}
                      onChange={(e) => applyAuth('basic', { username: e.target.value })}
                      className="h-9 font-mono text-sm"
                      placeholder="{{username}}"
                    />
                  </Field>
                  <Field label="Password">
                    <Input
                      value={basicPassword}
                      onChange={(e) => applyAuth('basic', { password: e.target.value })}
                      className="h-9 font-mono text-sm"
                      placeholder="{{password}}"
                    />
                  </Field>
                </div>
              )}

              <div className="rounded-lg border border-border bg-muted/35 p-3 text-xs">
                {authType === 'basic' ? (
                  <span className="text-muted-foreground">
                    Sent as <code className="font-mono">Authorization: Basic &lt;base64&gt;</code>, encoded at
                    request time. Use <code className="font-mono">{'{{variables}}'}</code> to keep credentials
                    out of the project file.
                  </span>
                ) : form.auth?.type === 'apikey' ? (
                  <code className="break-all font-mono">{apiKeyHeader}: {`{{${authVar}}}`}</code>
                ) : form.auth?.type === 'bearer' ? (
                  <code className="break-all font-mono">Authorization: Bearer {`{{${authVar}}}`}</code>
                ) : form.auth?.type === 'custom' ? (
                  <code className="break-all font-mono">Authorization: {`{{${authVar}}}`}</code>
                ) : form.headers?.Authorization ? (
                  <code className="break-all font-mono">{form.headers.Authorization}</code>
                ) : authType === 'inherit' ? (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    Using auth from the enclosing folder, or the project when the folder sets none.
                  </span>
                ) : (
                  <span className="text-muted-foreground">No Authorization header will be sent.</span>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="Dynamic helpers" icon={<Sparkles className="h-4 w-4" />}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Regenerated fresh on every request. Click to copy the token.
              </p>
              <button
                type="button"
                onClick={() => setHelperSamples(DYNAMIC_HELPERS.map((h) => h.sample()))}
                title="Shuffle sample values"
                className="shrink-0 rounded-md border border-border p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Shuffle className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-1">
              {DYNAMIC_HELPERS.map((h, i) => (
                <button
                  key={h.token}
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(h.token).then(() => toast.success(`Copied ${h.token}`)).catch(() => {})}
                  className="group flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5 text-left transition-colors hover:border-cyan-500/40"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[11px] text-foreground">{h.token}</div>
                    <div className="text-[9px] text-muted-foreground">{h.label}</div>
                  </div>
                  <code className="max-w-[45%] shrink-0 truncate font-mono text-[10px] text-cyan-600 dark:text-cyan-400" title={helperSamples[i]}>
                    {helperSamples[i]}
                  </code>
                </button>
              ))}
            </div>
          </Panel>
        </aside>

        <main className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/25 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-xs font-extrabold ${methodClass}`}>{form.method}</span>
                  <h2 className="text-sm font-bold">{isWebTarget ? 'Web page load' : 'Request builder'}</h2>
                </div>
                <p className="mt-1 max-w-2xl truncate font-mono text-xs text-muted-foreground">{absoluteUrl}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Pill icon={isWebTarget ? <Globe2 className="h-3 w-3" /> : <BadgeCheck className="h-3 w-3" />} label={isWebTarget ? 'WEB PAGE' : form.payload_type?.toUpperCase?.() || 'JSON'} />
                {isWebTarget
                  ? <Pill icon={<MonitorUp className="h-3 w-3" />} label="HTTP LOAD" />
                  : <Pill icon={<DatabaseZap className="h-3 w-3" />} label={`${extractorCount} extractor${extractorCount === 1 ? '' : 's'}`} />}
              </div>
            </div>

            {isWebTarget ? (
              <div className="grid gap-4 p-4 md:grid-cols-3">
                {[
                  ['Document', 'Requests the final HTML document and follows redirects.'],
                  ['Capacity', 'Use Load, Ramp, Spike, Soak, or Rate Probe from Test Mode.'],
                  ['Boundary', 'This is HTTP load testing, not a JavaScript browser journey.'],
                ].map(([title, body]) => (
                  <div key={title} className="border-l-2 border-cyan-500/40 pl-3">
                    <div className="text-xs font-bold">{title}</div>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{body}</p>
                  </div>
                ))}
              </div>
            ) : <div className="grid gap-0 2xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="min-w-0 space-y-4 p-4">
                <SectionTitle icon={<FileJson className="h-4 w-4" />} title="Payload / body" />
                <PayloadEditor value={form.payload || {}} onChange={(p) => handleChange('payload', p)} payloadType={form.payload_type} />
              </div>

              <div className="min-w-0 border-t border-border bg-muted/15 p-4 2xl:border-l 2xl:border-t-0">
                <SectionTitle icon={<Braces className="h-4 w-4" />} title="Response extractors" />
                <KVEditor data={form.extractors || {}} onChange={(e) => handleChange('extractors', e)} />
                <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">
                  Example: <code className="font-mono">access_token</code> maps to <code className="font-mono">body.access_token</code>
                </div>
              </div>
            </div>}
          </div>

          {!isWebTarget && (
            <Panel title="Query parameters" icon={<SlidersHorizontal className="h-4 w-4" />}>
              <p className="mb-3 text-[11px] leading-5 text-muted-foreground">
                Paste a URL with <code className="font-mono text-foreground">?key=value</code> above and rows appear automatically. Changes here update the URL immediately.
              </p>
              <QueryParamsEditor url={form.url || ''} onChange={(url) => handleChange('url', url)} />
            </Panel>
          )}

          <div className="grid gap-4 2xl:grid-cols-2">
            <Panel title="Headers" icon={<Braces className="h-4 w-4" />}>
              <KVEditor data={form.headers || {}} onChange={(h) => handleChange('headers', h)} />
            </Panel>
            <Panel title="Cookies" icon={<Cookie className="h-4 w-4" />}>
              <KVEditor data={form.cookies || {}} onChange={(c) => handleChange('cookies', c)} />
            </Panel>
          </div>

          <Panel title="Assertions" icon={<ShieldCheck className="h-4 w-4" />}>
            <AssertionsEditor value={form.assertions || []} onChange={(a) => handleChange('assertions', a)} />
          </Panel>

          <Panel title="API Mocking" icon={<Shuffle className="h-4 w-4" />}>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="mock_enabled"
                  checked={form.mock_response?.enabled || false}
                  onChange={(e) => {
                    const mock = form.mock_response || { status: 200, headers: { 'Content-Type': 'application/json' }, body: '' }
                    handleChange('mock_response', { ...mock, enabled: e.target.checked })
                  }}
                  className="h-4 w-4 rounded border-border text-cyan-600 focus:ring-cyan-500 bg-background"
                />
                <label htmlFor="mock_enabled" className="text-xs font-bold select-none cursor-pointer">
                  Enable Mock Response for this endpoint
                </label>
              </div>

              {form.mock_response?.enabled && (
                <div className="space-y-4 border-t border-border pt-3">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="col-span-1">
                      <Label className="text-[10px] font-bold uppercase text-muted-foreground">Status Code</Label>
                      <Input
                        type="number"
                        value={form.mock_response?.status ?? 200}
                        onChange={(e) => {
                          const mock = form.mock_response || { enabled: true, headers: {}, body: '' }
                          handleChange('mock_response', { ...mock, status: Number(e.target.value) || 200 })
                        }}
                        className="h-8 text-xs font-mono mt-1"
                      />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-[10px] font-bold uppercase text-muted-foreground">Mock Server Endpoint URL</Label>
                      <div className="h-8 mt-1 flex items-center px-3 border border-border rounded-md bg-muted/30 font-mono text-[11px] text-muted-foreground truncate select-all" title="Call this URL to receive the mocked response">
                        {`${backendBaseUrl}/mock/projects/${projectId || 'project_id'}/${(form.url || '').replace(/^\//, '')}`}
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">Response Headers</Label>
                    <div className="mt-1.5 rounded-lg border border-border bg-card/20 p-2">
                      <KVEditor
                        data={form.mock_response?.headers || {}}
                        onChange={(headers) => {
                          const mock = form.mock_response || { enabled: true, status: 200, body: '' }
                          handleChange('mock_response', { ...mock, headers })
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">Response Body</Label>
                    <textarea
                      value={form.mock_response?.body || ''}
                      onChange={(e) => {
                        const mock = form.mock_response || { enabled: true, status: 200, headers: {} }
                        handleChange('mock_response', { ...mock, body: e.target.value })
                      }}
                      placeholder='{\n  "message": "Mocked API Response",\n  "id": "{{uuid}}"\n}'
                      rows={5}
                      spellCheck={false}
                      className="w-full font-mono text-xs p-3 mt-1.5 border border-border rounded-lg bg-[#07090d] text-slate-100 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {(sending || response) && isWsTarget ? (
            <WebSocketInspector response={response} loading={sending} />
          ) : (sending || response) && (
            <ResponseInspector
              response={response}
              loading={sending}
              onExtract={testId ? handleExtract : undefined}
              extractDestinationName={currentEnvName}
              extractors={form.extractors || {}}
            />
          )}
        </main>
      </div>
      <CodeSnippetDialog
        open={isSnippetDialogOpen}
        onOpenChange={setIsSnippetDialogOpen}
        form={form}
        absoluteUrl={absoluteUrl}
      />
      <CurlImportDialog
        open={isCurlImportOpen}
        onOpenChange={setIsCurlImportOpen}
        onImport={handleCurlImport}
      />
    </div>
  )
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-4 py-3">
        <span className="text-cyan-500">{icon}</span>
        <h2 className="text-sm font-bold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function Pill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] font-semibold text-muted-foreground">
      {icon}
      {label}
    </span>
  )
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-sm font-bold">
      <span className="text-cyan-500">{icon}</span>
      {title}
    </div>
  )
}
