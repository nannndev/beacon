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
  Save,
  Send,
  ShieldCheck,
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
import { toCurl } from '../lib/curl'
import { Terminal } from 'lucide-react'
import ResponseInspector from './ResponseInspector'
import { AssertionsEditor } from './AssertionsEditor'

interface Props {
  testId: string | null
  config: TestConfig
  currentProjectName?: string
  currentEnvName?: string
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

export default function EndpointEditor({ testId, config, currentProjectName, currentEnvName, onClose, onSave }: Props) {
  const [form, setForm] = useState<any>(getDefaultForm())
  const [authType, setAuthType] = useState<AuthType>('inherit')
  const [authVar, setAuthVar] = useState('access_token')
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
    } else {
      setForm(getDefaultForm())
      setAuthType('inherit')
      setAuthVar('access_token')
    }
  }, [testId, config])

  const headerCount = Object.keys(form.headers || {}).filter(Boolean).length
  const cookieCount = Object.keys(form.cookies || {}).filter(Boolean).length
  const extractorCount = Object.keys(form.extractors || {}).filter(Boolean).length
  const methodClass = METHOD_STYLES[form.method] || 'text-foreground'
  const isWebTarget = form.target_type === 'web'
  const absoluteUrl = useMemo(() => {
    const url = form.url || ''
    if (!url) return config.base_url || 'base url not set'
    if (/^https?:\/\//i.test(url)) return url
    const base = (config.base_url || '').replace(/\/$/, '')
    return base ? `${base}/${url.replace(/^\//, '')}` : url
  }, [config.base_url, form.url])

  const handleChange = (field: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [field]: value }))
  }

  const changeTargetType = (targetType: 'api' | 'web') => {
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

  const updateAuth = (type: string, variable?: string) => {
    const nextType = type as AuthType
    setAuthType(nextType)
    if (variable) setAuthVar(variable)

    if (nextType === 'none' || nextType === 'inherit') {
      const { Authorization, ...rest } = form.headers || {}
      handleChange('headers', rest)
      return
    }

    const token = variable || authVar
    const authValue =
      nextType === 'bearer' ? `Bearer {{${token}}}` :
      nextType === 'apikey' ? `{{${token}}}` :
      nextType === 'basic' ? `Basic {{${token || 'username:password'}}}` :
      `{{${token}}}`

    handleChange('headers', {
      ...(form.headers || {}),
      Authorization: authValue,
    })
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

  // Click-to-extract: add `varName <- path` to the endpoint's extractors and
  // persist. The value is captured on the next 2xx Send (standard extractor flow).
  const handleExtract = async (varName: string, path: string) => {
    const nextExtractors = { ...(form.extractors || {}), [varName]: path }
    handleChange('extractors', nextExtractors)
    if (!testId) return
    try {
      await api.updateTest(testId, { ...buildPayload(), extractors: nextExtractors } as Partial<Endpoint>)
      toast.success(`Extractor saved: {{${varName}}} ← ${path}. Next Send captures it.`)
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save extractor')
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
              <span className="truncate font-mono">{absoluteUrl}</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => navigator.clipboard?.writeText(toCurl(form, absoluteUrl)).then(() => toast.success('Copied as cURL')).catch(() => toast.error('Copy failed'))}
              title="Copy this request as a curl command"
            >
              <Terminal className="h-3.5 w-3.5" /> cURL
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
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/35 p-1">
                  <button
                    type="button"
                    aria-pressed={!isWebTarget}
                    onClick={() => changeTargetType('api')}
                    className={`flex min-h-14 items-center gap-2 rounded-md px-3 text-left transition-colors ${
                      !isWebTarget ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/60'
                    }`}
                  >
                    <Braces className="h-4 w-4 shrink-0 text-cyan-500" />
                    <span><span className="block text-xs font-bold">API Request</span><span className="block text-[10px]">JSON, form, or raw</span></span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={isWebTarget}
                    onClick={() => changeTargetType('web')}
                    className={`flex min-h-14 items-center gap-2 rounded-md px-3 text-left transition-colors ${
                      isWebTarget ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/60'
                    }`}
                  >
                    <Globe2 className="h-4 w-4 shrink-0 text-cyan-500" />
                    <span><span className="block text-xs font-bold">Web Page</span><span className="block text-[10px]">HTML document load</span></span>
                  </button>
                </div>
              </Field>

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

              <Field label={isWebTarget ? 'Website URL' : 'Request endpoint'}>
                <Input
                  value={form.url || ''}
                  onChange={(e) => handleChange('url', e.target.value)}
                  className="h-9 font-mono text-sm"
                  placeholder={isWebTarget ? 'https://example.com/' : '/api/endpoint'}
                />
              </Field>

              {!isWebTarget && <Field label="Body type">
                <select
                  value={form.payload_type}
                  onChange={(e) => handleChange('payload_type', e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs font-semibold"
                >
                  {BODY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </Field>}

              {isWebTarget && (
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-[11px] leading-5 text-muted-foreground">
                  Measures the HTML document request, redirects, response size, TTFB, latency, throughput, and failures. It does not execute JavaScript or download page assets.
                </div>
              )}

              <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold text-muted-foreground">
                <span className="rounded-md border border-border bg-background px-2 py-1">{headerCount} headers</span>
                <span className="rounded-md border border-border bg-background px-2 py-1">{cookieCount} cookies</span>
                <span className="rounded-md border border-border bg-background px-2 py-1">{extractorCount} extractors</span>
              </div>
            </div>
          </Panel>

          <Panel title="Authorization" icon={<KeyRound className="h-4 w-4" />}>
            <div className="space-y-3">
              <Field label="Auth type">
                <select
                  value={authType}
                  onChange={(e) => updateAuth(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="inherit">Inherit from environment</option>
                  <option value="none">None</option>
                  <option value="bearer">Bearer token</option>
                  <option value="apikey">API key</option>
                  <option value="basic">Basic auth</option>
                  <option value="custom">Custom</option>
                </select>
              </Field>

              {authType !== 'none' && authType !== 'inherit' && (
                <Field label="Variable / value">
                  <div className="flex gap-2">
                    <Input
                      value={authVar}
                      onChange={(e) => updateAuth(authType, e.target.value)}
                      className="h-9 flex-1 font-mono text-sm"
                      placeholder="access_token"
                    />
                    <Button variant="outline" size="sm" className="h-9" onClick={() => updateAuth(authType, 'access_token')}>token</Button>
                    <Button variant="outline" size="sm" className="h-9" onClick={() => updateAuth(authType, 'api_key')}>key</Button>
                  </div>
                </Field>
              )}

              <div className="rounded-lg border border-border bg-muted/35 p-3 text-xs">
                {form.headers?.Authorization ? (
                  <code className="break-all font-mono">{form.headers.Authorization}</code>
                ) : authType === 'inherit' ? (
                  <span className="text-emerald-600 dark:text-emerald-400">Using auth from the active environment.</span>
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

          {(sending || response) && (
            <ResponseInspector response={response} loading={sending} onExtract={testId ? handleExtract : undefined} />
          )}
        </main>
      </div>
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
