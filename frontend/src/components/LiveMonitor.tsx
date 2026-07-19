import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { JsonCodeEditor } from './JsonCodeEditor'
import { OperationsChart } from './OperationsChart'
import {
  appendBounded,
  deriveInstantRps,
  percentile,
  type ChartPoint,
  type StatsSnapshot,
} from './liveMonitorMetrics'
import { RunResponse } from '../types'
import { Copy, Check, Play, Pause, Download, ChevronDown, History } from 'lucide-react'
import { useExport, ExportFormat } from '../hooks/useExport'

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
export type LogFilter = 'all' | 'success' | 'fail' | 'rate' | 'error'

interface RunQueueProgress {
  current: number
  total: number
}

interface Props {
  logs: string[]
  responses: RunResponse[]
  stats: RunStats
  status: RunStatus
  maxRequests?: number
  runQueue?: RunQueueProgress | null
  runningName?: string
  onStop: () => void
  onClear: () => void
  onViewHistory?: () => void
}

const statusBadge: Record<RunStatus, { label: string; className: string }> = {
  idle:     { label: 'Idle',      className: 'bg-muted text-muted-foreground' },
  running:  { label: '● Running', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 animate-pulse' },
  finished: { label: 'Finished',  className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  stopped:  { label: 'Stopped',   className: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400' },
}

export default function LiveMonitor({ logs, responses, stats, status, maxRequests, runQueue, runningName, onStop, onClear, onViewHistory }: Props) {
  const logRef = useRef<HTMLDivElement>(null)
  const responsesListRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null)
  const [followLatest, setFollowLatest] = useState(true)
  const [copied, setCopied] = useState(false)
  const [liveElapsed, setLiveElapsed] = useState(0)
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([])
  const [chartExpanded, setChartExpanded] = useState(false)
  const previousSnapshotRef = useRef<StatsSnapshot | null>(null)

  const { exportRun } = useExport()

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  // Follow latest response selection
  useEffect(() => {
    if (responses.length === 0) { setSelectedAttempt(null); return }
    if (followLatest) setSelectedAttempt(responses[responses.length - 1].attempt)
  }, [responses, followLatest])

  // Auto-scroll the responses list to bottom when following latest (like logs)
  useEffect(() => {
    if (followLatest && responsesListRef.current && responses.length > 0) {
      responsesListRef.current.scrollTop = responsesListRef.current.scrollHeight
    }
  }, [responses, followLatest])

  // Live elapsed timer — ticks every second while running
  useEffect(() => {
    if (status !== 'running') return
    setLiveElapsed(stats.elapsed_s ?? 0)
    const id = setInterval(() => setLiveElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [status]) // reset when status changes

  // Reset chart history when a new run starts.
  useEffect(() => {
    if (status === 'running') {
      setChartPoints([])
      previousSnapshotRef.current = null
    }
  }, [status])

  // Append a bounded chart point as attempts advance.
  useEffect(() => {
    const last = stats.latency_ms?.last
    const elapsed = stats.elapsed_s
    if (status !== 'running' || stats.attempts <= 0 || last == null || elapsed == null) return

    const current: StatsSnapshot = { attempts: stats.attempts, elapsed_s: elapsed }
    const previous = previousSnapshotRef.current
    const instantRps = previous ? deriveInstantRps(previous, current) : (stats.rps ?? 0)
    previousSnapshotRef.current = current
    if (instantRps == null || !Number.isFinite(last) || last < 0) return

    setChartPoints((history) => appendBounded(history, {
      attempt: stats.attempts,
      elapsed,
      latency: last,
      rps: instantRps,
    }, 180))
  }, [stats.attempts, stats.elapsed_s, stats.latency_ms?.last, stats.rps, status])

  const selected = responses.find((r) => r.attempt === selectedAttempt) ?? null
  const successRate = stats.attempts > 0 ? Math.round((stats.success / stats.attempts) * 100) : 0
  const progress = maxRequests && maxRequests > 0 ? Math.min(100, Math.round((stats.attempts / maxRequests) * 100)) : 0
  const badge = statusBadge[status]
  const lat = stats.latency_ms
  const showSummary = stats.attempts > 0
  const p95 = percentile(chartPoints.map((point) => point.latency), 0.95, 5)
  const currentRps = chartPoints[chartPoints.length - 1]?.rps ?? stats.rps ?? 0
  const latestResponse = responses[responses.length - 1] ?? null
  const slowestResponse = responses.reduce<RunResponse | null>((slowest, response) => {
    if (response.time == null) return slowest
    if (!slowest || slowest.time == null || response.time > slowest.time) return response
    return slowest
  }, null)
  const displayElapsed = status === 'running' ? liveElapsed : (stats.elapsed_s ?? 0)
  const filteredLogs = logs.filter((line) => logFilter === 'all' || classifyLogLine(line) === logFilter)

  const copyBody = async () => {
    const text = selected ? formatBody(selected) : ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  // Close export dropdown when clicking outside
  useEffect(() => {
    if (!showExportMenu) return
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showExportMenu])

  const handleExport = (format: ExportFormat) => {
    setShowExportMenu(false)
    exportRun(format, { responses, logs, stats, runName: runningName })
  }

  const canExport = responses.length > 0 || logs.length > 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-2.5 px-4">
        <div className="flex items-center gap-3">
          <CardTitle className="text-sm">Live Monitor</CardTitle>
          <Badge className={badge.className}>{badge.label}</Badge>
          {runningName && status === 'running' && (
            <span className="text-xs text-muted-foreground truncate max-w-[260px]">
              {runQueue ? `[${runQueue.current}/${runQueue.total}] ` : ''}{runningName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status === 'running' && (
            <Button variant="destructive" size="sm" onClick={onStop}>Stop</Button>
          )}

          {/* Export dropdown */}
          <div ref={exportRef} className="relative">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 px-2.5 text-xs"
              disabled={!canExport || status === 'running'}
              onClick={() => setShowExportMenu((v) => !v)}
            >
              <Download className="h-3 w-3" />
              Export
              <ChevronDown className={`h-3 w-3 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
            </Button>

            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
                {([
                  { format: 'json' as ExportFormat, label: 'Export as JSON', sub: 'Full data + stats' },
                  { format: 'csv'  as ExportFormat, label: 'Export as CSV',  sub: 'Responses table'  },
                  { format: 'logs' as ExportFormat, label: 'Export Logs',    sub: 'Plain text file'  },
                ] as const).map(({ format, label, sub }) => (
                  <button
                    key={format}
                    onClick={() => handleExport(format)}
                    className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors border-b border-border/50 last:border-0"
                  >
                    <div className="text-xs font-medium">{label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {onViewHistory && status !== 'idle' && status !== 'running' && (
            <Button variant="outline" size="sm" onClick={onViewHistory} className="gap-1.5">
              <History className="h-3.5 w-3.5" /> View in History
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClear} disabled={status === 'running'}>Clear</Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-0">
        {/* Progress bar */}
        {(status === 'running' || stats.attempts > 0) && maxRequests ? (
          <div className="mb-3">
            <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
              <span>{runQueue ? `Run All · endpoint ${runQueue.current}/${runQueue.total}` : 'Progress'}</span>
              <span>{stats.attempts} / {maxRequests} <span className="opacity-60">({progress}%)</span></span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : null}

        {/* Primary operational metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 mb-3">
          <Metric label="Attempts" value={`${stats.attempts}`} sub={`${displayElapsed}s elapsed`} />
          <Metric
            label="Success rate"
            value={`${successRate}%`}
            sub={`${stats.success} successful`}
            tone="text-emerald-600 dark:text-emerald-400"
          />
          <Metric label="Current RPS" value={currentRps.toFixed(1)} tone="text-cyan-600 dark:text-cyan-400" />
          <Metric label="Avg latency" value={`${Math.round(lat?.avg ?? 0)}ms`} />
          <Metric
            label="P95 latency"
            value={p95 == null ? '—' : `${Math.round(p95)}ms`}
            sub={p95 == null ? 'needs 5 samples' : 'slow tail'}
            tone={p95 == null ? undefined : 'text-amber-600 dark:text-amber-400'}
          />
          <Metric
            label="Errors"
            value={`${stats.errors}`}
            sub={stats.rate_limited > 0 ? `${stats.rate_limited} rate limited` : 'none rate limited'}
            tone={stats.errors > 0 ? 'text-red-600 dark:text-red-400' : undefined}
          />
        </div>

        {showSummary && (
          <div className={`grid gap-2 mb-3 ${
            chartExpanded ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(220px,1fr)]'
          }`}>
            <OperationsChart
              points={chartPoints}
              p95={p95}
              expanded={chartExpanded}
              onToggleExpanded={() => setChartExpanded((value) => !value)}
            />
            <OutcomePanel
              codes={stats.status_codes || {}}
              latest={latestResponse}
              slowest={slowestResponse}
            />
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
              <div className="flex gap-2 h-[420px] border border-border rounded-lg overflow-hidden bg-muted/20">
                <div ref={responsesListRef} className="w-36 shrink-0 overflow-auto border-r border-border bg-background/50 scroll-smooth">
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

                <div className="flex-1 min-w-0 min-h-0 flex flex-col">
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

                        {/* Auto-follow / auto-scroll control for responses list (like logs) */}
                        <Button
                          variant={followLatest ? 'secondary' : 'ghost'}
                          size="sm"
                          className="h-6 px-2 gap-1 text-[10px]"
                          onClick={() => {
                            const next = !followLatest
                            setFollowLatest(next)
                            if (next && responses.length > 0) {
                              setSelectedAttempt(responses[responses.length - 1].attempt)
                            }
                          }}
                          title={followLatest ? 'Stop auto-scroll / follow latest' : 'Follow latest response (auto-scroll list)'}
                        >
                          {followLatest ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                          <span>{followLatest ? 'Following' : 'Follow'}</span>
                        </Button>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden bg-[#07090d] flex flex-col">
                        {selected.error ? (
                          <div className="p-3 text-[11px] font-mono text-red-400 overflow-auto">{selected.error}</div>
                        ) : (
                          <JsonCodeEditor
                            value={formatBody(selected)}
                            readOnly
                            fileName="response.body.json"
                            showHeader={false}
                            showToolbar={false}
                            showStatus={false}
                            minHeight="0"
                            className="h-full border-0 shadow-none rounded-none"
                          />
                        )}
                      </div>
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
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {([
                ['all', 'All'],
                ['success', 'Success'],
                ['fail', 'Fail'],
                ['rate', 'Rate Limit'],
                ['error', 'Error'],
              ] as const).map(([id, label]) => (
                <Button
                  key={id}
                  variant={logFilter === id ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setLogFilter(id)}
                >
                  {label}
                  {id !== 'all' && (
                    <span className="ml-1 opacity-60">
                      ({logs.filter((l) => classifyLogLine(l) === id).length})
                    </span>
                  )}
                </Button>
              ))}
              {logFilter !== 'all' && (
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {filteredLogs.length} / {logs.length}
                </span>
              )}
            </div>
            <div
              ref={logRef}
              className="log-container h-56 overflow-auto bg-muted/50 border border-border rounded-lg p-3 text-xs font-mono scroll-smooth"
            >
              {logs.length === 0 ? (
                <div className="text-muted-foreground">Run an endpoint to see live output here.</div>
              ) : filteredLogs.length === 0 ? (
                <div className="text-muted-foreground">No logs match this filter.</div>
              ) : (
                filteredLogs.map((line, i) => <div key={i} className={`py-0.5 ${lineColor(line)}`}>{line}</div>)
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

// ---- Helpers ---------------------------------------------------------------

function formatBody(r: RunResponse): string {
  if (!r.body) return '(empty body)'
  try { return JSON.stringify(JSON.parse(r.body), null, 2) } catch { return r.body }
}

function ResponseStatusBadge({ response: r }: { response: RunResponse }) {
  if (r.error)        return <Badge className="h-4 px-1 text-[9px] bg-red-500/15 text-red-600 dark:text-red-400">ERR</Badge>
  if (r.rate_limited) return <Badge className="h-4 px-1 text-[9px] bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">{r.status}</Badge>
  if (r.success)      return <Badge className="h-4 px-1 text-[9px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">{r.status}</Badge>
  if (r.status && r.status >= 500) return <Badge className="h-4 px-1 text-[9px] bg-red-500/15 text-red-600 dark:text-red-400">{r.status}</Badge>
  return <Badge className="h-4 px-1 text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-400">{r.status}</Badge>
}

function Metric({ label, value, tone, sub }: {
  label: string
  value: string
  tone?: string
  sub?: string
}) {
  return (
    <div className="rounded-md border border-border bg-muted/50 px-2.5 py-2 transition-colors min-w-0">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`font-mono font-semibold text-base truncate ${tone || ''}`}>
        {value}
      </div>
      {sub && <div className="text-[9px] text-muted-foreground truncate mt-0.5">{sub}</div>}
    </div>
  )
}

function codeColor(code: string): string {
  if (code === 'error') return 'bg-red-500'
  const n = parseInt(code, 10)
  if (n === 429)           return 'bg-yellow-500'
  if (n >= 200 && n < 300) return 'bg-emerald-500'
  if (n >= 300 && n < 400) return 'bg-blue-500'
  if (n >= 400 && n < 500) return 'bg-amber-500'
  if (n >= 500)            return 'bg-red-500'
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

function OutcomePanel({ codes, latest, slowest }: {
  codes: Record<string, number>
  latest: RunResponse | null
  slowest: RunResponse | null
}) {
  const latestStatus = latest?.error ? 'ERR' : (latest?.status ?? '—')
  const slowestStatus = slowest?.error ? 'ERR' : (slowest?.status ?? '—')
  const latestMs = latest?.time == null ? null : Math.round(latest.time * 1000)
  const slowestMs = slowest?.time == null ? null : Math.round(slowest.time * 1000)

  return (
    <section className="rounded-lg border border-border bg-muted/20 p-3 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-[11px] font-medium">Response outcomes</div>
          <div className="text-[10px] text-muted-foreground">Status distribution</div>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          {Object.values(codes).reduce((sum, count) => sum + count, 0)} total
        </span>
      </div>

      {Object.keys(codes).length > 0 ? (
        <StatusBar codes={codes} />
      ) : (
        <div className="h-12 flex items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground">
          Waiting for responses
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="rounded-md border border-border bg-background/50 p-2 min-w-0">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Latest</div>
          <div className="flex items-baseline gap-1.5 mt-1 font-mono">
            <span className="text-sm font-semibold">{latestStatus}</span>
            <span className="text-[10px] text-muted-foreground">{latestMs == null ? '—' : `${latestMs}ms`}</span>
          </div>
        </div>
        <div className="rounded-md border border-border bg-background/50 p-2 min-w-0">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Slowest</div>
          <div className="flex items-baseline gap-1.5 mt-1 font-mono">
            <span className="text-sm font-semibold">{slowestStatus}</span>
            <span className="text-[10px] text-muted-foreground">{slowestMs == null ? '—' : `${slowestMs}ms`}</span>
          </div>
          {slowest && <div className="text-[9px] text-muted-foreground mt-0.5">attempt #{slowest.attempt}</div>}
        </div>
      </div>
    </section>
  )
}

function classifyLogLine(line: string): LogFilter {
  const l = line.toLowerCase()
  if (/\berror\b/.test(l) && !l.includes('->')) return 'error'
  if (l.includes('rate') || l.includes('429') || l.includes('too many')) return 'rate'
  if (l.includes('success') || /\b->\s*2\d{2}\b/.test(l)) return 'success'
  if (l.includes('fail') || /\b->\s*(4|5)\d{2}\b/.test(l)) return 'fail'
  return 'all'
}

function lineColor(line: string): string {
  const kind = classifyLogLine(line)
  if (kind === 'error' || kind === 'fail') return 'text-red-600 dark:text-red-400'
  if (kind === 'rate') return 'text-yellow-600 dark:text-yellow-400'
  if (kind === 'success') return 'text-green-600 dark:text-green-400'
  return ''
}
