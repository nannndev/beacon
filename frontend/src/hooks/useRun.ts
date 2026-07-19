import { useEffect, useRef, useState, useCallback } from 'react'
import { RunConfig, RunResponse } from '../types'
import { RunStats, RunStatus } from '../components/LiveMonitor'
import { api, getWsUrl } from '../lib/api'
import { toast } from '../components/ui/toast'
import { buildLoadRunPayload } from './runPayload'

const EMPTY_STATS: RunStats = { attempts: 0, success: 0, rate_limited: 0, errors: 0 }

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

  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const runIdRef = useRef<string | null>(null)
  const statusRef = useRef<RunStatus>('idle')
  const statsRef = useRef<RunStats>(EMPTY_STATS)
  const runAllModeRef = useRef(false)
  const stoppedRef = useRef(false)
  const queueRef = useRef<RunQueueItem[]>([])
  const runQueueRef = useRef<RunQueueProgress | null>(null)

  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { statsRef.current = stats }, [stats])
  useEffect(() => { runQueueRef.current = runQueue }, [runQueue])

  const baseStatsRef = useRef<RunStats>(EMPTY_STATS)

  const cleanupSockets = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close() } catch {} wsRef.current = null }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  useEffect(() => cleanupSockets, [cleanupSockets])

  const applyStats = useCallback((incoming: RunStats) => {
    if (runAllModeRef.current) {
      setStats(mergeStats(baseStatsRef.current, incoming))
    } else {
      setStats(incoming)
    }
  }, [])

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
      setStats(EMPTY_STATS)
      setResponses([])
      setLogs([line])
    } else {
      setLogs((prev) => [...prev, '', `─── ${line}`])
    }

    const data = await api.startRun(payload)
    runIdRef.current = data.run_id
    connectRef.current(data.run_id)
  }, [cleanupSockets])

  const advanceQueue = useCallback(() => {
    if (queueRef.current.length === 0) return
    const next = queueRef.current.shift()!
    const progress = runQueueRef.current
    const pos = (progress?.current ?? 0) + 1
    const total = progress?.total ?? pos
    setRunQueue({ current: pos, total })
    const payload = next.payload ?? buildLoadRunPayload(next.testId, next.cfg)
    startInternal(next.testId, next.name, payload, { fresh: false, queuePos: pos, queueTotal: total })
      .catch((e: any) => {
        runAllModeRef.current = false
        queueRef.current = []
        setRunQueue(null)
        setStatus('idle')
        toast.error(e?.message || 'Failed to start next endpoint')
      })
  }, [startInternal])

  const finish = useCallback(() => {
    if (runAllModeRef.current && !stoppedRef.current) {
      baseStatsRef.current = mergeStats(baseStatsRef.current, statsRef.current)
      if (queueRef.current.length > 0) {
        advanceQueue()
        return
      }
      runAllModeRef.current = false
      setRunQueue(null)
      setLogs((prev) => [...prev, '', '─── Run All finished ───'])
    }
    setStatus((s) => (s === 'stopped' ? 'stopped' : 'finished'))
    cleanupSockets()
  }, [advanceQueue, cleanupSockets])

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
          setResponses((prev) => runAllModeRef.current ? [...prev, ...st.responses] : st.responses)
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
              else setLogs((prev) => [...prev, msg.message])
            } else if (msg.type === 'stats') {
              applyStats(msg.stats)
            } else if (msg.type === 'response' && msg.response) {
              setResponses((prev) => [...prev, msg.response])
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
  }, [applyStats, startPolling])

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

  const startAll = useCallback(async (items: RunQueueItem[]) => {
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

    runAllModeRef.current = true
    queueRef.current = items.slice(1)
    setRunQueue({ current: 1, total: items.length })
    try {
      const first = items[0]
      const payload = first.payload ?? buildLoadRunPayload(first.testId, first.cfg)
      await startInternal(first.testId, first.name, payload, {
        fresh: true,
        queuePos: 1,
        queueTotal: items.length,
      })
      toast.success(`Run All started (${items.length} endpoints)`)
    } catch (e: any) {
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
    setStatus('stopped')
    toast.info('Stopping run…')
  }, [])

  const clear = useCallback(() => {
    stoppedRef.current = false
    runAllModeRef.current = false
    queueRef.current = []
    setRunQueue(null)
    cleanupSockets()
    setLogs([])
    setResponses([])
    setStats(EMPTY_STATS)
    baseStatsRef.current = EMPTY_STATS
    setStatus('idle')
    setRunningTestId(null)
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
    start,
    startAll,
    stop,
    clear,
  }
}
