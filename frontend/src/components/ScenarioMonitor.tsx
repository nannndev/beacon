import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Activity, AlertTriangle, CheckCircle2, CircleDashed, Clock3, Copy,
  ChevronDown, Gauge, Pause, Radio, RotateCcw, Timer, Users, X, XCircle,
} from 'lucide-react'
import type {
  ScenarioFailure, ScenarioLiveStep, ScenarioResult, ScenarioRunStatus,
} from '../lib/api'
import type { ScenarioParams } from '../types/testModes'

interface ScenarioPlan {
  params: ScenarioParams
  startedAt: number
}

interface Props {
  busy: boolean
  plan: ScenarioPlan | null
  result: ScenarioResult | null
  live: ScenarioRunStatus | null
  endpoints: Array<{ id: string; name: string; method?: string; targetType?: 'api' | 'web' }>
  onClear: () => void
}

export function ScenarioMonitor({ busy, plan, result, live, endpoints, onClear }: Props) {
  const [now, setNow] = useState(Date.now())
  const [followLive, setFollowLive] = useState(true)
  const activityRef = useRef<HTMLDivElement>(null)
  const eventCount = live?.recent_events?.length ?? 0

  useEffect(() => {
    if (!busy) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [busy])

  useEffect(() => {
    if (!followLive || !activityRef.current) return
    activityRef.current.scrollTop = activityRef.current.scrollHeight
  }, [eventCount, followLive])

  if (!plan && !result) return null

  const scope = live?.progress?.scope ?? (endpoints.length === 1 ? 'endpoint' : 'journey')
  const isEndpoint = scope === 'endpoint'
  const isWebEndpoint = isEndpoint && endpoints[0]?.targetType === 'web'
  const virtualUsers = result?.virtual_users ?? plan?.params.virtual_users ?? 1
  const iterations = result?.iterations ?? plan?.params.iterations ?? 1
  const plannedFlows = live?.progress?.total_flows ?? virtualUsers * iterations
  const completedFlows = live?.progress?.completed_flows ?? result?.completed_flows ?? (result ? 1 : 0)
  const successfulFlows = live?.progress?.successful_flows ?? result?.successful_flows ?? (result?.passed ? completedFlows : 0)
  const failedFlows = live?.progress?.failed_flows ?? result?.failed_flows ?? Math.max(0, completedFlows - successfulFlows)
  const requestsCompleted = live?.progress?.requests_completed ?? (isEndpoint ? completedFlows : 0)
  const successfulRequests = live?.progress?.successful_requests ?? (isEndpoint ? successfulFlows : 0)
  const failedRequests = live?.progress?.failed_requests ?? (isEndpoint ? failedFlows : 0)
  const activeUsers = live?.progress?.active_users ?? (busy ? virtualUsers : 0)
  const elapsedMs = result?.duration_ms ?? Math.max(0, now - (plan?.startedAt ?? now))
  const progressValue = plannedFlows > 0 ? Math.min(100, completedFlows / plannedFlows * 100) : 0
  const successRate = requestsCompleted > 0
    ? successfulRequests / requestsCompleted * 100
    : result?.success_rate ?? 0
  const runStatus = live?.status === 'stopping'
    ? 'stopping'
    : busy
      ? 'running'
      : result?.stopped
        ? 'stopped'
        : result?.stopped_early
          ? 'stopped_early'
          : result?.passed
            ? 'passed'
            : 'failed'

  const steps = buildSteps(endpoints, live, result, busy)
  const primaryFailure = findPrimaryFailure(live, result, steps)
  const events = (live?.recent_events ?? []).slice(-100)
  const step = steps[0]
  const requestsPerSecond = elapsedMs > 0 ? requestsCompleted / (elapsedMs / 1000) : 0
  const iterationProgress = virtualUsers * iterations > 0
    ? Math.min(100, completedFlows / (virtualUsers * iterations) * 100)
    : 0

  const statusStyle = runStatus === 'running' || runStatus === 'stopping'
    ? 'border-blue-400/30 bg-blue-500/[0.035]'
    : runStatus === 'passed'
      ? 'border-emerald-500/25 bg-emerald-500/[0.025]'
      : runStatus === 'stopped'
        ? 'border-amber-500/25 bg-amber-500/[0.025]'
        : 'border-red-500/25 bg-red-500/[0.025]'

  return (
    <section className={`overflow-hidden rounded-xl border ${statusStyle}`} aria-live="polite">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3">
        <StatusIcon status={runStatus} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{isWebEndpoint ? 'Web request run' : isEndpoint ? 'Endpoint run' : 'Scenario journey'}</h2>
            <StatusBadge status={runStatus} />
            <span className="rounded border border-border/70 bg-background/60 px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
              {isEndpoint ? `${plannedFlows.toLocaleString()} requests` : `${plannedFlows.toLocaleString()} journeys · ${endpoints.length} steps`}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {runStatus === 'stopping'
              ? 'Finishing active requests before the run stops.'
              : busy
                ? isEndpoint
                  ? isWebEndpoint
                    ? `${activeUsers} virtual users are loading the HTML document. Browser rendering is not included.`
                    : `${activeUsers} virtual users are exercising ${endpoints[0]?.name || 'the selected endpoint'}.`
                  : `${activeUsers} virtual users are moving through the endpoint sequence.`
                : isEndpoint
                  ? `${requestsCompleted} of ${plannedFlows} requests completed.`
                  : `${completedFlows} of ${plannedFlows} journeys completed.`}
          </p>
        </div>
        {!busy && (
          <button type="button" onClick={onClear} className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close run details">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="h-1 bg-border/50">
        <div
          className={`h-full transition-[width] duration-300 ${runStatus === 'passed' ? 'bg-emerald-500' : runStatus === 'failed' ? 'bg-red-500' : 'bg-blue-500'}`}
          style={{ width: `${progressValue}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-border/70 bg-border/60 md:grid-cols-4">
        <Metric
          icon={isEndpoint ? <Activity className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
          label={isEndpoint ? 'Requests' : 'Journeys'}
          value={`${isEndpoint ? requestsCompleted : completedFlows}/${plannedFlows}`}
          detail={isEndpoint ? `${failedRequests} failed` : `${failedFlows} failed`}
        />
        <Metric icon={<Users className="h-3.5 w-3.5" />} label="Active users" value={String(activeUsers)} detail={`${virtualUsers} configured`} />
        <Metric icon={<Gauge className="h-3.5 w-3.5" />} label="Success rate" value={`${successRate.toFixed(1)}%`} detail={isEndpoint ? `${successfulRequests} successful` : `${successfulFlows} successful`} />
        <Metric icon={<Timer className="h-3.5 w-3.5" />} label="Elapsed" value={formatDuration(elapsedMs)} detail={busy ? 'live timer' : 'wall-clock time'} />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 border-b border-border/70 p-4 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="font-medium uppercase tracking-wider">{isEndpoint ? 'Endpoint activity' : 'Journey path'}</span>
            {live?.progress && <span>{Math.round(progressValue)}% complete</span>}
          </div>
          {isEndpoint ? (
            <>
              <EndpointActivity step={step} endpoint={endpoints[0]} />
              <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/60 sm:grid-cols-4">
                <Signal label="Throughput" value={`${requestsPerSecond.toFixed(1)}/s`} detail="completed requests" />
                <Signal label="Average" value={step?.avg_ms != null ? `${step.avg_ms}ms` : 'Waiting'} detail="response time" />
                <Signal label="P95 latency" value={step?.p95_ms != null ? `${step.p95_ms}ms` : 'Waiting'} detail="slow-end tail" />
                <Signal label="Work complete" value={`${iterationProgress.toFixed(0)}%`} detail={`${completedFlows}/${plannedFlows} executions`} />
              </div>
            </>
          ) : (
            <JourneyPath steps={steps} endpoints={endpoints} />
          )}

          {primaryFailure && (
            <FailureInspector
              failure={primaryFailure.failure}
              step={primaryFailure.step}
              failedCount={primaryFailure.step?.failed ?? failedRequests}
            />
          )}
        </div>

        <div className="min-w-0 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Recent activity</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] text-muted-foreground">{live?.progress?.rate_limited ?? 0} rate limited</span>
              {busy && (
                <button
                  type="button"
                  onClick={() => setFollowLive((current) => !current)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[9px] font-medium transition-colors ${followLive ? 'border-blue-400/25 bg-blue-500/10 text-blue-300' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`}
                  aria-pressed={followLive}
                >
                  {followLive ? <Radio className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                  {followLive ? 'Following' : 'Paused'}
                </button>
              )}
            </div>
          </div>
          {events.length > 0 ? (
            <div className="relative">
              <div
                ref={activityRef}
                onScroll={(event) => {
                  const node = event.currentTarget
                  const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
                  if (!nearBottom && followLive) setFollowLive(false)
                }}
                className="max-h-[390px] space-y-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]"
              >
              {events.map((event, index) => (
                <div key={`${event.at_ms}-${event.user}-${index}`} className="rounded-lg border border-border/70 bg-background/65 px-3 py-2">
                  <div className="flex items-center gap-2 text-[10px]">
                    {event.state === 'passed' ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                    <span className="truncate font-medium">{event.name || event.test_id}</span>
                    <span className="ml-auto font-mono text-muted-foreground">{event.status ?? event.failure?.kind ?? 'error'}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 font-mono text-[9px] text-muted-foreground">
                    <span>User {event.user}</span>
                    <span>Iteration {event.iteration}</span>
                    {event.time_ms != null && <span>{Math.round(event.time_ms)}ms</span>}
                    {(event.attempts ?? 1) > 1 && <span>{event.attempts} attempts</span>}
                  </div>
                  {event.failure && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-red-400">{event.failure.message}</p>}
                </div>
              ))}
              </div>
              {!followLive && busy && (
                <button
                  type="button"
                  onClick={() => {
                    setFollowLive(true)
                    requestAnimationFrame(() => {
                      if (activityRef.current) activityRef.current.scrollTop = activityRef.current.scrollHeight
                    })
                  }}
                  className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 text-[10px] font-medium shadow-lg hover:bg-muted"
                >
                  <ChevronDown className="h-3 w-3" /> Jump to latest
                </button>
              )}
            </div>
          ) : (
            <div className="grid min-h-32 place-items-center rounded-lg border border-dashed border-border/70 bg-background/35 px-6 text-center text-[11px] leading-5 text-muted-foreground">
              {busy ? 'Waiting for the first request to complete…' : 'No live events were recorded for this run.'}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function buildSteps(
  endpoints: Props['endpoints'],
  live: ScenarioRunStatus | null,
  result: ScenarioResult | null,
  busy: boolean,
): ScenarioLiveStep[] {
  if (live?.scenario_steps?.length) return live.scenario_steps
  return endpoints.map((endpoint, index) => {
    const step = result?.steps[index]
    const succeeded = step ? (step.success ?? (step.ok && step.passed !== false)) : false
    return {
      test_id: endpoint.id,
      name: endpoint.name,
      method: endpoint.method,
      state: busy ? 'running' : step ? (succeeded ? 'passed' : 'failed') : 'skipped',
      attempts: step?.attempts ?? (step ? 1 : 0),
      successful: step?.successful ?? (succeeded ? 1 : 0),
      failed: step?.failed ?? (step && !succeeded ? 1 : 0),
      success_rate: step?.success_rate ?? (succeeded ? 100 : 0),
      avg_ms: step?.avg_ms ?? step?.time_ms,
      p95_ms: step?.p95_ms ?? step?.time_ms,
      last_status: step?.status,
      failure: step?.failure,
    }
  })
}

function EndpointActivity({ step, endpoint }: { step?: ScenarioLiveStep; endpoint?: Props['endpoints'][number] }) {
  const state = step?.state ?? 'waiting'
  return (
    <div className={`rounded-xl border p-4 ${stepTone(state)}`}>
      <div className="flex flex-wrap items-start gap-3">
        <StepStateIcon state={state} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-muted px-2 py-0.5 font-mono text-[9px] text-muted-foreground">{endpoint?.method || step?.method || 'REQ'}</span>
            <h3 className="truncate text-sm font-semibold">{endpoint?.name || step?.name || 'Selected endpoint'}</h3>
          </div>
          <p className="mt-1 text-[10px] capitalize text-muted-foreground">{state.replace('_', ' ')}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniMetric label="Attempts" value={step?.attempts ?? 0} />
        <MiniMetric label="Passed" value={step?.successful ?? 0} tone="success" />
        <MiniMetric label="Failed" value={step?.failed ?? 0} tone="error" />
        <MiniMetric label="P95" value={step?.p95_ms != null ? `${step.p95_ms}ms` : 'Waiting'} />
      </div>
    </div>
  )
}

function JourneyPath({ steps, endpoints }: { steps: ScenarioLiveStep[]; endpoints: Props['endpoints'] }) {
  return (
    <div className="overflow-x-auto pb-1">
      <ol className="flex min-w-max items-center">
        {endpoints.map((endpoint, index) => {
          const step = steps[index]
          const state = step?.state ?? 'waiting'
          return (
            <li key={endpoint.id} className="flex items-center">
              <div className={`relative min-w-[180px] rounded-lg border px-3 py-2.5 ${stepTone(state)}`}>
                <div className="flex items-center gap-2">
                  <StepStateIcon state={state} />
                  <span className="font-mono text-[9px] font-bold text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{endpoint.method || step?.method || 'REQ'}</span>
                </div>
                <div className="mt-1.5 max-w-[160px] truncate text-xs font-medium" title={endpoint.name}>{endpoint.name}</div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {step?.attempts ? `${step.success_rate.toFixed(1)}% · ${step.p95_ms ?? '—'}ms p95` : state.replace('_', ' ')}
                </div>
              </div>
              {index < endpoints.length - 1 && <div className={`h-px w-9 ${state === 'passed' ? 'bg-emerald-500/50' : 'bg-border'}`} />}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function findPrimaryFailure(live: ScenarioRunStatus | null, result: ScenarioResult | null, steps: ScenarioLiveStep[]) {
  const failedStep = steps.find((step) => step.failure)
  if (failedStep?.failure) return { failure: failedStep.failure, step: failedStep }
  if (live?.recent_events) {
    const event = [...live.recent_events].reverse().find((item) => item.failure)
    if (event?.failure) return { failure: event.failure, step: steps[event.step_index] }
  }
  if (live?.failure) return { failure: live.failure, step: undefined }
  if (result?.error) return { failure: { kind: 'unknown', message: result.error } as ScenarioFailure, step: undefined }
  return null
}

function FailureInspector({ failure, step, failedCount }: { failure: ScenarioFailure; step?: ScenarioLiveStep; failedCount: number }) {
  const copyFailure = () => {
    const text = [
      `${humanFailureKind(failure.kind)}: ${failure.message}`,
      step?.name ? `Endpoint: ${step.name}` : '',
      failure.status ? `Status: ${failure.status}` : '',
      failedCount ? `Occurrences: ${failedCount}` : '',
    ].filter(Boolean).join('\n')
    void navigator.clipboard?.writeText(text)
  }
  const assertion = failure.assertion_failures?.[0]

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-red-500/25 bg-red-500/[0.045]">
      <div className="flex items-center gap-2 border-b border-red-500/15 px-4 py-3">
        <AlertTriangle className="h-4 w-4 text-red-400" />
        <div>
          <h3 className="text-xs font-semibold">Why it failed</h3>
          <p className="text-[10px] text-red-300/80">{humanFailureKind(failure.kind)}</p>
        </div>
        <button type="button" onClick={copyFailure} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-red-500/20 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/10">
          <Copy className="h-3 w-3" /> Copy details
        </button>
      </div>
      <div className="grid gap-3 p-4 text-[11px] sm:grid-cols-3">
        <div className="sm:col-span-2">
          <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Cause</div>
          <p className="mt-1 leading-5 text-foreground">{failure.message}</p>
        </div>
        <div>
          <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Affected</div>
          <p className="mt-1 font-mono">{failedCount || 1} execution{failedCount === 1 ? '' : 's'}</p>
        </div>
        {assertion && (
          <>
            <div>
              <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Expected</div>
              <p className="mt-1 font-mono">{String(assertion.expected ?? 'Assertion to pass')}</p>
            </div>
            <div>
              <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Received</div>
              <p className="mt-1 font-mono text-red-300">{String(assertion.actual ?? 'No value')}</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  const className = status === 'running' || status === 'stopping'
    ? 'bg-blue-500/15 text-blue-300'
    : status === 'passed'
      ? 'bg-emerald-500/15 text-emerald-500'
      : status === 'stopped'
        ? 'bg-amber-500/15 text-amber-500'
        : 'bg-red-500/15 text-red-500'
  return (
    <div className={`grid h-9 w-9 place-items-center rounded-lg ${className}`}>
      {status === 'running' || status === 'stopping'
        ? <CircleDashed className="h-4 w-4 animate-spin" />
        : status === 'passed'
          ? <CheckCircle2 className="h-4 w-4" />
          : status === 'stopped'
            ? <Clock3 className="h-4 w-4" />
            : <XCircle className="h-4 w-4" />}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
      status === 'running' || status === 'stopping'
        ? 'bg-blue-500/15 text-blue-300'
        : status === 'passed'
          ? 'bg-emerald-500/15 text-emerald-500'
          : status === 'stopped'
            ? 'bg-amber-500/15 text-amber-500'
            : 'bg-red-500/15 text-red-500'
    }`}>
      {status.replace('_', ' ')}
    </span>
  )
}

function StepStateIcon({ state }: { state: ScenarioLiveStep['state'] }) {
  if (state === 'passed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
  if (state === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-500" />
  if (state === 'running' || state === 'retrying') return <RotateCcw className="h-3.5 w-3.5 animate-spin text-blue-400" />
  return <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
}

function stepTone(state: ScenarioLiveStep['state']) {
  if (state === 'passed') return 'border-emerald-500/25 bg-emerald-500/[0.04]'
  if (state === 'failed') return 'border-red-500/25 bg-red-500/[0.04]'
  if (state === 'running' || state === 'retrying') return 'border-blue-400/30 bg-blue-500/[0.045]'
  return 'border-border/70 bg-background/55'
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="bg-background/70 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[9px] text-muted-foreground">{detail}</div>
    </div>
  )
}

function MiniMetric({ label, value, tone }: { label: string; value: string | number; tone?: 'success' | 'error' }) {
  return (
    <div>
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-sm font-semibold ${tone === 'success' ? 'text-emerald-500' : tone === 'error' ? 'text-red-400' : ''}`}>{value}</div>
    </div>
  )
}

function Signal({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-background/70 px-3 py-3">
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[9px] text-muted-foreground">{detail}</div>
    </div>
  )
}

function humanFailureKind(kind: ScenarioFailure['kind']) {
  return {
    transport_error: 'Connection error',
    timeout: 'Request timeout',
    http_error: 'HTTP error',
    assertion_failed: 'Assertion failed',
    endpoint_missing: 'Endpoint missing',
    failure_threshold: 'Failure threshold reached',
    cancelled: 'Run cancelled',
    unknown: 'Unexpected error',
  }[kind]
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = Math.floor(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
