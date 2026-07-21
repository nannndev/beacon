import { useEffect, useRef, useState, useCallback } from 'react'
import { RunConfig, RunResponse } from '../types'
import { RunStats, RunStatus } from '../components/LiveMonitor'
import { api, getWsUrl } from '../lib/api'
import { toast } from '../components/ui/toast'
import { buildLoadRunPayload } from './runPayload'
import { withHistoryStep } from './useAppView'
import { notifyRunFinished } from '../lib/notify'

const EMPTY_STATS: RunStats = { attempts: 0, success: 0, rate_limited: 0, errors: 0 }

// Live-view caps + flush cadence. At high RPS the backend emits a log + a
// response event per request; appending each to state one-by-one caused a
// re-render storm and unbounded DOM growth (the freeze/jank users saw). We
// instead buffer incoming events and flush them in one batched update a few
// times per second, and keep only the most recent N in the live view. Full
// data is always preserved in Run History / export — these caps are display-only.
const LIVE_LOG_CAP = 1000
const LIVE_RESPONSE_CAP = 500
const FLUSH_INTERVAL_MS = 120

function capTail<T>(arr: T[], cap: number): T[] {
  return arr.length > cap ? arr.slice(arr.length - cap) : arr
}

export interface RunQueueItem {
  testId: string
  name: string
  cfg: RunConfig
  /** Optional full payload override (for mode-based runs). When set, cfg is ignored. */
  payload?: Record<string, unknown>
}

export interface RunQueueProgress {
  current: number
  total: number
}

export interface RunGroupContext {
  sourceType: 'run_all' | 'folder'
  targetId?: string
  targetName: string
}

function mergeStats(base: RunStats, current: RunStats): RunStats {
  const codes = { ...base.status_codes }
  for (const [k, v] of Object.entries(current.status_codes || {})) {
    codes[k] = (codes[k] || 0) + v
  }
  const recent = [...(base.recent_ms || []), ...(current.recent_ms || [])].slice(-60)
  const elapsed = (base.elapsed_s || 0) + (current.elapsed_s || 0)
  const attempts = base.attempts + current.attempts
  return {
    attempts,
    success: base.success + current.success,
    rate_limited: base.rate_limited + current.rate_limited,
    errors: base.errors + current.errors,
    status_codes: codes,
    recent_ms: recent,
    latency_ms: current.latency_ms ?? base.latency_ms,
    elapsed_s: elapsed,
    rps: elapsed > 0 ? Math.round((attempts / elapsed) * 10) / 10 : 0,
  }
}

function formatStartLine(name: string, payload: Record<string, unknown>, queuePos?: number, queueTotal?: number): string {
  const prefix = queuePos && queueTotal ? `[${queuePos}/${queueTotal}] ` : ''
  const mode = (payload.mode as string) ?? 'load'
  const cfg = payload as any
  const detail = mode === 'load'
    ? `${cfg.concurrency ?? 1} workers × ${cfg.max_requests ?? '?'} req · ${cfg.no_delay ? 'no delay' : `${Math.round((cfg.delay_ms ?? 0))}ms`}`
    : mode
  return `${prefix}Starting "${name}" [${mode}] — ${detail}`
}

/**
 * Drives endpoint runs: single or queued "run all", streaming logs/stats/responses
 * over WebSocket with /status polling fallback.
 */
export function useRun() {
  const [logs, setLogs] = useState<string[]>([])
  const [responses, setResponses] = useState<RunResponse[]>([])
  const [stats, setStats] = useState<RunStats>(EMPTY_STATS)
  const [status, setStatus] = useState<RunStatus>('idle')
  const [runningTestId, setRunningTestId] = useState<string | null>(null)
  const [maxRequests, setMaxRequests] = useState(0)
  const [totalMaxRequests, setTotalMaxRequests] = useState(0)
  const [runQueue, setRunQueue] = useState<RunQueueProgress | null>(null)
  const [lastHistoryId, setLastHistoryId] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const runIdRef = useRef<string | null>(null)
  const statusRef = useRef<RunStatus>('idle')
  const statsRef = useRef<RunStats>(EMPTY_STATS)
  const runAllModeRef = useRef(false)
  const stoppedRef = useRef(false)
  const queueRef = useRef<RunQueueItem[]>([])
  const runQueueRef = useRef<RunQueueProgress | null>(null)
  const historyGroupRef = useRef<string | null>(null)

  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { statsRef.current = stats }, [stats])
  useEffect(() => { runQueueRef.current = runQueue }, [runQueue])

  const baseStatsRef = useRef<RunStats>(EMPTY_STATS)

  // Coalesce high-frequency stream events into batched, capped state updates.
  const logBufRef = useRef<string[]>([])
  const respBufRef = useRef<RunResponse[]>([])
  const pendingStatsRef = useRef<RunStats | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyStatsRef = useRef<(s: RunStats) => void>(() => {})

  const flushBuffers = useCallback(() => {
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null }
    if (pendingStatsRef.current) {
      applyStatsRef.current(pendingStatsRef.current)
      pendingStatsRef.current = null
    }
    if (logBufRef.current.length) {
      const batch = logBufRef.current
      logBufRef.current = []
      setLogs((prev) => capTail(prev.concat(batch), LIVE_LOG_CAP))
    }
    if (respBufRef.current.length) {
      const batch = respBufRef.current
      respBufRef.current = []
      setResponses((prev) => capTail(prev.concat(batch), LIVE_RESPONSE_CAP))
    }
  }, [])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return
    flushTimerRef.current = setTimeout(() => { flushTimerRef.current = null; flushBuffers() }, FLUSH_INTERVAL_MS)
  }, [flushBuffers])

  const cleanupSockets = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close() } catch {} wsRef.current = null }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null }
  }, [])

  useEffect(() => cleanupSockets, [cleanupSockets])

  const applyStats = useCallback((incoming: RunStats) => {
    if (runAllModeRef.current) {
      setStats(mergeStats(baseStatsRef.current, incoming))
    } else {
      setStats(incoming)
    }
  }, [])
  useEffect(() => { applyStatsRef.current = applyStats }, [applyStats])

  const startInternal = useCallback(async (
    testId: string,
    name: string,
    payload: Record<string, unknown>,
    opts: { fresh: boolean; queuePos?: number; queueTotal?: number },
  ) => {
    cleanupSockets()
    setRunningTestId(testId)
    setMaxRequests((payload.max_requests as number) ?? (payload.benchmark_requests as number) ?? (payload.probe_step_requests as number) ?? 0)
    setStatus('running')

    const line = formatStartLine(name, payload, opts.queuePos, opts.queueTotal)
    if (opts.fresh) {
      baseStatsRef.current = EMPTY_STATS
      logBufRef.current = []
      respBufRef.current = []
      pendingStatsRef.current = null
      setStats(EMPTY_STATS)
      setResponses([])
      setLogs([line])
    } else {
      setLogs((prev) => [...prev, '', `─── ${line}`])
    }

    const data = await api.startRun(payload)
    runIdRef.current = data.run_id
    setLastHistoryId(data.history_id || null)
    connectRef.current(data.run_id)
  }, [cleanupSockets])

  const advanceQueue = useCallback(() => {
    if (queueRef.current.length === 0) return
    const next = queueRef.current.shift()!
    const progress = runQueueRef.current
    const pos = (progress?.current ?? 0) + 1
    const total = progress?.total ?? pos
    setRunQueue({ current: pos, total })
    const rawPayload = next.payload ?? buildLoadRunPayload(next.testId, next.cfg)
    const payload = historyGroupRef.current
      ? withHistoryStep(rawPayload, historyGroupRef.current, pos - 1)
      : rawPayload
    startInternal(next.testId, next.name, payload, { fresh: false, queuePos: pos, queueTotal: total })
      .catch((e: any) => {
        if (historyGroupRef.current) {
          void api.finishHistoryGroup(historyGroupRef.current, 'failed').catch(() => {})
          historyGroupRef.current = null
        }
        runAllModeRef.current = false
        queueRef.current = []
        setRunQueue(null)
        setStatus('idle')
        toast.error(e?.message || 'Failed to start next endpoint')
      })
  }, [startInternal])

  const finish = useCallback(() => {
    flushBuffers() // drain any buffered logs/responses so the final ones show
    let finalStats = statsRef.current
    if (runAllModeRef.current && !stoppedRef.current) {
      baseStatsRef.current = mergeStats(baseStatsRef.current, statsRef.current)
      if (queueRef.current.length > 0) {
        advanceQueue()
        return
      }
      runAllModeRef.current = false
      historyGroupRef.current = null
      setRunQueue(null)
      setLogs((prev) => [...prev, '', '─── Run All finished ───'])
      finalStats = baseStatsRef.current
    }
    setStatus((s) => (s === 'stopped' ? 'stopped' : 'finished'))
    cleanupSockets()
    // Native "run finished" notification (desktop-only, best-effort) so long
    // soak/benchmark runs surface their result when Beacon is backgrounded.
    // Skipped for user-stopped runs (they already know) and empty runs.
    if (!stoppedRef.current && finalStats.attempts > 0) {
      void notifyRunFinished(finalStats)
    }
  }, [advanceQueue, cleanupSockets, flushBuffers])

  const finishRef = useRef(finish)
  useEffect(() => { finishRef.current = finish }, [finish])

  const startPolling = useCallback((rid: string) => {
    if (pollRef.current) return
    if (wsRef.current) { try { wsRef.current.close() } catch {} wsRef.current = null }
    pollRef.current = setInterval(async () => {
      try {
        const st: any = await api.getStatus(rid)
        if (st.stats) applyStats(st.stats)
        if (st.logs) {
          setLogs((prev) => {
            const incoming = st.logs.filter((l: string) => !l.includes('run_finished'))
            if (runAllModeRef.current) return [...prev, ...incoming.slice(Math.max(0, incoming.length - 5))]
            return incoming
          })
        }
        if (st.responses) {
          setResponses((prev) => capTail(runAllModeRef.current ? [...prev, ...st.responses] : st.responses, LIVE_RESPONSE_CAP))
        }
        if (st.status && st.status !== 'running') finishRef.current()
      } catch {}
    }, 1000)
  }, [applyStats])

  const connect = useCallback((rid: string) => {
    let opened = false
    // Resolve the WS URL from the same base as REST (dynamic port in desktop);
    // fire-and-forget so callers stay synchronous. Falls back to /status polling.
    ;(async () => {
      try {
        const ws = new WebSocket(await getWsUrl())
        wsRef.current = ws
        ws.onopen = () => { opened = true }
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data)
            if (msg.run_id && msg.run_id !== runIdRef.current) return
            if (msg.type === 'log') {
              if (typeof msg.message === 'string' && msg.message.includes('run_finished')) finishRef.current()
              else { logBufRef.current.push(msg.message); scheduleFlush() }
            } else if (msg.type === 'stats') {
              // Keep only the latest snapshot; flush coalesces it into one render.
              pendingStatsRef.current = msg.stats
              scheduleFlush()
            } else if (msg.type === 'response' && msg.response) {
              respBufRef.current.push(msg.response)
              scheduleFlush()
            }
          } catch {}
        }
        ws.onerror = () => { if (!opened) startPolling(rid) }
        ws.onclose = () => { if (!opened && statusRef.current === 'running') startPolling(rid) }
        setTimeout(() => { if (!opened && statusRef.current === 'running') startPolling(rid) }, 1500)
      } catch {
        startPolling(rid)
      }
    })()
  }, [scheduleFlush, startPolling])

  const connectRef = useRef(connect)
  useEffect(() => { connectRef.current = connect }, [connect])

  /**
   * Start a single run with a full payload (supports all 8 modes).
   * If `payload` is omitted, falls back to legacy cfg (load mode).
   */
  const start = useCallback(async (
    testId: string,
    name: string,
    cfg: RunConfig,
    payload?: Record<string, unknown>,
  ) => {
    stoppedRef.current = false
    runAllModeRef.current = false
    historyGroupRef.current = null
    queueRef.current = []
    setRunQueue(null)
    const finalPayload = payload ?? buildLoadRunPayload(testId, cfg)
    setTotalMaxRequests((finalPayload.max_requests as number) ?? cfg.max_requests)
    try {
      await startInternal(testId, name, finalPayload, { fresh: true })
      toast.success('Run started')
    } catch (e: any) {
      setStatus('idle')
      toast.error(e?.message || 'Failed to start run')
    }
  }, [startInternal])

  const startAll = useCallback(async (items: RunQueueItem[], context?: RunGroupContext) => {
    if (items.length === 0) return
    stoppedRef.current = false
    setTotalMaxRequests(items.reduce((sum, item) => sum + item.cfg.max_requests, 0))

    if (items.length === 1) {
      runAllModeRef.current = false
      queueRef.current = []
      setRunQueue(null)
      try {
        const first = items[0]
        const payload = first.payload ?? buildLoadRunPayload(first.testId, first.cfg)
        await startInternal(first.testId, first.name, payload, { fresh: true })
        toast.success('Run started')
      } catch (e: any) {
        setStatus('idle')
        toast.error(e?.message || 'Failed to start run')
      }
      return
    }

    historyGroupRef.current = null
    try {
      const firstPayload = items[0].payload ?? buildLoadRunPayload(items[0].testId, items[0].cfg)
      const group = await api.createHistoryGroup({
        source_type: context?.sourceType || 'run_all',
        target_id: context?.targetId,
        target_name: context?.targetName || 'Run all endpoints',
        mode: firstPayload.mode || 'load',
        endpoint_ids: items.map((item) => item.testId),
      })
      historyGroupRef.current = group.history_id
      setLastHistoryId(group.history_id)
    } catch {
      // History is auxiliary: a database/API failure must not block the run.
    }

    runAllModeRef.current = true
    queueRef.current = items.slice(1)
    setRunQueue({ current: 1, total: items.length })
    try {
      const first = items[0]
      const rawPayload = first.payload ?? buildLoadRunPayload(first.testId, first.cfg)
      const payload = historyGroupRef.current
        ? withHistoryStep(rawPayload, historyGroupRef.current, 0)
        : rawPayload
      await startInternal(first.testId, first.name, payload, {
        fresh: true,
        queuePos: 1,
        queueTotal: items.length,
      })
      toast.success(`Run All started (${items.length} endpoints)`)
    } catch (e: any) {
      if (historyGroupRef.current) {
        void api.finishHistoryGroup(historyGroupRef.current, 'failed').catch(() => {})
        historyGroupRef.current = null
      }
      runAllModeRef.current = false
      queueRef.current = []
      setRunQueue(null)
      setStatus('idle')
      toast.error(e?.message || 'Failed to start run')
    }
  }, [startInternal])

  const stop = useCallback(async () => {
    stoppedRef.current = true
    queueRef.current = []
    runAllModeRef.current = false
    setRunQueue(null)
    if (!runIdRef.current) return
    try { await api.stopRun(runIdRef.current) } catch {}
    if (historyGroupRef.current) {
      void api.finishHistoryGroup(historyGroupRef.current, 'stopped').catch(() => {})
      historyGroupRef.current = null
    }
    setStatus('stopped')
    toast.info('Stopping run…')
  }, [])

  const clear = useCallback(() => {
    stoppedRef.current = false
    runAllModeRef.current = false
    queueRef.current = []
    setRunQueue(null)
    cleanupSockets()
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null }
    logBufRef.current = []
    respBufRef.current = []
    pendingStatsRef.current = null
    setLogs([])
    setResponses([])
    setStats(EMPTY_STATS)
    baseStatsRef.current = EMPTY_STATS
    setStatus('idle')
    setRunningTestId(null)
    setLastHistoryId(null)
    setTotalMaxRequests(0)
  }, [cleanupSockets])

  return {
    logs,
    responses,
    stats,
    status,
    runningTestId,
    maxRequests,
    totalMaxRequests,
    runQueue,
    lastHistoryId,
    start,
    startAll,
    stop,
    clear,
  }
}
