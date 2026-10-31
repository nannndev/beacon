import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Send, X } from 'lucide-react'
import type { SendResponse } from '../lib/api'
import ResponseInspector from './ResponseInspector'

interface Props {
  endpointName: string
  response: SendResponse | null
  loading: boolean
  extractors?: Record<string, string>
  onExtract?: (name: string, path: string, value: unknown) => Promise<void>
  onSetAsExample?: (response: SendResponse) => Promise<void> | void
  onGenerateAssertions?: (response: SendResponse) => Promise<void> | void
  onClose: () => void
}

export function SendResponsePanel({
  endpointName,
  response,
  loading,
  extractors,
  onExtract,
  onSetAsExample,
  onGenerateAssertions,
  onClose,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)

  // A new send is important enough to reveal the inspector even when the
  // previous response was collapsed.
  useEffect(() => setCollapsed(false), [endpointName, loading])

  return (
    <section className="overflow-hidden rounded-xl border border-cyan-500/25 bg-card shadow-[0_16px_50px_-38px_rgba(6,182,212,0.65)]">
      <div className="flex min-h-11 items-center gap-3 border-b border-border bg-cyan-500/[0.045] px-4 py-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-cyan-500/10 text-cyan-500">
          <Send className={`h-3.5 w-3.5 ${loading ? 'animate-pulse' : ''}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-600 dark:text-cyan-400">Single response</div>
          <div className="truncate text-sm font-semibold">{endpointName}</div>
        </div>
        {loading && <span className="text-xs text-muted-foreground">Sending…</span>}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={collapsed ? 'Expand response panel' : 'Collapse response panel'}
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Close response panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {!collapsed && (
        <div className="bg-muted/10 p-3">
          <ResponseInspector
            response={response}
            loading={loading}
            extractors={extractors}
            extractDestinationName={endpointName}
            onExtract={onExtract}
            onSetAsExample={onSetAsExample}
            onGenerateAssertions={onGenerateAssertions}
          />
        </div>
      )}
    </section>
  )
}
