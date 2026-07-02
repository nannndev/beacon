import { useState, useEffect, ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Play, Copy, Trash2, Pencil, Search, Loader2, ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { Input } from './ui/input'
import { Endpoint, CollectionItem } from '../types'
import { flattenItems } from '../lib/utils'
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
  onDuplicate: (id: string) => void
  onDelete: (id: string, name: string) => void
  onRunRow: (id: string) => void
  onRunFolder?: (folderId: string) => void
  onRunAll?: () => void
}

export function EndpointTable({
  tests, items, selectedId, runningTestId, runStatus, onSelect, onNew, onNewFolder, onEdit, onDuplicate, onDelete, onRunRow, onRunFolder, onRunAll,
}: Props) {
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  // Auto-expand all folders by default when items load (good UX)
  useEffect(() => {
    if (items && items.length > 0) {
      const allFolderIds = new Set<string>()
      const walk = (nodes: CollectionItem[]) => {
        for (const n of nodes) {
          if (n.type === 'folder') {
            allFolderIds.add(n.id)
            if (n.items) walk(n.items)
          }
        }
      }
      walk(items)
      setExpandedFolders(allFolderIds)
    }
  }, [items])

  const filtered = tests.filter((t) => {
    const matchesSearch =
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.url.toLowerCase().includes(search.toLowerCase())
    const matchesMethod = !methodFilter || t.method === methodFilter
    return matchesSearch && matchesMethod
  })

  // Collect all methods actually used
  const usedMethods = Array.from(new Set(tests.map((t) => t.method))).filter((m) =>
    ALL_METHODS.includes(m)
  )

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const getAllFolderIds = (nodes: CollectionItem[] = []): string[] => {
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

  const expandAll = () => {
    if (!items) return
    setExpandedFolders(new Set(getAllFolderIds(items)))
  }

  const collapseAll = () => {
    setExpandedFolders(new Set())
  }

  // Local stats for the second pane
  const getTreeStats = (nodes: CollectionItem[] = []) => {
    let folders = 0
    let requests = 0
    const byMethod: Record<string, number> = {}
    const walk = (n: CollectionItem[]) => {
      for (const item of n) {
        if (item.type === 'folder') {
          folders++
          if (item.items) walk(item.items)
        } else {
          requests++
          const m = (item as any).method
          if (m) byMethod[m] = (byMethod[m] || 0) + 1
        }
      }
    }
    walk(nodes)
    return { folders, requests, byMethod }
  }

  const treeStats = items && items.length > 0 ? getTreeStats(items) : null

  // Postman-style tree renderer with collapse support
  const renderItems = (nodes: CollectionItem[] = [], depth = 0): ReactNode => {
    if (!nodes.length) return null
    return nodes.map((node) => {
      const isFolder = node.type === 'folder'
      const padding = { paddingLeft: `${depth * 16 + 8}px` }

      if (isFolder) {
        const isExpanded = expandedFolders.has(node.id)
        return (
          <div key={node.id}>
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/30 border-b border-border/50 cursor-pointer hover:bg-muted/40 select-none"
              style={padding}
              onClick={() => toggleFolder(node.id)}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              )}
              <span className="truncate">{node.name}</span>
              <span className="ml-1 text-[10px] text-muted-foreground/70">({(node.items || []).length})</span>

              {onRunFolder && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onRunFolder(node.id)
                  }}
                  className="ml-auto text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 active:scale-95"
                  title="Run all requests in this folder"
                >
                  Run
                </button>
              )}
            </div>
            {isExpanded && renderItems(node.items || [], depth + 1)}
          </div>
        )
      }

      // request
      const req = node as any as Endpoint & { type?: string }
      const isSelected = selectedId === req.id
      const isRunning = runningTestId === req.id && runStatus === 'running'

      return (
        <div
          key={req.id}
          onClick={() => onSelect(req.id)}
          className={`group flex items-center gap-2 border-b border-border/30 px-3 py-2 text-sm cursor-pointer transition-colors ${
            isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
          } ${isRunning ? 'animate-pulse bg-emerald-500/5' : ''}`}
          style={padding}
        >
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${methodColor[req.method] || 'bg-zinc-500/15'}`}>
            {req.method}
          </span>
          <span className="flex-1 truncate font-medium">{req.name}</span>
          <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[180px] hidden md:inline">{req.url}</span>

          <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); onRunRow(req.id) }} title="Run">
              <Play className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); onEdit(req.id) }} title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); onDuplicate(req.id) }} title="Duplicate">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400" onClick={(e) => { e.stopPropagation(); onDelete(req.id, req.name) }} title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-2.5 px-4">
        <CardTitle className="text-sm">
          Endpoints{' '}
          <span className="text-muted-foreground font-normal">
            {items && items.length > 0 && treeStats
              ? `${treeStats.requests} requests in ${treeStats.folders} folders`
              : `${filtered.length}${filtered.length !== tests.length ? `/${tests.length}` : ''}`}
          </span>
        </CardTitle>
        <div className="flex gap-2">
          {items && items.length > 0 && (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={collapseAll}>
                <ChevronRight className="h-3 w-3" /> Collapse All
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={expandAll}>
                <ChevronDown className="h-3 w-3" /> Expand All
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" className="h-7" onClick={() => onNewFolder?.()}>New Folder</Button>
          <Button size="sm" className="h-7" onClick={onNew}>New Endpoint</Button>
        </div>
      </CardHeader>

      {/* Search + filter bar */}
      {(tests.length > 0 || (items && items.length > 0)) && (
        <div className="px-4 pb-2.5 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search endpoints…"
              className="h-8 pl-8 text-xs"
            />
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {usedMethods.map((m) => (
              <button
                key={m}
                onClick={() => setMethodFilter(methodFilter === m ? null : m)}
                className={`h-6 px-2 rounded text-[10px] font-mono font-bold transition-all border ${
                  methodFilter === m
                    ? methodColor[m] + ' border-current ring-1 ring-current/30'
                    : 'border-border text-muted-foreground hover:border-current/50 ' + methodColor[m]
                }`}
              >
                {m}
              </button>
            ))}
            {methodFilter && (
              <button
                onClick={() => setMethodFilter(null)}
                className="h-6 px-2 rounded text-[10px] text-muted-foreground hover:text-foreground border border-border transition-colors"
              >
                ✕ clear
              </button>
            )}
          </div>
        </div>
      )}

      <CardContent className="p-0">
        {items && items.length > 0 && treeStats ? (
          // Split layout: left = tree list, right = stats / features
          // On small screens it becomes stacked rows (responsive)
          <div className="grid grid-cols-1 lg:grid-cols-5">
            {/* Tree list */}
            <div className="lg:col-span-3 border-r border-border/50">
              <div className="max-h-[420px] overflow-auto text-sm divide-y divide-border/50 p-1">
                {renderItems(items)}
              </div>
            </div>

            {/* Stats / additional features pane */}
            <div className="lg:col-span-2 p-4 text-xs space-y-4 bg-muted/20">
              <div>
                <div className="font-semibold text-sm mb-2">List Statistics</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="text-muted-foreground">Folders</div>
                  <div className="font-mono font-medium">{treeStats.folders}</div>
                  <div className="text-muted-foreground">Requests</div>
                  <div className="font-mono font-medium">{treeStats.requests}</div>
                </div>
              </div>

              {Object.keys(treeStats.byMethod).length > 0 && (
                <div>
                  <div className="font-semibold text-sm mb-1.5">By Method</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(treeStats.byMethod).map(([method, count]) => (
                      <span
                        key={method}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono ${methodColor[method] || 'bg-muted'}`}
                      >
                        {method} <span className="font-semibold">{count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 text-[10px] text-muted-foreground border-t">
                Tip: Use Collapse/Expand All or click folders to navigate large collections.
              </div>

              {onRunAll && (
                <div className="pt-2">
                  <Button size="sm" variant="secondary" className="w-full text-xs" onClick={onRunAll}>
                    Run All Requests
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <Table className="[&_td]:py-2 [&_th]:h-9">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 pl-4"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-20">Method</TableHead>
                <TableHead>URL</TableHead>
                <TableHead className="text-right pr-4 w-[200px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                    {tests.length === 0
                      ? 'No endpoints. Click "New Endpoint" to start.'
                      : 'No endpoints match your search.'}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((test) => {
                const selected = test.id === selectedId
                const running = runningTestId === test.id && runStatus === 'running'
                return (
                  <TableRow
                    key={test.id}
                    onClick={() => onSelect(test.id)}
                    className={`cursor-pointer ${selected ? 'bg-primary/5 hover:bg-primary/10' : ''}`}
                  >
                    <TableCell className="pl-4">
                      {running ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                      ) : (
                        <span
                          className={`block h-3.5 w-3.5 rounded-full border-2 transition-colors ${
                            selected
                              ? 'border-primary bg-primary'
                              : 'border-muted-foreground/40'
                          }`}
                        />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {test.name}
                        {running && (
                          <Badge className="text-[9px] px-1.5 py-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 animate-pulse">
                            running
                          </Badge>
                        )}
                        {test.run_config && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/40 text-amber-600 dark:text-amber-400">
                            override
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={`font-mono text-xs ${methodColor[test.method] || 'bg-secondary text-secondary-foreground'}`}>
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
                          className="gap-1 bg-emerald-600 hover:bg-emerald-600/90 text-white"
                          onClick={() => onRunRow(test.id)}
                          disabled={runStatus === 'running'}
                        >
                          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                          {running ? 'Running' : 'Run'}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => onEdit(test.id)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Duplicate" onClick={() => onDuplicate(test.id)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-600" title="Delete" onClick={() => onDelete(test.id, test.name)}>
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
    </Card>
  )
}
