import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  Braces,
  Cookie,
  DatabaseZap,
  FileJson,
  Globe2,
  KeyRound,
  Save,
  Sparkles,
} from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { KVEditor } from './KVEditor'
import { PayloadEditor } from './PayloadEditor'
import { toast } from './ui/toast'
import { TestConfig } from '../types'

interface Props {
  testId: string | null
  config: TestConfig
  currentProjectName?: string
  currentEnvName?: string
  onClose: () => void
  onSave: () => void
}

type AuthType = 'none' | 'inherit' | 'bearer' | 'apikey' | 'basic' | 'custom'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const BODY_TYPES = [
  { value: 'json', label: 'JSON' },
  { value: 'form', label: 'Form' },
  { value: 'multipart', label: 'Multipart' },
] as const

const METHOD_STYLES: Record<string, string> = {
  GET: 'text-emerald-600 dark:text-emerald-400',
  POST: 'text-cyan-600 dark:text-cyan-400',
  PUT: 'text-amber-600 dark:text-amber-400',
  PATCH: 'text-violet-600 dark:text-violet-400',
  DELETE: 'text-red-600 dark:text-red-400',
}

const DYNAMIC_TOKENS = ['{{random_email}}', '{{uuid}}', '{{timestamp}}', '{{random_string:12}}']

function getDefaultForm() {
  return {
    name: 'New Endpoint',
    url: '/your-endpoint',
    method: 'POST',
    payload_type: 'json',
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

  const save = async () => {
    const name = String(form.name || '').trim()
    const urlValue = String(form.url || '').trim()
    if (!name) {
      toast.error('Endpoint name is required')
      return
    }
    if (!urlValue) {
      toast.error('Endpoint URL is required')
      return
    }

    const headers = { ...(form.headers || {}) }
    const cookies = form.cookies || {}
    if (Object.keys(cookies).length > 0) {
      headers.Cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    }

    const payloadToSend = {
      ...form,
      name,
      url: urlValue,
      headers,
      cookies: undefined,
    }

    setSaving(true)
    try {
      const res = await fetch(testId ? `/tests/${testId}` : '/tests', {
        method: testId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadToSend),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(testId ? 'Endpoint updated' : 'Endpoint created')
      onSave()
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
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
              <Save className="h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save endpoint'}
            </Button>
          </div>
        </div>
      </div>

      <div className="endpoint-editor-grid px-3 pb-8 pt-4">
        <aside className="space-y-3">
          <Panel title="Request" icon={<Globe2 className="h-4 w-4" />}>
            <div className="space-y-2.5">
              <div className="grid grid-cols-5 rounded-lg border border-border bg-muted/35 p-0.5">
                {METHODS.map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => handleChange('method', method)}
                    className={`h-7 min-w-0 rounded-md px-1 text-center font-mono text-[10px] font-extrabold transition-all ${
                      form.method === method
                        ? 'bg-background shadow-sm ring-1 ring-border ' + METHOD_STYLES[method]
                        : 'text-muted-foreground hover:bg-background/70'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>

              <Field label="Request endpoint">
                <Input
                  value={form.url || ''}
                  onChange={(e) => handleChange('url', e.target.value)}
                  className="h-9 font-mono text-sm"
                  placeholder="/api/endpoint"
                />
              </Field>

              <Field label="Body type">
                <select
                  value={form.payload_type}
                  onChange={(e) => handleChange('payload_type', e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs font-semibold"
                >
                  {BODY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </Field>

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
            <div className="flex flex-wrap gap-2">
              {DYNAMIC_TOKENS.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(token).then(() => toast.success(`Copied ${token}`)).catch(() => {})}
                  className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {token}
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
                  <h2 className="text-sm font-bold">Request builder</h2>
                </div>
                <p className="mt-1 max-w-2xl truncate font-mono text-xs text-muted-foreground">{absoluteUrl}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Pill icon={<BadgeCheck className="h-3 w-3" />} label={form.payload_type?.toUpperCase?.() || 'JSON'} />
                <Pill icon={<DatabaseZap className="h-3 w-3" />} label={`${extractorCount} extractor${extractorCount === 1 ? '' : 's'}`} />
              </div>
            </div>

            <div className="grid gap-0 2xl:grid-cols-[minmax(0,1fr)_420px]">
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
            </div>
          </div>

          <div className="grid gap-4 2xl:grid-cols-2">
            <Panel title="Headers" icon={<Braces className="h-4 w-4" />}>
              <KVEditor data={form.headers || {}} onChange={(h) => handleChange('headers', h)} />
            </Panel>
            <Panel title="Cookies" icon={<Cookie className="h-4 w-4" />}>
              <KVEditor data={form.cookies || {}} onChange={(c) => handleChange('cookies', c)} />
            </Panel>
          </div>
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
