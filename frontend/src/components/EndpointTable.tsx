import { useEffect, useMemo, useRef, useState } from 'react'
import { usePersistentState } from '../hooks/usePersistentState'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import {
  Play,
  Copy,
  Trash2,
  Pencil,
  SlidersHorizontal,
  Search,
  Loader2,
  ChevronDown,
  ChevronRight,
  Globe2,
  Send,
  Eye,
  DatabaseZap,
  ShieldCheck,
  PanelRightClose,
  PanelRightOpen,
  BarChart3,
  X,
} from 'lucide-react'
import { Input } from './ui/input'
import { Endpoint, CollectionItem } from '../types'
import { CollectionTree } from './CollectionTree'
import { RunStatus } from './LiveMonitor'

const methodColor: Record<string, string> = {
  GET:    'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  POST:   'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  PUT:    'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  DELETE: 'bg-red-500/15 text-red-600 dark:text-red-400',
  PATCH:  'bg-purple-500/15 text-purple-600 dark:text-purple-400',
}

const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

interface Props {
  tests: Endpoint[]
  items?: CollectionItem[]
  selectedId: string | null
  runningTestId: string | null
  runStatus: RunStatus
  onSelect: (id: string) => void
  onNew: () => void
  onNewFolder?: () => void
  onEdit: (id: string) => void
  onQuickEdit: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string, name: string) => void
  onRunRow: (id: string) => void
  onSendRow: (id: string) => void
  sendingTestId?: string | null
  onRunFolder?: (folderId: string) => void
  onRunScenario?: (folderId: string) => void
  onRunAll?: () => void
  onPreviewApis?: () => void
  /** Add a new endpoint directly inside the given folder. */
  onNewInFolder?: (folderId: string) => void
  onRenameFolder?: (folderId: string, currentName: string) => void
  onDuplicateFolder?: (folderId: string) => void
  onDeleteFolder?: (folderId: string, name: string) => void
  /** Persist a reordered/moved items tree. */
  onReorder?: (items: CollectionItem[]) => void
}

function filterCollectionTree(
  nodes: CollectionItem[],
  search: string,
  methodFilter: string | null,
): CollectionItem[] {
  if (!search.trim() && !methodFilter) return nodes
  const q = search.trim().toLowerCase()

  const walk = (list: CollectionItem[]): CollectionItem[] => {
    const out: CollectionItem[] = []
    for (const node of list) {
      if (node.type === 'folder') {
        const folderNameMatch = Boolean(q && node.name.toLowerCase().includes(q))
        const filteredChildren = walk(node.items || [])
        if (filteredChildren.length > 0 || (folderNameMatch && !methodFilter)) {
          out.push({
            ...node,
            items: filteredChildren.length > 0 ? filteredChildren : node.items || [],
          })
        }
      } else {
        const ep = node as unknown as Endpoint
        const matchesSearch =
          !q ||
          (ep.name || '').toLowerCase().includes(q) ||
          (ep.url || '').toLowerCase().includes(q)
        const matchesMethod = !methodFilter || ep.method === methodFilter
        if (matchesSearch && matchesMethod) {
          out.push(node)
        }
      }
    }
    return out
  }

  return walk(nodes)
}

export function EndpointTable({
  tests,
  items,
  selectedId,
  runningTestId,
  runStatus,
  onSelect,
  onNew,
  onNewFolder,
  onEdit,
  onQuickEdit,
  onDuplicate,
  onDelete,
  onRunRow,
  onSendRow,
  sendingTestId,
  onRunFolder,
  onRunScenario,
  onRunAll,
  onPreviewApis,
  onNewInFolder,
  onRenameFolder,
  onDuplicateFolder,
  onDeleteFolder,
  onReorder,
}: Props) {
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState<string | null>(null)
  const [sectionOpen, setSectionOpen] = usePersistentState('beacon.ui.endpointsOpen', true)
  const [statsOpen, setStatsOpen] = usePersistentState('beacon.ui.statsPanelOpen', true)
  const [collapsedFolders, setCollapsedFolders] = usePersistentState<string[]>('beacon.ui.collapsedFolders', [])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const collapsedSet = new Set(collapsedFolders)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tagName = target?.tagName
      const isInput = tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable
      if (e.key === '/' && !isInput) {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !e.shiftKey) {
        if (!target?.closest('[role="dialog"]') && tagName !== 'TEXTAREA') {
          e.preventDefault()
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const collectFolderIds = (nodes: CollectionItem[] = []): string[] => {
    const ids: string[] = []
    const walk = (n: CollectionItem[]) => {
      for (const item of n) {
        if (item.type === 'folder') {
          ids.push(item.id)
          if (item.items) walk(item.items)
        }
      }
    }
    walk(nodes)
    return ids
  }

  const allFolderIds = collectFolderIds(items || [])
  const isFiltering = Boolean(search.trim() || methodFilter)
  // Auto-expand all folders while searching/filtering so matches are immediately visible
  const expandedFolders = new Set(
    isFiltering ? allFolderIds : allFolderIds.filter((id) => !collapsedSet.has(id)),
  )

  const filtered = tests.filter((t) => {
    const matchesSearch =
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.url.toLowerCase().includes(search.toLowerCase())
    const matchesMethod = !methodFilter || t.method === methodFilter
    return matchesSearch && matchesMethod
  })

  const filteredTreeItems = useMemo(
    () => (items && items.length > 0 ? filterCollectionTree(items, search, methodFilter) : []),
    [items, search, methodFilter],
  )

  const usedMethods = Array.from(new Set(tests.map((t) => t.method))).filter((m) =>
    ALL_METHODS.includes(m),
  )

  const toggleFolder = (id: string) => {
    setCollapsedFolders((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const expandAll = () => setCollapsedFolders([])
  const collapseAll = () => setCollapsedFolders(items ? collectFolderIds(items) : [])

  // Stats for the side pane.
  const getTreeStats = (nodes: CollectionItem[] = []) => {
    let folders = 0
    let requests = 0
    let extractors = 0
    let assertions = 0
    const byMethod: Record<string, number> = {}
    const walk = (n: CollectionItem[]) => {
      for (const item of n) {
        if (item.type === 'folder') {
          folders++
          if (item.items) walk(item.items)
        } else {
          requests++
          const ep = item as Endpoint
          const m = ep.method
          if (m) byMethod[m] = (byMethod[m] || 0) + 1
          if (ep.extractors) {
            extractors += Object.keys(ep.extractors).filter(Boolean).length
          }
          if (ep.assertions) {
            assertions += ep.assertions.length
          }
        }
      }
    }
    walk(nodes)
    return { folders, requests, byMethod, extractors, assertions }
  }

  const treeStats = useMemo(() => (items && items.length > 0 ? getTreeStats(items) : null), [items])

  const filteredTreeStats = useMemo(
    () => (items && items.length > 0 ? getTreeStats(filteredTreeItems) : null),
    [items, filteredTreeItems],
  )

  const totalCount = treeStats ? treeStats.requests : tests.length
  const matchedCount = treeStats ? (filteredTreeStats ? filteredTreeStats.requests : 0) : filtered.length

  const methodCounts = useMemo(() => {
    if (treeStats) return treeStats.byMethod
    const counts: Record<string, number> = {}
    for (const t of tests) {
      if (t.method) counts[t.method] = (counts[t.method] || 0) + 1
    }
    return counts
  }, [treeStats, tests])

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 py-2.5 px-4">
        <button
          type="button"
          onClick={() => setSectionOpen((v) => !v)}
          className="group flex items-center gap-1.5 text-sm font-semibold"
          title={sectionOpen ? 'Collapse endpoints' : 'Expand endpoints'}
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform duration-300',
              sectionOpen ? '' : '-rotate-90',
            )}
          />
          <CardTitle className="text-sm">
            Endpoints{' '}
            <span className="text-muted-foreground font-normal">
              {items && items.length > 0 && treeStats
                ? `${treeStats.requests} requests in ${treeStats.folders} folders`
                : `${filtered.length}${filtered.length !== tests.length ? `/${tests.length}` : ''}`}
            </span>
          </CardTitle>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {items && items.length > 0 && (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={collapseAll}>
                <ChevronRight className="h-3 w-3" /> Collapse All
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={expandAll}>
                <ChevronDown className="h-3 w-3" /> Expand All
              </Button>
              {treeStats && (
                <Button
                  size="sm"
                  variant={statsOpen ? 'secondary' : 'outline'}
                  className={cn(
                    'h-7 text-xs gap-1.5 transition-all',
                    statsOpen
                      ? 'bg-muted text-foreground border-border'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setStatsOpen((v) => !v)}
                  title={statsOpen ? 'Hide statistics panel (expand endpoints)' : 'Show statistics panel'}
                >
                  {statsOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{statsOpen ? 'Hide Stats' : 'Stats'}</span>
                </Button>
              )}
            </>
          )}
          {onPreviewApis && tests.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs border-cyan-500/30 text-cyan-600 dark:text-cyan-400"
              onClick={onPreviewApis}
            >
              <Eye className="h-3 w-3" /> Preview APIs
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7" onClick={() => onNewFolder?.()}>
            New Folder
          </Button>
          <Button size="sm" className="h-7" onClick={onNew}>
            New Endpoint
          </Button>
        </div>
      </CardHeader>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,0.85,0.25,1)] motion-reduce:transition-none',
          sectionOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {/* Search + filter bar */}
          {(tests.length > 0 || (items && items.length > 0)) && (
            <div className="px-4 pt-2.5 pb-2.5 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      if (search) {
                        e.stopPropagation()
                        setSearch('')
                      } else {
                        searchInputRef.current?.blur()
                      }
                    }
                  }}
                  placeholder="Search endpoints by name or URL (press / to focus)…"
                  className="h-8 pl-8 pr-16 text-xs bg-background/80 focus:bg-background"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('')
                      searchInputRef.current?.focus()
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
                    title="Clear search (Esc)"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : (
                  <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex h-4 select-none items-center gap-1 rounded border border-border bg-muted/60 px-1 font-mono text-[9px] text-muted-foreground">
                    /
                  </kbd>
                )}
              </div>

              {isFiltering && (
                <Badge
                  variant="secondary"
                  className={cn(
                    'h-8 px-2.5 font-mono text-xs flex items-center gap-1 border transition-colors shrink-0',
                    matchedCount === 0
                      ? 'border-red-500/30 bg-red-500/10 text-red-500 dark:text-red-400'
                      : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
                  )}
                  title={`${matchedCount} of ${totalCount} endpoints match current filters`}
                >
                  <span className="font-semibold">{matchedCount}</span>
                  <span className="text-[10px] opacity-75">/ {totalCount} matching</span>
                </Badge>
              )}

              <div className="flex items-center gap-1 flex-wrap">
                {usedMethods.map((m) => {
                  const count = methodCounts[m] || 0
                  const isSelected = methodFilter === m
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethodFilter(isSelected ? null : m)}
                      className={cn(
                        'h-7 px-2 rounded-md text-[10px] font-mono font-bold transition-all border flex items-center gap-1 select-none',
                        isSelected
                          ? methodColor[m] + ' border-current ring-1 ring-current shadow-sm'
                          : 'border-border/60 text-muted-foreground hover:border-current/40 hover:text-foreground bg-background/50',
                      )}
                      title={`Filter by ${m} (${count} endpoints)`}
                    >
                      <span>{m}</span>
                      <span className={cn('text-[9px] px-1 py-0.2 rounded font-normal', isSelected ? 'bg-current/15' : 'bg-muted')}>
                        {count}
                      </span>
                    </button>
                  )
                })}
                {isFiltering && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setMethodFilter(null)
                      setSearch('')
                    }}
                    className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                    title="Clear search and method filter"
                  >
                    <X className="h-3 w-3" /> Clear
                  </Button>
                )}
              </div>
            </div>
          )}

          <CardContent className="p-0">
            {items && items.length > 0 && treeStats ? (
              <div className={cn('grid grid-cols-1 transition-all duration-300', statsOpen ? 'lg:grid-cols-5' : '')}>
                <div className={cn('border-border/50 min-w-0', statsOpen ? 'lg:col-span-3 lg:border-r' : 'col-span-1')}>
                  <div className="max-h-[420px] overflow-auto text-sm p-1">
                    {filteredTreeItems.length === 0 ? (
                      <div className="py-12 px-4 text-center space-y-2">
                        <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted/60 text-muted-foreground mb-1">
                          <Search className="h-4 w-4" />
                        </div>
                        <div className="text-sm font-medium">No endpoints found</div>
                        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                          No endpoints matched &ldquo;{search}&rdquo;{methodFilter ? ` with method ${methodFilter}` : ''}.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs mt-2"
                          onClick={() => {
                            setSearch('')
                            setMethodFilter(null)
                          }}
                        >
                          Clear Search & Filters
                        </Button>
                      </div>
                    ) : (
                      <CollectionTree
                        items={filteredTreeItems}
                        selectedId={selectedId}
                        runningTestId={runningTestId}
                        runStatus={runStatus}
                        expandedFolders={expandedFolders}
                        onToggleFolder={toggleFolder}
                        onSelect={onSelect}
                        onEdit={onEdit}
                        onQuickEdit={onQuickEdit}
                        onDuplicate={onDuplicate}
                        onDelete={onDelete}
                        onRunRow={onRunRow}
                        onSendRow={onSendRow}
                        sendingTestId={sendingTestId}
                        onRunFolder={onRunFolder}
                        onRunScenario={onRunScenario}
                        onNewInFolder={(fid) => onNewInFolder?.(fid)}
                        onRenameFolder={(fid, name) => onRenameFolder?.(fid, name)}
                        onDuplicateFolder={(fid) => onDuplicateFolder?.(fid)}
                        onDeleteFolder={(fid, name) => onDeleteFolder?.(fid, name)}
                        onReorder={(next) => onReorder?.(next)}
                      />
                    )}
                  </div>
                </div>

                {statsOpen && (
                  <div className="lg:col-span-2 p-4 text-xs space-y-4 bg-muted/20 animate-fade-in">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold text-sm flex items-center gap-1.5">
                          <BarChart3 className="h-4 w-4 text-cyan-500" />
                          <span>List Statistics</span>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground rounded"
                          onClick={() => setStatsOpen(false)}
                          title="Hide statistics panel"
                        >
                          <PanelRightClose className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-border/60 bg-background/60 p-2.5">
                        <div className="text-muted-foreground">Folders</div>
                        <div className="font-mono font-medium text-right">{treeStats.folders}</div>
                        <div className="text-muted-foreground">Total Requests</div>
                        <div className="font-mono font-medium text-right">{treeStats.requests}</div>
                        {treeStats.extractors > 0 && (
                          <>
                            <div className="text-muted-foreground">Extractors</div>
                            <div className="font-mono font-medium text-right text-emerald-600 dark:text-emerald-400">
                              {treeStats.extractors}
                            </div>
                          </>
                        )}
                        {treeStats.assertions > 0 && (
                          <>
                            <div className="text-muted-foreground">Assertions</div>
                            <div className="font-mono font-medium text-right text-cyan-600 dark:text-cyan-400">
                              {treeStats.assertions}
                            </div>
                          </>
                        )}
                      </div>

                      {isFiltering && (
                        <div className="mt-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-2.5 py-1.5 text-xs flex items-center justify-between">
                          <span className="text-cyan-700 dark:text-cyan-300 font-medium">Filter Results</span>
                          <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400">
                            {matchedCount} / {totalCount} matching
                          </span>
                        </div>
                      )}
                    </div>

                    {Object.keys(treeStats.byMethod).length > 0 && (
                      <div>
                        <div className="font-semibold text-sm mb-1.5 flex items-center justify-between">
                          <span>By Method</span>
                          <span className="text-[10px] text-muted-foreground font-normal">click to filter</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(treeStats.byMethod).map(([method, count]) => {
                            const isSelected = methodFilter === method
                            return (
                              <button
                                key={method}
                                type="button"
                                onClick={() => setMethodFilter(isSelected ? null : method)}
                                className={cn(
                                  'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-all',
                                  methodColor[method] || 'bg-muted',
                                  isSelected ? 'ring-2 ring-current font-bold' : 'hover:opacity-80',
                                )}
                                title={`Filter by ${method}`}
                              >
                                {method} <span className="font-semibold">{count}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div className="pt-2 text-[10px] text-muted-foreground border-t">
                      Tip: drag rows to reorder, drop onto a folder to move inside, or use the + on a folder to add an endpoint there.
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {onRunAll && (
                        <Button size="sm" variant="secondary" className="w-full text-xs" onClick={onRunAll}>
                          Run All Requests
                        </Button>
                      )}
                      {onPreviewApis && (
                        <Button size="sm" variant="outline" className="w-full text-xs gap-1.5" onClick={onPreviewApis}>
                          <Eye className="h-3.5 w-3.5 text-cyan-500" /> API Docs Preview
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Table className="[&_td]:py-2 [&_th]:h-9">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 pl-4"></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-20">Method</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead className="text-right pr-4 w-[210px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                        {tests.length === 0 ? (
                          <div className="space-y-1">
                            <p className="text-sm font-medium">No endpoints yet</p>
                            <p className="text-xs">Click &ldquo;New Endpoint&rdquo; to create your first request.</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted/60 text-muted-foreground mb-1">
                              <Search className="h-4 w-4" />
                            </div>
                            <p className="text-sm font-medium">No endpoints match your filter</p>
                            <p className="text-xs text-muted-foreground">
                              No endpoints matched &ldquo;{search}&rdquo;{methodFilter ? ` with method ${methodFilter}` : ''}.
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs mt-1"
                              onClick={() => {
                                setSearch('')
                                setMethodFilter(null)
                              }}
                            >
                              Clear Search & Filters
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((test) => {
                    const selected = test.id === selectedId
                    const running = runningTestId === test.id && runStatus === 'running'
                    const extCount = Object.keys(test.extractors || {}).filter(Boolean).length
                    const assertCount = (test.assertions || []).length
                    return (
                      <TableRow
                        key={test.id}
                        onClick={() => onSelect(test.id)}
                        onDoubleClick={() => onEdit(test.id)}
                        className={`cursor-pointer ${selected ? 'bg-primary/5 hover:bg-primary/10' : ''}`}
                      >
                        <TableCell className="pl-4">
                          {running ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                          ) : (
                            <span
                              className={`block h-3.5 w-3.5 rounded-full border-2 transition-colors ${
                                selected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                              }`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>{test.name}</span>
                            {test.target_type === 'web' && (
                              <Badge
                                variant="outline"
                                className="gap-1 border-cyan-500/30 px-1.5 py-0 text-[9px] text-cyan-600 dark:text-cyan-400"
                              >
                                <Globe2 className="h-3 w-3" /> web
                              </Badge>
                            )}
                            {extCount > 0 && (
                              <span
                                className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-600 dark:text-emerald-400"
                                title={`${extCount} response extractor(s)`}
                              >
                                <DatabaseZap className="h-2.5 w-2.5" /> {extCount}
                              </span>
                            )}
                            {assertCount > 0 && (
                              <span
                                className="inline-flex items-center gap-0.5 rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] text-cyan-600 dark:text-cyan-400"
                                title={`${assertCount} assertion(s)`}
                              >
                                <ShieldCheck className="h-2.5 w-2.5" /> {assertCount}
                              </span>
                            )}
                            {running && (
                              <Badge className="text-[9px] px-1.5 py-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 animate-pulse">
                                running
                              </Badge>
                            )}
                            {test.run_config && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 border-amber-500/40 text-amber-600 dark:text-amber-400"
                              >
                                override
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`font-mono text-xs ${
                              methodColor[test.method] || 'bg-secondary text-secondary-foreground'
                            }`}
                          >
                            {test.method}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[260px]">
                          {test.url}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 border-cyan-500/30 text-cyan-700 hover:bg-cyan-500/10 dark:text-cyan-300"
                              onClick={() => onSendRow(test.id)}
                              disabled={sendingTestId === test.id}
                            >
                              {sendingTestId === test.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Send className="h-3.5 w-3.5" />
                              )}
                              {sendingTestId === test.id ? 'Sending' : 'Send'}
                            </Button>
                            <Button
                              size="sm"
                              className="gap-1 bg-emerald-600 hover:bg-emerald-600/90 text-white"
                              onClick={() => onRunRow(test.id)}
                              disabled={runStatus === 'running'}
                            >
                              {running ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                              {running ? 'Running' : 'Run'}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title="Quick edit params & body"
                              aria-label="Quick edit params & body"
                              onClick={() => onQuickEdit(test.id)}
                            >
                              <SlidersHorizontal className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title="Edit"
                              onClick={() => onEdit(test.id)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title="Duplicate"
                              onClick={() => onDuplicate(test.id)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-red-500 hover:text-red-600"
                              title="Delete"
                              onClick={() => onDelete(test.id, test.name)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </div>
      </div>
    </Card>
  )
}
