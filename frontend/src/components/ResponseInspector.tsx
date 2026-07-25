import { useEffect, useMemo, useState } from 'react'
import { Clock, HardDrive, Plus, AlertTriangle, Braces, FileJson, BadgeCheck, Globe2, Route, DatabaseZap, RadioTower, ScanLine, Copy, Check, ChevronDown, ChevronRight, FoldVertical, UnfoldVertical } from 'lucide-react'
import type { AssertionResult, SendResponse } from '../lib/api'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

type Tab = 'body' | 'headers' | 'extracted' | 'assertions'
type TreeCommand = { action: 'expand' | 'collapse'; nonce: number }

interface Props {
  response: SendResponse | null
  loading: boolean
  /** Add an extractor to the endpoint: varName <- body.<path>. Only offered
   *  when editing a saved endpoint. */
  onExtract?: (varName: string, path: string, value: unknown) => Promise<void> | void
  extractDestinationName?: string
  extractors?: Record<string, string>
}

const fmtSize = (n?: number) => {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** Classify the response body by content-type so the Body tab can render it
 *  appropriately (JSON tree, indented XML/HTML, or plain text). */
function bodyKind(ctype?: string, hasJson?: boolean): 'json' | 'xml' | 'html' | 'text' {
  const c = (ctype || '').toLowerCase()
  if (hasJson || c.includes('json')) return 'json'
  if (c.includes('xml')) return 'xml'
  if (c.includes('html')) return 'html'
  return 'text'
}

/** Minimal, dependency-free XML/HTML indenter for readability. */
function prettyXml(src: string): string {
  const s = src.replace(/>\s*</g, '><').trim()
  let out = ''
  let depth = 0
  s.split(/(<[^>]+>)/g).forEach((tok) => {
    if (!tok) return
    if (/^<\/.+>/.test(tok)) {
      depth = Math.max(0, depth - 1)
      out += '  '.repeat(depth) + tok + '\n'
    } else if (/^<[^!?][^>]*[^/]>$/.test(tok) && !/^<.*<\/.*>$/.test(tok)) {
      out += '  '.repeat(depth) + tok + '\n'
      depth += 1
    } else {
      out += '  '.repeat(depth) + tok + '\n'
    }
  })
  return out.trim() || src
}

function statusTone(status?: number): string {
  if (!status) return 'bg-muted text-muted-foreground'
  if (status >= 200 && status < 300) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30'
  if (status >= 300 && status < 400) return 'bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/30'
  if (status >= 400 && status < 500) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30'
  return 'bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/30'
}

function assertionTitle(assertion: AssertionResult): string {
  if (assertion.message) return assertion.message.split('; received')[0]
  return `${assertion.type} ${assertion.op} ${JSON.stringify(assertion.expected)}`
}

function assertionValue(assertion: AssertionResult): string {
  if (assertion.actual === undefined || assertion.actual === null) return assertion.ok ? 'passed' : 'not found'
  const value = typeof assertion.actual === 'string' ? assertion.actual : JSON.stringify(assertion.actual)
  return assertion.type === 'time_ms' ? `${value} ms` : value
}

function AssertionResultsPanel({ assertions }: { assertions: AssertionResult[] }) {
  const passed = assertions.reduce((total, assertion) => total + Number(assertion.ok), 0)
  const failed = assertions.length - passed

  return (
    <aside className="min-h-0 border-t border-border bg-muted/10 lg:border-l lg:border-t-0" aria-label="Assertion results">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <BadgeCheck className="h-4 w-4 text-cyan-500" />
        <h3 className="text-sm font-bold">Assertions</h3>
        <span className="font-mono text-xs text-muted-foreground">({passed}/{assertions.length})</span>
      </div>
      <div className="max-h-[460px] overflow-auto p-3">
        <div className="mb-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/12 px-2.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" /> {passed} passed
          </span>
          {failed > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-xs font-bold text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" /> {failed} failed
            </span>
          )}
        </div>

        <div className="space-y-2">
          {assertions.map((assertion, index) => (
            <details
              key={`${assertion.type}-${index}`}
              className={`group overflow-hidden rounded-lg border transition-colors ${
                assertion.ok
                  ? 'border-border bg-background/55 hover:border-emerald-500/30'
                  : 'border-red-500/30 bg-red-500/[0.06] hover:border-red-500/50'
              }`}
            >
              <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-xs [&::-webkit-details-marker]:hidden">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                  assertion.ok ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'
                }`}>
                  {assertion.ok ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3 w-3" />}
                </span>
                <span className={`min-w-0 flex-1 truncate font-medium ${assertion.ok ? '' : 'text-red-600 dark:text-red-300'}`} title={assertionTitle(assertion)}>
                  {assertionTitle(assertion)}
                </span>
                <span className={`max-w-28 truncate font-mono font-semibold ${assertion.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`} title={assertionValue(assertion)}>
                  {assertionValue(assertion)}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-border/70 bg-muted/20 px-3 py-2 font-mono text-[10px]">
                <dt className="text-muted-foreground">Rule</dt>
                <dd className="break-all">{assertion.type} {assertion.op}</dd>
                <dt className="text-muted-foreground">Expected</dt>
                <dd className="break-all">{JSON.stringify(assertion.expected)}</dd>
                <dt className="text-muted-foreground">Actual</dt>
                <dd className={assertion.ok ? 'break-all' : 'break-all text-red-500'}>{JSON.stringify(assertion.actual)}</dd>
              </dl>
            </details>
          ))}
        </div>
      </div>
    </aside>
  )
}

export default function ResponseInspector({ response, loading, onExtract, extractDestinationName, extractors }: Props) {
  const [tab, setTab] = useState<Tab>('body')
  const [raw, setRaw] = useState(false)
  const [capture, setCapture] = useState<{ path: string; value: unknown; name: string } | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [loadingStage, setLoadingStage] = useState(0)
  const [copied, setCopied] = useState(false)
  const [treeCommand, setTreeCommand] = useState<TreeCommand>({ action: 'expand', nonce: 0 })
  const linkedPaths = useMemo(
    () => Object.fromEntries(Object.entries(extractors || {}).map(([name, path]) => [path, name])),
    [extractors],
  )

  useEffect(() => {
    if (!loading) {
      setLoadingStage(0)
      return
    }
    const timers = [
      window.setTimeout(() => setLoadingStage(1), 650),
      window.setTimeout(() => setLoadingStage(2), 1700),
    ]
    return () => timers.forEach(window.clearTimeout)
  }, [loading])

  const copyResponseBody = async () => {
    if (!response) return
    const text = response.json != null ? JSON.stringify(response.json, null, 2) : (response.body || '')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  useEffect(() => {
    if (!response || loading) return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        void copyResponseBody()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [response, loading])

  const saveCapture = async () => {
    if (!capture || !capture.name.trim() || !onExtract) return
    setCapturing(true)
    try {
      await onExtract(capture.name.trim(), capture.path, capture.value)
      setCapture(null)
    } finally {
      setCapturing(false)
    }
  }

  if (loading) {
    const stages = ['Dispatching request', 'Waiting for response', 'Preparing inspector']
    return (
      <section className="relative overflow-hidden rounded-xl border border-border bg-card" aria-live="polite" aria-busy="true">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden bg-cyan-500/10">
          <span className="animate-indeterminate block h-full w-1/3 bg-cyan-400 shadow-[0_0_14px_rgba(34,211,238,0.9)] motion-reduce:animate-none" />
        </div>
        <div className="flex items-center gap-3 border-b border-border bg-muted/20 px-4 py-3">
          <span className="relative grid h-8 w-8 place-items-center rounded-lg border border-cyan-500/20 bg-cyan-500/10 text-cyan-500">
            <RadioTower className="h-4 w-4" />
            <span className="absolute inset-0 animate-ping rounded-lg border border-cyan-400/30 motion-reduce:animate-none" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold">{stages[loadingStage]}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">The endpoint list stays available while this request is in flight.</p>
          </div>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
            <ScanLine className="h-3.5 w-3.5 animate-pulse motion-reduce:animate-none" /> live
          </span>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-[0.38fr_0.62fr]">
          <div className="space-y-3 rounded-lg border border-border/70 bg-muted/15 p-3">
            <div className="h-5 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="h-2 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="h-2 w-4/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="flex gap-2 pt-2">
              <div className="h-6 w-14 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-6 w-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            </div>
          </div>
          <div className="space-y-2 rounded-lg border border-border/70 bg-slate-950 p-4">
            {[72, 88, 55, 81, 44].map((width, index) => (
              <div
                key={width}
                className="h-2 animate-pulse rounded bg-slate-700/70 motion-reduce:animate-none"
                style={{ width: `${width}%`, animationDelay: `${index * 90}ms` }}
              />
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (!response) return null

  if (!response.ok) {
    return (
      <section className="rounded-xl border border-red-500/30 bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-red-500/10 px-4 py-3">
          <span className="text-red-500"><AlertTriangle className="h-4 w-4" /></span>
          <h2 className="text-sm font-bold">Request failed</h2>
          {response.time_ms != null && (
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" /> {response.time_ms} ms
            </span>
          )}
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-xs text-red-600 dark:text-red-400">{response.error}</pre>
      </section>
    )
  }

  const headers = response.headers || {}
  const kind = bodyKind(response.content_type, response.json != null)
  const canToggleRaw = kind === 'json' || kind === 'xml' || kind === 'html'
  const assertions = response.assertions || []
  const showAssertionsSplit = assertions.length > 0 && (tab === 'body' || tab === 'assertions')

  return (
    <section className="rounded-xl border border-border bg-card">
      {/* status bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/25 px-4 py-3">
        <span className={`rounded-md px-2 py-0.5 font-mono text-xs font-extrabold ${statusTone(response.status)}`}>
          {response.status} {response.reason}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" /> {response.time_ms} ms
        </span>
        {response.target_type === 'web' && response.ttfb_ms != null && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Time to first response headers">
            <Globe2 className="h-3 w-3" /> TTFB {response.ttfb_ms} ms
          </span>
        )}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <HardDrive className="h-3 w-3" /> {fmtSize(response.size_bytes)}{response.truncated ? ' (truncated)' : ''}
        </span>
        {response.content_type && (
          <span className="truncate font-mono text-[11px] text-muted-foreground">{response.content_type}</span>
        )}
        {response.attempts && response.attempts > 1 && (
          <span className="text-[11px] text-muted-foreground">{response.attempts} tries</span>
        )}
        {response.target_type === 'web' && (
          <span className="rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-bold text-cyan-700 dark:text-cyan-300">
            web page
          </span>
        )}
        {response.redirects != null && response.redirects > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Route className="h-3 w-3" /> {response.redirects} redirect{response.redirects === 1 ? '' : 's'}
          </span>
        )}
        {response.passed != null && (
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${response.passed ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'}`}>
            {response.passed ? '✓ assertions passed' : '✗ assertions failed'}
          </span>
        )}
        {response.extracted && response.extracted.length > 0 && (
          <span className="ml-auto rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            saved: {response.extracted.join(', ')}
          </span>
        )}
      </div>

      {response.final_url && response.final_url !== response.target && (
        <div className="border-b border-border bg-muted/10 px-4 py-2 font-mono text-[11px] text-muted-foreground">
          Final URL: <span className="break-all text-foreground">{response.final_url}</span>
        </div>
      )}

      {/* tabs */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <TabBtn active={tab === 'body'} onClick={() => setTab('body')} icon={<FileJson className="h-3.5 w-3.5" />}>Body</TabBtn>
        <TabBtn active={tab === 'headers'} onClick={() => setTab('headers')} icon={<Braces className="h-3.5 w-3.5" />}>
          Headers <span className="text-muted-foreground">({Object.keys(headers).length})</span>
        </TabBtn>
        {response.extracted && response.extracted.length > 0 && (
          <TabBtn active={tab === 'extracted'} onClick={() => setTab('extracted')} icon={<Plus className="h-3.5 w-3.5" />}>Extracted</TabBtn>
        )}
        {response.assertions && response.assertions.length > 0 && (
          <TabBtn active={tab === 'assertions'} onClick={() => setTab('assertions')} icon={<BadgeCheck className="h-3.5 w-3.5" />}>
            Assertions <span className="text-muted-foreground">({response.assertions.filter((a) => a.ok).length}/{response.assertions.length})</span>
          </TabBtn>
        )}
        {tab === 'body' && (
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">{kind}</span>
            {kind === 'json' && !raw && (
              <>
                <button
                  type="button"
                  onClick={() => setTreeCommand((current) => ({ action: 'collapse', nonce: current.nonce + 1 }))}
                  className="rounded-md border border-border p-1 text-muted-foreground hover:text-foreground"
                  title="Collapse all nested keys"
                  aria-label="Collapse all nested response keys"
                >
                  <FoldVertical className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setTreeCommand((current) => ({ action: 'expand', nonce: current.nonce + 1 }))}
                  className="rounded-md border border-border p-1 text-muted-foreground hover:text-foreground"
                  title="Expand all nested keys"
                  aria-label="Expand all nested response keys"
                >
                  <UnfoldVertical className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void copyResponseBody()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              title="Copy response body (⌘/Ctrl + Shift + C)"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
              <kbd className="hidden rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground sm:inline">⌘⇧C</kbd>
            </button>
            {canToggleRaw && (
              <button
                onClick={() => setRaw((r) => !r)}
                className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              >
                {raw ? 'Pretty' : 'Raw'}
              </button>
            )}
          </div>
        )}
      </div>

      <div className={showAssertionsSplit ? 'grid min-h-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]' : 'max-h-[460px] overflow-auto p-4'}>
        <div className={showAssertionsSplit ? 'max-h-[460px] min-w-0 overflow-auto p-4' : ''}>
        {(tab === 'body' || tab === 'assertions') && (() => {
          if (kind === 'json' && response.json != null && !raw)
            return <JsonView value={response.json} path={[]} onCapture={onExtract ? setCapture : undefined} linkedPaths={linkedPaths} command={treeCommand} />
          if ((kind === 'xml' || kind === 'html') && !raw)
            return <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs">{prettyXml(response.body || '')}</pre>
          return <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs">{response.body}</pre>
        })()}
        {tab === 'headers' && (
          <table className="w-full text-left font-mono text-xs">
            <tbody>
              {Object.entries(headers).map(([k, v]) => (
                <tr key={k} className="border-b border-border/50">
                  <td className="py-1 pr-3 align-top font-semibold text-muted-foreground">{k}</td>
                  <td className="py-1 break-all">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'extracted' && (
          <ul className="space-y-1 text-xs">
            {(response.extracted || []).map((name) => (
              <li key={name} className="font-mono text-emerald-700 dark:text-emerald-300">{`{{${name}}}`} refreshed</li>
            ))}
          </ul>
        )}
        </div>
        {showAssertionsSplit && <AssertionResultsPanel assertions={assertions} />}
      </div>
      <Dialog open={capture !== null} onOpenChange={(open) => { if (!open && !capturing) setCapture(null) }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><DatabaseZap className="h-4 w-4 text-cyan-500" /> Capture response value</DialogTitle>
          </DialogHeader>
          {capture ? (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 text-xs sm:grid-cols-2">
                <div><div className="text-muted-foreground">Source</div><code className="mt-1 block break-all">{capture.path}</code></div>
                <div><div className="text-muted-foreground">Save to</div><div className="mt-1 font-semibold text-emerald-600 dark:text-emerald-400">{extractDestinationName || 'Active environment'}</div></div>
              </div>
              <div>
                <Label htmlFor="capture-variable-name">Variable name</Label>
                <Input id="capture-variable-name" autoFocus value={capture.name} onChange={(event) => setCapture({ ...capture, name: event.target.value })} className="mt-1.5 font-mono" placeholder="access_token" />
              </div>
              <div>
                <Label>Captured value</Label>
                <div className="mt-1.5 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
                  {maskCaptureValue(capture.value)}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">The value is masked here and stored in the active environment. The extractor keeps it fresh on future sends.</p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCapture(null)} disabled={capturing}>Cancel</Button>
            <Button onClick={() => void saveCapture()} disabled={capturing || !capture?.name.trim()}>{capturing ? 'Capturing…' : 'Capture variable'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function maskCaptureValue(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  if (!raw) return String(raw)
  if (raw.length <= 8) return '•'.repeat(raw.length)
  return `${raw.slice(0, 4)}${'•'.repeat(Math.min(16, raw.length - 8))}${raw.slice(-4)}`
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon} {children}
    </button>
  )
}

/** Recursive JSON tree. Leaf values expose a "save as variable" action that
 *  builds the extractor path (body.<a>.<b>.<index>) from the node's location. */
function JsonView({ value, path, onCapture, linkedPaths, command }: { value: unknown; path: (string | number)[]; onCapture?: (capture: { path: string; value: unknown; name: string }) => void; linkedPaths: Record<string, string>; command: TreeCommand }) {
  const indent = { paddingLeft: path.length ? 12 : 0 }
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (path.length > 0) setCollapsed(command.action === 'collapse')
  }, [command.nonce])

  if (value !== null && typeof value === 'object') {
    const entries: [string | number, unknown][] = Array.isArray(value)
      ? value.map((v, i) => [i, v])
      : Object.entries(value as Record<string, unknown>)
    const open = Array.isArray(value) ? '[' : '{'
    const close = Array.isArray(value) ? ']' : '}'
    if (entries.length === 0) {
      return <span className="font-mono text-xs text-muted-foreground">{open}{close}</span>
    }
    const summary = Array.isArray(value) ? `Array(${entries.length})` : `Object(${entries.length})`
    return (
      <div style={indent} className="font-mono text-xs">
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          className="mr-1 inline-flex h-4 w-4 translate-y-0.5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${path.length ? `response key ${path.join('.')}` : 'response root'}`}
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {collapsed ? (
          <button type="button" onClick={() => setCollapsed(false)} className="text-muted-foreground hover:text-foreground">
            {open}<span className="mx-1 text-[10px]">{summary}</span>{close}
          </button>
        ) : (
          <>
            <span className="text-muted-foreground">{open}</span>
            {entries.map(([k, v]) => (
              <div key={String(k)} className="pl-3">
                <span className="text-sky-600 dark:text-sky-400">{Array.isArray(value) ? k : `"${k}"`}</span>
                <span className="text-muted-foreground">: </span>
                <JsonView value={v} path={[...path, k]} onCapture={onCapture} linkedPaths={linkedPaths} command={command} />
              </div>
            ))}
            <span className="text-muted-foreground">{close}</span>
          </>
        )}
      </div>
    )
  }

  // leaf
  const display =
    typeof value === 'string' ? `"${value}"`
      : value === null ? 'null'
      : String(value)
  const tone =
    typeof value === 'string' ? 'text-emerald-600 dark:text-emerald-400'
      : typeof value === 'number' ? 'text-amber-600 dark:text-amber-400'
      : 'text-purple-600 dark:text-purple-400'

  const pathStr = 'body.' + path.join('.')
  const canExtract = !!onCapture && path.length > 0
  const linkedVariable = linkedPaths[pathStr]

  return (
    <span className="group inline-flex items-center gap-1">
      <span className={`break-all ${tone}`}>{display}</span>
      {linkedVariable ? <span className="rounded bg-cyan-500/10 px-1 font-mono text-[9px] text-cyan-600 dark:text-cyan-400">→ {`{{${linkedVariable}}}`}</span> : null}
      {canExtract && (
        <button
          type="button"
          title={`Capture as environment variable (from ${pathStr})`}
          aria-label={`Capture ${pathStr} as environment variable`}
          onClick={() => {
            const def = String(path[path.length - 1])
            onCapture!({ name: def, path: pathStr, value })
          }}
          className="opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Plus className="h-3 w-3 text-cyan-500 hover:text-cyan-400" />
        </button>
      )}
    </span>
  )
}
