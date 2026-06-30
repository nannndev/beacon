import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { RunResponse } from '../types'
import { Copy, Check } from 'lucide-react'

export interface RunStats {
  attempts: number
  success: number
  rate_limited: number
  errors: number
  status_codes?: Record<string, number>
  recent_ms?: number[]
  latency_ms?: { avg: number; min: number; max: number; last: number }
  elapsed_s?: number
  rps?: number
}

export type RunStatus = 'idle' | 'running' | 'finished' | 'stopped'

interface Props {
  logs: string[]
  responses: RunResponse[]
  stats: RunStats
  status: RunStatus
  maxRequests?: number
  runningName?: string
  onStop: () => void
  onClear: () => void
}

const statusBadge: Record<RunStatus, { label: string; className: string }> = {
  idle: { label: 'Idle', className: 'bg-muted text-muted-foreground' },
  running: { label: '● Running', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 animate-pulse' },
  finished: { label: 'Finished', className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  stopped: { label: 'Stopped', className: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400' },
}

export default function LiveMonitor({ logs, responses, stats, status, maxRequests, runningName, onStop, onClear }: Props) {
  const logRef = useRef<HTMLDivElement>(null)
  const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null)
  const [followLatest, setFollowLatest] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  useEffect(() => {
    if (responses.length === 0) {
      setSelectedAttempt(null)
      return
    }
    if (followLatest) {
      setSelectedAttempt(responses[responses.length - 1].attempt)
    }
  }, [responses, followLatest])

  const selected = responses.find((r) => r.attempt === selectedAttempt) ?? null
  const successRate = stats.attempts > 0 ? Math.round((stats.success / stats.attempts) * 100) : 0
  const progress = maxRequests && maxRequests > 0 ? Math.min(100, Math.round((stats.attempts / maxRequests) * 100)) : 0
  const badge = statusBadge[status]
  const lat = stats.latency_ms
  const showSummary = stats.attempts > 0

  const copyBody = async () => {
    const text = selected ? formatBody(selected) : ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-2.5 px-4">
        <div className="flex items-center gap-3">
          <CardTitle className="text-sm">Live Monitor</CardTitle>
          <Badge className={badge.className}>{badge.label}</Badge>
          {runningName && status === 'running' && (
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{runningName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status === 'running' && (
            <Button variant="destructive" size="sm" onClick={onStop}>Stop</Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClear} disabled={status === 'running'}>Clear</Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {(status === 'running' || stats.attempts > 0) && maxRequests ? (
          <div className="mb-3">
            <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
              <span>Progress</span>
              <span>{stats.attempts} / {maxRequests}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-sm">
          <StatCard label="Attempts" value={stats.attempts} />
          <StatCard label="Success" value={stats.success} tone="text-green-600 dark:text-green-400"
            sub={stats.attempts > 0 ? `${successRate}%` : undefined} />
          <StatCard label="Rate Limited" value={stats.rate_limited} tone="text-yellow-600 dark:text-yellow-400" />
          <StatCard label="Errors" value={stats.errors} tone="text-red-600 dark:text-red-400" />
        </div>

        {showSummary && (
          <div className="mb-3 space-y-3">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <Metric label="Avg" value={`${lat?.avg ?? 0}ms`} />
              <Metric label="Min" value={`${lat?.min ?? 0}ms`} />
              <Metric label="Max" value={`${lat?.max ?? 0}ms`} />
              <Metric label="Last" value={`${lat?.last ?? 0}ms`} />
              <Metric label="Req/s" value={`${stats.rps ?? 0}`} />
              <Metric label="Elapsed" value={`${stats.elapsed_s ?? 0}s`} />
            </div>

            {stats.recent_ms && stats.recent_ms.length > 1 && (
              <div>
                <div className="text-[11px] text-muted-foreground mb-0.5">Response time (recent)</div>
                <Sparkline data={stats.recent_ms} />
              </div>
            )}

            {stats.status_codes && Object.keys(stats.status_codes).length > 0 && (
              <div>
                <div className="text-[11px] text-muted-foreground mb-1">Status codes</div>
                <StatusBar codes={stats.status_codes} />
              </div>
            )}
          </div>
        )}

        <Tabs defaultValue="responses" className="w-full">
          <TabsList className="h-8 mb-2">
            <TabsTrigger value="responses" className="text-xs px-3 h-7">
              Responses {responses.length > 0 && <span className="ml-1.5 text-muted-foreground">({responses.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="logs" className="text-xs px-3 h-7">Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="responses" className="mt-0">
            {responses.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-xs text-muted-foreground border border-border rounded-lg bg-muted/30">
                Run an endpoint to inspect response bodies here.
              </div>
            ) : (
              <div className="flex gap-2 h-64 border border-border rounded-lg overflow-hidden bg-muted/20">
                <div className="w-36 shrink-0 overflow-auto border-r border-border bg-background/50">
                  {responses.map((r) => (
                    <button
                      key={r.attempt}
                      onClick={() => { setSelectedAttempt(r.attempt); setFollowLatest(false) }}
                      className={`w-full text-left px-2.5 py-2 text-[11px] font-mono border-b border-border/50 transition-colors ${
                        selectedAttempt === r.attempt ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60 text-muted-foreground'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">#{r.attempt}</span>
                        <ResponseStatusBadge response={r} />
                      </div>
                      {r.time != null && <div className="text-[10px] opacity-70 mt-0.5">{Math.round(r.time * 1000)}ms</div>}
                    </button>
                  ))}
                </div>

                <div className="flex-1 min-w-0 flex flex-col">
                  {selected ? (
                    <>
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background/60 text-xs shrink-0">
                        <span className="font-mono font-semibold">{selected.method}</span>
                        <span className="truncate text-muted-foreground flex-1" title={selected.url}>{selected.url}</span>
                        <ResponseStatusBadge response={selected} />
                        {selected.time != null && <span className="text-muted-foreground font-mono">{Math.round(selected.time * 1000)}ms</span>}
                        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={copyBody}>
                          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        </Button>
                        {status === 'running' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-6 px-2 text-[10px] ${followLatest ? 'text-primary' : ''}`}
                            onClick={() => setFollowLatest(true)}
                          >
                            Live
                          </Button>
                        )}
                      </div>
                      <pre className="flex-1 overflow-auto p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all">
                        {selected.error ? (
                          <span className="text-red-600 dark:text-red-400">{selected.error}</span>
                        ) : (
                          formatBody(selected)
                        )}
                      </pre>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                      Select a response
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs" className="mt-0">
            <div
              ref={logRef}
              className="log-container h-56 overflow-auto bg-muted/50 border border-border rounded-lg p-3 text-xs font-mono scroll-smooth"
            >
              {logs.length === 0 ? (
                <div className="text-muted-foreground">Run an endpoint to see live output here.</div>
              ) : (
                logs.map((line, i) => <div key={i} className={`py-0.5 ${lineColor(line)}`}>{line}</div>)
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function formatBody(r: RunResponse): string {
  if (!r.body) return '(empty body)'
  try {
    return JSON.stringify(JSON.parse(r.body), null, 2)
  } catch {
    return r.body
  }
}

function ResponseStatusBadge({ response: r }: { response: RunResponse }) {
  if (r.error) {
    return <Badge className="h-4 px-1 text-[9px] bg-red-500/15 text-red-600 dark:text-red-400">ERR</Badge>
  }
  if (r.rate_limited) {
    return <Badge className="h-4 px-1 text-[9px] bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">{r.status}</Badge>
  }
  if (r.success) {
    return <Badge className="h-4 px-1 text-[9px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">{r.status}</Badge>
  }
  return <Badge className="h-4 px-1 text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-400">{r.status}</Badge>
}

function StatCard({ label, value, tone, sub }: { label: string; value: number; tone?: string; sub?: string }) {
  return (
    <div className={`bg-muted/50 p-2.5 rounded-lg border border-border ${tone || ''}`}>
      <div className="text-[11px] opacity-70">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono font-semibold text-lg">{value}</span>
        {sub && <span className="text-[11px] opacity-70">{sub}</span>}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded-md border border-border px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold text-sm">{value}</div>
    </div>
  )
}

function codeColor(code: string): string {
  if (code === 'error') return 'bg-red-500'
  const n = parseInt(code, 10)
  if (n === 429) return 'bg-yellow-500'
  if (n >= 200 && n < 300) return 'bg-emerald-500'
  if (n >= 300 && n < 400) return 'bg-blue-500'
  if (n >= 400 && n < 500) return 'bg-amber-500'
  if (n >= 500) return 'bg-red-500'
  return 'bg-muted-foreground'
}

function StatusBar({ codes }: { codes: Record<string, number> }) {
  const entries = Object.entries(codes)
  const total = entries.reduce((s, [, n]) => s + n, 0)
  if (!total) return null
  return (
    <div>
      <div className="flex h-2 w-full rounded-full overflow-hidden bg-muted">
        {entries.map(([code, n]) => (
          <div key={code} className={codeColor(code)} style={{ width: `${(n / total) * 100}%` }} title={`${code}: ${n}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px]">
        {entries.map(([code, n]) => (
          <span key={code} className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${codeColor(code)}`} />
            <span className="font-mono">{code}</span>
            <span className="text-muted-foreground">{n}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Sparkline({ data }: { data: number[] }) {
  const w = 100, h = 28
  const max = Math.max(...data, 1)
  const min = Math.min(...data)
  const range = max - min || 1
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-8 text-primary">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function lineColor(line: string): string {
  const l = line.toLowerCase()
  if (l.includes('error') || l.includes('failed')) return 'text-red-600 dark:text-red-400'
  if (l.includes('rate') || l.includes('429') || l.includes('too many')) return 'text-yellow-600 dark:text-yellow-400'
  if (l.includes('success') || l.includes('200') || l.includes('finished')) return 'text-green-600 dark:text-green-400'
  return ''
}