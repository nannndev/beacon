import { ArrowLeftRight, CheckCircle2, WifiOff, Clock, Braces, FileText, Binary } from 'lucide-react'
import type { SendResponse } from '../lib/api'

interface Props {
  response: SendResponse | null
  loading: boolean
}

export function WebSocketInspector({ response, loading }: Props) {
  if (loading) {
    return (
      <section className="rounded-xl border border-blue-500/25 bg-card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border bg-blue-500/[0.045] px-4 py-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-500/10 text-blue-500">
            <ArrowLeftRight className="h-3.5 w-3.5 animate-pulse" />
          </span>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600 dark:text-blue-400">WebSocket</div>
          </div>
          <span className="text-xs text-muted-foreground ml-auto">Connecting…</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted/70" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted/50" />
          <div className="h-16 animate-pulse rounded bg-muted/30" />
        </div>
      </section>
    )
  }

  if (!response) return null

  const connected = response.ok && response.status !== 'timeout'
  const error = !response.ok

  return (
    <section className="rounded-xl border border-blue-500/25 bg-card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border bg-blue-500/[0.045] px-4 py-2.5">
        <span className={`grid h-7 w-7 place-items-center rounded-lg ${response.ok ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
          {response.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600 dark:text-blue-400">WebSocket</div>
          <div className="truncate text-sm font-semibold">{response.target || 'Unknown'}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-bold capitalize ${
          error ? 'bg-red-500/10 text-red-500' : connected ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
        }`}>
          {error ? (response.phase || 'error') : connected ? 'connected' : 'timeout'}
        </span>
      </div>

      <div className="p-4 space-y-3">
        {error ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-sm font-medium text-red-600 dark:text-red-400">
            {response.error || 'Connection failed'}
          </div>
        ) : null}

        {!error && !connected && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-sm text-amber-600 dark:text-amber-400">
            No response received within timeout.
          </div>
        )}

        {connected && response.ws_sent !== undefined ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Sent</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <ArrowLeftRight className="h-3.5 w-3.5 text-cyan-500" />
                  <span className="font-mono text-[10px] font-semibold text-cyan-500 capitalize">{response.ws_message_type || 'text'}</span>
                </div>
                <div className="mt-2 font-mono text-xs break-all text-slate-300">{response.ws_sent}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Received</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${response.ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className="font-mono text-[10px] font-semibold">{response.ws_received_type || 'unknown'}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] text-muted-foreground">
                  <span><Clock className="inline h-3 w-3 mr-0.5" /> {response.time_ms}ms</span>
                  {response.recv_ms !== undefined ? <span>recv {response.recv_ms}ms</span> : null}
                  {response.ws_raw_bytes !== undefined ? <span>{response.ws_raw_bytes} bytes</span> : null}
                </div>
              </div>
            </div>

            {response.body && (
              <div className="rounded-lg border border-border bg-muted/10 overflow-hidden">
                <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
                  {response.ws_received_type === 'binary' ? (
                    <Binary className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : response.json ? (
                    <Braces className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {response.ws_received_type === 'binary' ? 'Binary (base64)' : 'Body'}
                  </span>
                </div>
                <div className="p-3">
                  {response.json ? (
                    <pre className="font-mono text-xs leading-relaxed text-slate-300 break-all whitespace-pre-wrap">{JSON.stringify(response.json, null, 2)}</pre>
                  ) : (
                    <pre className="font-mono text-xs leading-relaxed text-slate-300 break-all whitespace-pre-wrap">{response.body}</pre>
                  )}
                </div>
              </div>
            )}

            {response.assertions?.length ? (
              <div className="rounded-lg border border-border bg-muted/10 p-3">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Assertions</div>
                <div className="space-y-1.5">
                  {response.assertions.map((a, i) => (
                    <div key={i} className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                      a.ok ? 'bg-emerald-500/5 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/5 text-red-500'
                    }`}>
                      {a.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                      <span className="flex-1">{a.message || `Assertion ${i + 1}`}</span>
                      {a.expected !== undefined ? (
                        <span className="font-mono text-[9px]">
                          <span className="opacity-60 mr-1">{String(a.actual ?? '?')}</span>
                          <span className="opacity-40">{a.op || '='} {String(a.expected)}</span>
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  )
}

export default WebSocketInspector
