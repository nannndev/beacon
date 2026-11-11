import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Loader2, Play, RotateCcw, Sparkles, Square } from 'lucide-react'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { toast } from '../ui/toast'
import { getBase } from '../../lib/api'
import { AgentModelPicker } from '../agent/AgentModelPicker'

interface GatewayPlaygroundProps {
  models: string[]
  combos: Record<string, string[]>
  initialModel?: string | null
  onManageProviders: () => void
  onCompleted?: () => void
}

const PRESETS = [
  {
    label: 'Say hello',
    prompt: 'Say hello in one sentence and state which model answered this request.',
  },
  {
    label: 'JSON check',
    prompt: 'Respond strictly with valid JSON: {"status":"ok","service":"beacon-gateway","tip":"short API testing tip"}.',
  },
  {
    label: 'cURL helper',
    prompt: 'Write a concise cURL POST example sending JSON to /api/login with a Bearer token header.',
  },
]

export function GatewayPlayground({
  models,
  combos,
  initialModel,
  onManageProviders,
  onCompleted,
}: GatewayPlaygroundProps) {
  const [model, setModel] = useState<string>(initialModel || models[0] || '')
  const [systemPrompt, setSystemPrompt] = useState('You are a concise assistant running through Beacon AI Gateway.')
  const [prompt, setPrompt] = useState(PRESETS[0].prompt)
  const [temperature, setTemperature] = useState(0.5)
  const [maxTokens, setMaxTokens] = useState(512)
  const [stream, setStream] = useState(true)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [telemetry, setTelemetry] = useState<{
    status: number
    durationMs: number
    inTok?: number
    outTok?: number
    resolvedModel?: string
  } | null>(null)

  const acRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (initialModel) {
      setModel(initialModel)
    } else if (!model && models.length > 0) {
      setModel(models[0])
    }
  }, [initialModel, models, model])

  const stop = () => {
    acRef.current?.abort()
    acRef.current = null
    setRunning(false)
  }

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!model.trim() || !prompt.trim() || running) return

    const ac = new AbortController()
    acRef.current = ac
    setRunning(true)
    setOutput('')
    setErrorMsg(null)
    setTelemetry(null)

    const t0 = performance.now()
    try {
      const apiBase = await getBase()
      const messages = [
        ...(systemPrompt.trim() ? [{ role: 'system', content: systemPrompt.trim() }] : []),
        { role: 'user', content: prompt.trim() },
      ]
      const res = await fetch(`${apiBase}/gateway/admin/playground`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.trim(),
          messages,
          temperature,
          max_tokens: maxTokens,
          stream,
        }),
        signal: ac.signal,
      })

      if (!res.ok) {
        const text = await res.text()
        let msg = text || `HTTP ${res.status}`
        try {
          const parsed = JSON.parse(text)
          msg = parsed?.error?.message || parsed?.detail || msg
        } catch {
          // keep plain text
        }
        setErrorMsg(msg)
        setTelemetry({ status: res.status, durationMs: Math.round(performance.now() - t0) })
        return
      }

      const contentType = res.headers.get('content-type') || ''
      if (stream && contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        let inTok: number | undefined
        let outTok: number | undefined
        let resolvedModel: string | undefined

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (!data || data === '[DONE]') continue
            try {
              const ev = JSON.parse(data)
              if (ev.model && !resolvedModel) resolvedModel = String(ev.model)
              const delta = ev?.choices?.[0]?.delta?.content
              if (typeof delta === 'string' && delta) {
                setOutput((prev) => prev + delta)
              }
              const usage = ev?.usage
              if (usage) {
                if (typeof usage.prompt_tokens === 'number') inTok = usage.prompt_tokens
                if (typeof usage.completion_tokens === 'number') outTok = usage.completion_tokens
              }
            } catch {
              // ignore non-JSON SSE keepalives
            }
          }
        }
        setTelemetry({
          status: res.status,
          durationMs: Math.round(performance.now() - t0),
          inTok,
          outTok,
          resolvedModel,
        })
      } else {
        const data = await res.json()
        const content =
          data?.choices?.[0]?.message?.content ??
          data?.content?.map?.((c: any) => c?.text || '').join('') ??
          JSON.stringify(data, null, 2)
        setOutput(typeof content === 'string' ? content : JSON.stringify(content, null, 2))
        setTelemetry({
          status: res.status,
          durationMs: Math.round(performance.now() - t0),
          inTok: data?.usage?.prompt_tokens ?? data?.usage?.input_tokens,
          outTok: data?.usage?.completion_tokens ?? data?.usage?.output_tokens,
          resolvedModel: data?.model,
        })
      }
      onCompleted?.()
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorMsg(err?.message || 'Playground request failed')
      }
    } finally {
      setRunning(false)
      acRef.current = null
    }
  }

  const copyOutput = async () => {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      toast.success('Response copied')
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Failed to copy')
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-picker-bounds>
      {/* Left: Request Builder */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-500" />
            <span className="text-sm font-semibold">Live Playground</span>
          </div>
          {models.length === 0 && (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onManageProviders}>
              Connect provider
            </Button>
          )}
        </div>

        <form onSubmit={run} className="space-y-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground block">Target Model or Combo</label>
            <div className="flex items-center gap-2 flex-wrap">
              <AgentModelPicker
                value={model}
                onChange={(v) => setModel(v === 'auto' ? (models[0] || '') : v)}
                options={models}
                combos={combos}
                placement="bottom"
                placeholderLabel="Select routed model…"
                onManageProviders={onManageProviders}
              />
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. oa/gpt-4o or auto/fast"
                className="h-8 font-mono text-xs flex-1 min-w-[160px]"
                data-no-token-complete
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground block">System Prompt (optional)</label>
            <Input
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Optional system instruction…"
              className="h-8 text-xs"
              data-no-token-complete
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-muted-foreground">Prompt</label>
              <div className="flex items-center gap-1 flex-wrap">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setPrompt(p.prompt)}
                    className="rounded border border-border bg-muted/40 hover:bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void run()
                }
              }}
              placeholder="Ask anything to test latency, streaming, or fallback…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-ring resize-y"
              data-no-token-complete
            />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-0.5">
            <div>
              <label className="text-[10.5px] text-muted-foreground block mb-1">
                Temp: <span className="font-mono text-foreground">{temperature.toFixed(1)}</span>
              </label>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
            </div>
            <div>
              <label className="text-[10.5px] text-muted-foreground block mb-1">Max tokens</label>
              <Input
                type="number"
                min={32}
                max={8192}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Math.max(32, Number(e.target.value) || 512))}
                className="h-7 font-mono text-xs"
                data-no-token-complete
              />
            </div>
            <div className="flex flex-col justify-end">
              <label className="inline-flex items-center gap-2 text-xs cursor-pointer h-7 px-2 rounded-md border border-border bg-muted/30">
                <input
                  type="checkbox"
                  checked={stream}
                  onChange={(e) => setStream(e.target.checked)}
                  className="accent-cyan-500"
                />
                <span>Stream SSE</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-[10.5px] text-muted-foreground font-mono">⌘Enter to run</span>
            <div className="flex items-center gap-2">
              {output && !running && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1 text-xs"
                  onClick={() => {
                    setOutput('')
                    setErrorMsg(null)
                    setTelemetry(null)
                  }}
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Clear
                </Button>
              )}
              {running ? (
                <Button type="button" size="sm" variant="destructive" className="h-8 gap-1.5 text-xs" onClick={stop}>
                  <Square className="w-3 h-3 fill-current" /> Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={!model.trim() || !prompt.trim()}
                >
                  <Play className="w-3.5 h-3.5" /> Run completion
                </Button>
              )}
            </div>
          </div>
        </form>
      </Card>

      {/* Right: Output & Telemetry */}
      <Card className="p-4 flex flex-col min-h-[340px]">
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold">Response</span>
            {running && (
              <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-500">
                <Loader2 className="w-3 h-3 animate-spin" /> Streaming…
              </span>
            )}
            {telemetry && (
              <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono">
                <span
                  className={`rounded px-1.5 py-0.5 ${
                    telemetry.status < 400
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-red-500/15 text-red-500'
                  }`}
                >
                  HTTP {telemetry.status}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                  {telemetry.durationMs} ms
                </span>
                {(telemetry.inTok != null || telemetry.outTok != null) && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                    {telemetry.inTok ?? 0} in / {telemetry.outTok ?? 0} out
                  </span>
                )}
              </div>
            )}
          </div>
          {output && (
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => void copyOutput()}>
              {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              Copy
            </Button>
          )}
        </div>

        <div className="flex-1 pt-3 overflow-y-auto">
          {errorMsg ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500 font-mono whitespace-pre-wrap">
              {errorMsg}
            </div>
          ) : output ? (
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">{output}</pre>
          ) : (
            <div className="h-full flex items-center justify-center text-center text-xs text-muted-foreground py-12">
              {models.length === 0
                ? 'Connect at least one provider or OAuth subscription account to test requests here.'
                : 'Select a model or auto/ combo on the left and click Run completion to verify live gateway routing.'}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

