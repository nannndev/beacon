import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, DatabaseZap, History as HistoryIcon, RefreshCw } from 'lucide-react'

import { api } from '../lib/api'
import type { HistoryCompareResult, HistoryDetail, HistoryFilters, HistoryHealth, HistoryListResponse } from '../types/history'
import { HistoryCompare } from '../components/history/HistoryCompare'
import { HistoryDetail as HistoryDetailView } from '../components/history/HistoryDetail'
import { HistoryList } from '../components/history/HistoryList'
import { useConfirmDialog } from '../components/ui/confirm-dialog'


type HistoryClient = Pick<typeof api, 'listHistory' | 'historyDetail' | 'compareHistory' | 'updateHistory' | 'deleteHistory' | 'exportHistory' | 'reportHistory' | 'historyHealth' | 'rebuildHistory'>

interface Props {
  projectId: string
  onBack: () => void
  initialRunId?: string | null
  client?: HistoryClient
}

export function HistoryPage({ projectId, onBack, initialRunId, client = api }: Props) {
  const { confirm, confirmationDialog } = useConfirmDialog()
  const [filters, setFilters] = useState<HistoryFilters>({ project_id: projectId, limit: 30 })
  const [list, setList] = useState<HistoryListResponse>({ items: [], next_cursor: null })
  const [selectedId, setSelectedId] = useState<string | null>(initialRunId || null)
  const [detail, setDetail] = useState<HistoryDetail | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [comparison, setComparison] = useState<HistoryCompareResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState<HistoryHealth | null>(null)
  const [resetText, setResetText] = useState('')

  const load = useCallback(async (append = false) => {
    setLoading(true)
    try {
      const response = await client.listHistory({ ...filters, cursor: append ? list.next_cursor || undefined : undefined })
      setList((current) => ({ items: append ? [...current.items, ...response.items] : response.items, next_cursor: response.next_cursor }))
      setHealth(null)
    } catch {
      try { setHealth(await client.historyHealth()) } catch { setHealth({ available: false, error_code: 'history_unavailable', backup_available: false }) }
    } finally {
      setLoading(false)
    }
  }, [client, filters, list.next_cursor])

  useEffect(() => { void load(false) }, [projectId, filters.mode, filters.status, filters.pinned, filters.search])
  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    void client.historyDetail(selectedId).then(setDetail).catch(() => setDetail(null))
  }, [client, selectedId])
  useEffect(() => {
    if (compareIds.length !== 2) { setComparison(null); return }
    void client.compareHistory(compareIds[0], compareIds[1]).then(setComparison).catch(() => setComparison(null))
  }, [client, compareIds])

  const toggleCompare = (id: string) => setCompareIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current.slice(-1), id])
  const refreshDetail = async () => { if (selectedId) setDetail(await client.historyDetail(selectedId)) }
  const pin = async () => { if (detail) { await client.updateHistory(detail.id, { is_pinned: !detail.is_pinned }); await refreshDetail(); await load(false) } }
  const label = async () => { if (detail) { const value = window.prompt('Run label', detail.label || '') ; if (value !== null) { await client.updateHistory(detail.id, { label: value }); await refreshDetail(); await load(false) } } }
  const remove = async () => {
    if (!detail || !await confirm({
      title: 'Delete this saved run?',
      description: 'The run metrics, response samples, and ordered steps will be removed.',
      confirmLabel: 'Delete saved run',
      detail: 'This action cannot be undone.',
    })) return
    await client.deleteHistory(detail.id)
    setSelectedId(null)
    setDetail(null)
    await load(false)
  }
  const exportRun = async () => { if (!detail) return; const payload = await client.exportHistory(detail.id); const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `beacon-run-${detail.id}.json`; link.click(); URL.revokeObjectURL(url) }
  const exportReport = async (format: 'html' | 'md' = 'html') => {
    if (!detail) return
    try {
      const text = await client.reportHistory(detail.id, format)
      const type = format === 'md' ? 'text/markdown' : 'text/html'
      const url = URL.createObjectURL(new Blob([text], { type }))
      const link = document.createElement('a')
      link.href = url
      link.download = `beacon-report-${detail.id}.${format}`
      link.click()
      URL.revokeObjectURL(url)
    } catch { /* report is auxiliary — a failure shouldn't disrupt the page */ }
  }

  if (health && !health.available) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <DatabaseZap className="mx-auto h-9 w-9 text-amber-500" />
          <h2 className="mt-4 text-xl font-bold">Run History is unavailable</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Your endpoint editor and tests still work normally. Only saved history is paused until the local database is rebuilt.</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Resetting does <span className="font-medium text-foreground">not delete your data</span> — the current database is saved as a timestamped <code className="rounded bg-muted px-1">.backup-*.db</code> file next to it, then a fresh one is created.{health.backup_available && ' An earlier backup already exists.'}</p>
          <div className="mt-5 rounded-xl bg-muted/50 p-3 text-left"><label className="text-xs font-medium">Type RESET HISTORY to create a fresh database</label><input value={resetText} onChange={(event) => setResetText(event.target.value)} className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" /></div>
          <div className="mt-4 flex justify-center gap-2"><button onClick={onBack} className="history-action"><ArrowLeft className="h-3.5 w-3.5" /> Back to workspace</button><button disabled={resetText !== 'RESET HISTORY'} onClick={async () => { await client.rebuildHistory(resetText); setHealth(null); setResetText(''); await load(false) }} className="history-action bg-red-500 text-white disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" /> Reset History Database</button></div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3"><button onClick={onBack} className="history-action"><ArrowLeft className="h-3.5 w-3.5" /> Workspace</button><div className="h-6 border-l border-border" /><HistoryIcon className="h-5 w-5 text-cyan-500" /><div><h1 className="text-sm font-bold">Run History</h1><p className="text-[10px] text-muted-foreground">Inspect trends and compare exactly two runs</p></div></div>
        <button onClick={() => load(false)} className="history-action"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
      </header>
      {compareIds.length > 0 && <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-cyan-500/5 px-4 text-xs"><span>{compareIds.length === 1 ? 'Select one more run to compare' : 'Comparing two runs'}</span><button onClick={() => setCompareIds([])} className="font-semibold text-cyan-600">Clear selection</button></div>}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[38%_62%]">
        <div className={`${(detail || comparison) ? 'hidden md:block' : 'min-h-0'}`}>
          <HistoryList runs={list.items} selectedId={selectedId} compareIds={compareIds} filters={filters} loading={loading} nextCursor={list.next_cursor} onFilters={(next) => setFilters({ ...next, project_id: projectId, limit: 30 })} onSelect={setSelectedId} onToggleCompare={toggleCompare} onLoadMore={() => load(true)} />
        </div>
        <section className={`${(detail || comparison) ? 'min-h-0' : 'hidden'} md:block`}>
          {(detail || comparison) && <button type="button" onClick={() => { setSelectedId(null); setCompareIds([]); setDetail(null); setComparison(null) }} className="history-action m-3 md:hidden"><ArrowLeft className="h-3.5 w-3.5" /> Back to runs</button>}
          {comparison ? <HistoryCompare comparison={comparison} /> : detail ? <HistoryDetailView detail={detail} onPin={pin} onLabel={label} onExport={exportRun} onReport={exportReport} onDelete={remove} /> : <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground"><div><HistoryIcon className="mx-auto mb-3 h-8 w-8 opacity-40" />Select a run to inspect metrics, samples, and ordered steps.</div></div>}
        </section>
      </div>
      {confirmationDialog}
    </div>
  )
}
