import { useEffect, useRef, useState, useCallback } from 'react'
import { RunConfig, RunResponse } from '../types'
import { RunStats, RunStatus } from '../components/LiveMonitor'
import { api } from '../lib/api'
import { toast } from '../components/ui/toast'

const EMPTY_STATS: RunStats = { attempts: 0, success: 0, rate_limited: 0, errors: 0 }

/**
 * Drives a single endpoint run: starts it on the backend, then streams logs +
 * stats + responses over WebSocket, falling back to /status polling if the socket fails.
 */
export function useRun() {
  const [logs, setLogs] = useState<string[]>([])
  const [responses, setResponses] = useState<RunResponse[]>([])
  const [stats, setStats] = useState<RunStats>(EMPTY_STATS)
  const [status, setStatus] = useState<RunStatus>('idle')
  const [runningTestId, setRunningTestId] = useState<string | null>(null)
  const [maxRequests, setMaxRequests] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const runIdRef = useRef<string | null>(null)
  const statusRef = useRef<RunStatus>('idle')
  useEffect(() => { statusRef.current = status }, [status])

  const cleanupSockets = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close() } catch {} wsRef.current = null }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  useEffect(() => cleanupSockets, [cleanupSockets])

  const finish = useCallback(() => {
    setStatus(s => (s === 'stopped' ? 'stopped' : 'finished'))
    cleanupSockets()
  }, [cleanupSockets])

  const startPolling = useCallback((rid: string) => {
    if (pollRef.current) return
    if (wsRef.current) { try { wsRef.current.close() } catch {} wsRef.current = null }
    pollRef.current = setInterval(async () => {
      try {
        const st: any = await api.getStatus(rid)
        if (st.stats) setStats(st.stats)
        if (st.logs) setLogs(st.logs.filter((l: string) => !l.includes('run_finished')))
        if (st.responses) setResponses(st.responses)
        if (st.status && st.status !== 'running') finish()
      } catch {}
    }, 1000)
  }, [finish])

  const connect = useCallback((rid: string) => {
    let opened = false
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws`)
      wsRef.current = ws
      ws.onopen = () => { opened = true }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.run_id && msg.run_id !== runIdRef.current) return
          if (msg.type === 'log') {
            if (typeof msg.message === 'string' && msg.message.includes('run_finished')) finish()
            else setLogs(prev => [...prev, msg.message])
          } else if (msg.type === 'stats') {
            setStats(msg.stats)
          } else if (msg.type === 'response' && msg.response) {
            setResponses(prev => [...prev, msg.response])
          }
        } catch {}
      }
      ws.onerror = () => { if (!opened) startPolling(rid) }
      ws.onclose = () => { if (!opened && statusRef.current === 'running') startPolling(rid) }
      setTimeout(() => { if (!opened && statusRef.current === 'running') startPolling(rid) }, 1500)
    } catch {
      startPolling(rid)
    }
  }, [finish, startPolling])

  const start = useCallback(async (testId: string, name: string, cfg: RunConfig) => {
    cleanupSockets()
    setRunningTestId(testId)
    setMaxRequests(cfg.max_requests)
    setStats(EMPTY_STATS)
    setResponses([])
    setStatus('running')
    setLogs([`Starting "${name}" — ${cfg.concurrency} workers × ${cfg.max_requests} requests${cfg.use_min_delay ? ' (min delay)' : ` · ${Math.round(cfg.delay * 1000)}ms delay`}`])

    let rid: string
    try {
      const data = await api.startRun(testId, cfg)
      rid = data.run_id
    } catch (e: any) {
      setStatus('idle')
      toast.error(e?.message || 'Failed to start run')
      return
    }
    runIdRef.current = rid
    toast.success('Run started')
    connect(rid)
  }, [cleanupSockets, connect])

  const stop = useCallback(async () => {
    if (!runIdRef.current) return
    try { await api.stopRun(runIdRef.current) } catch {}
    setStatus('stopped')
    toast.info('Stopping run…')
  }, [])

  const clear = useCallback(() => {
    cleanupSockets()
    setLogs([])
    setResponses([])
    setStats(EMPTY_STATS)
    setStatus('idle')
    setRunningTestId(null)
  }, [cleanupSockets])

  return { logs, responses, stats, status, runningTestId, maxRequests, start, stop, clear }
}