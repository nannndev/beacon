import { Pin, Search } from 'lucide-react'

import type { HistoryFilters, HistorySummary } from '../../types/history'


interface Props {
  runs: HistorySummary[]
  selectedId: string | null
  compareIds: string[]
  filters: HistoryFilters
  loading: boolean
  nextCursor: string | null
  onFilters: (filters: HistoryFilters) => void
  onSelect: (id: string) => void
  onToggleCompare: (id: string) => void
  onLoadMore: () => void
}

const statusTone: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
  stopped: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  interrupted: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  running: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
}

export function HistoryList({ runs, selectedId, compareIds, filters, loading, nextCursor, onFilters, onSelect, onToggleCompare, onLoadMore }: Props) {
  return (
    <section className="flex min-h-0 flex-col border-r border-border bg-card/30">
      <div className="space-y-3 border-b border-border p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filters.search || ''}
            onChange={(event) => onFilters({ ...filters, search: event.target.value || undefined })}
            placeholder="Search runs or labels…"
            className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500/30"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={filters.mode || ''} onChange={(event) => onFilters({ ...filters, mode: event.target.value || undefined })} className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
            <option value="">All modes</option>
            {['load', 'ramp', 'spike', 'soak', 'rate_probe', 'fuzz', 'benchmark', 'scenario'].map((mode) => <option key={mode} value={mode}>{mode.replace('_', ' ')}</option>)}
          </select>
          <select value={filters.status || ''} onChange={(event) => onFilters({ ...filters, status: (event.target.value || undefined) as any })} className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
            <option value="">All statuses</option>
            {['completed', 'failed', 'stopped', 'interrupted', 'running'].map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={filters.pinned || false} onChange={(event) => onFilters({ ...filters, pinned: event.target.checked || undefined })} />
          Pinned only
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && runs.length === 0 && Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="mb-2 h-24 animate-pulse rounded-xl bg-muted" />
        ))}
        {!loading && runs.length === 0 && (
          <div className="m-2 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No saved runs match these filters.</div>
        )}
        {runs.map((run) => (
          <article key={run.id} className={`group mb-2 rounded-xl border p-3 transition ${selectedId === run.id ? 'border-cyan-500/60 bg-cyan-500/5' : 'border-border bg-card hover:border-muted-foreground/40'}`}>
            <div className="flex items-start gap-2">
              <button type="button" onClick={() => onSelect(run.id)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{run.target_name}</span>
                  {run.is_pinned && <Pin className="h-3 w-3 shrink-0 fill-current text-cyan-500" />}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase">{run.mode}</span>
                  <span className={`rounded px-1.5 py-0.5 ${statusTone[run.status] || 'bg-muted'}`}>{run.status}</span>
                  <span>{new Date(run.started_at).toLocaleString()}</span>
                </div>
                <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
                  <span><b className="text-foreground">{run.success ?? 0}</b> success</span>
                  <span><b className="text-foreground">{run.p95_ms ?? '—'}</b> ms p95</span>
                  <span><b className="text-foreground">{run.average_rps ?? '—'}</b> rps</span>
                </div>
              </button>
              <label className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background" title="Select for comparison">
                <input
                  type="checkbox"
                  checked={compareIds.includes(run.id)}
                  onChange={() => onToggleCompare(run.id)}
                  aria-label={`Compare ${run.target_name}`}
                  className="h-3.5 w-3.5"
                />
              </label>
            </div>
          </article>
        ))}
        {nextCursor && (
          <button type="button" onClick={onLoadMore} disabled={loading} className="my-2 h-9 w-full rounded-lg border border-border text-xs hover:bg-muted disabled:opacity-50">{loading ? 'Loading…' : 'Load more'}</button>
        )}
      </div>
    </section>
  )
}
