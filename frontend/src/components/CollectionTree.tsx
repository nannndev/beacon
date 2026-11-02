import { useEffect, useRef, useState, ReactNode } from 'react'
import {
  Play, Copy, Trash2, Pencil, Plus, GripVertical, Send, SlidersHorizontal,
  ChevronDown, ChevronRight, Folder, FolderOpen,
  Globe2, DatabaseZap, ShieldCheck,
} from 'lucide-react'
import { Button } from './ui/button'
import { Endpoint, CollectionItem } from '../types'
import { moveNode, appendToRoot, DropPosition } from '../lib/tree'
import { RunStatus } from './LiveMonitor'

const methodColor: Record<string, string> = {
  GET:    'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  POST:   'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  PUT:    'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  DELETE: 'bg-red-500/15 text-red-600 dark:text-red-400',
  PATCH:  'bg-purple-500/15 text-purple-600 dark:text-purple-400',
}

const ROOT_ZONE = '__root__'

interface Props {
  items: CollectionItem[]
  selectedId: string | null
  runningTestId: string | null
  runStatus: RunStatus
  expandedFolders: Set<string>
  onToggleFolder: (id: string) => void
  onSelect: (id: string) => void
  onEdit: (id: string) => void
  onQuickEdit: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string, name: string) => void
  onRunRow: (id: string) => void
  onSendRow: (id: string) => void
  sendingTestId?: string | null
  onRunFolder?: (folderId: string) => void
  onRunScenario?: (folderId: string) => void
  onNewInFolder: (folderId: string) => void
  onRenameFolder: (folderId: string, currentName: string) => void
  onDuplicateFolder: (folderId: string) => void
  onDeleteFolder: (folderId: string, name: string) => void
  /** Persist a reordered/moved tree (whole-tree replace). */
  onReorder: (items: CollectionItem[]) => void
}

interface DropTarget {
  id: string
  pos: DropPosition
}

export function CollectionTree({
  items, selectedId, runningTestId, runStatus, expandedFolders, onToggleFolder,
  onSelect, onEdit, onQuickEdit, onDuplicate, onDelete, onRunRow, onSendRow, sendingTestId, onRunFolder, onRunScenario, onNewInFolder,
  onRenameFolder, onDuplicateFolder, onDeleteFolder, onReorder,
}: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  // WebKit (used by the desktop build) may return an empty DataTransfer value
  // during dragover/drop. Keep the active id synchronously as the source of
  // truth; React state remains only for rendering feedback.
  const draggingIdRef = useRef<string | null>(null)
  const dropTargetRef = useRef<DropTarget | null>(null)
  const pointerDragRef = useRef<{ id: string; x: number; y: number; active: boolean } | null>(null)

  const clearDrag = () => {
    draggingIdRef.current = null
    dropTargetRef.current = null
    setDraggingId(null)
    setDropTarget(null)
  }

  const commitDrag = (target: DropTarget | null) => {
    const dragId = draggingIdRef.current
    if (!dragId || !target || dragId === target.id) {
      clearDrag()
      return
    }
    const next = target.id === ROOT_ZONE
      ? appendToRoot(items, dragId)
      : moveNode(items, dragId, target.id, target.pos)
    clearDrag()
    if (next !== items) onReorder(next)
  }

  const startPointerDrag = (event: React.PointerEvent, id: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    pointerDragRef.current = { id, x: event.clientX, y: event.clientY, active: false }
  }

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const pointer = pointerDragRef.current
      if (!pointer) return
      if (!pointer.active && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 5) return
      if (!pointer.active) {
        pointer.active = true
        draggingIdRef.current = pointer.id
        setDraggingId(pointer.id)
      }
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const row = element?.closest<HTMLElement>('[data-collection-drop-id]')
      if (!row || row.dataset.collectionDropId === pointer.id) return
      const rect = row.getBoundingClientRect()
      const ratio = (event.clientY - rect.top) / rect.height
      const isFolder = row.dataset.collectionFolder === 'true'
      const pos: DropPosition = isFolder
        ? ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'inside'
        : ratio < 0.5 ? 'before' : 'after'
      const target = { id: row.dataset.collectionDropId!, pos }
      dropTargetRef.current = target
      setDropTarget(target)
    }
    const end = () => {
      const pointer = pointerDragRef.current
      pointerDragRef.current = null
      if (pointer?.active) commitDrag(dropTargetRef.current)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [items])

  const indicatorClass = (id: string): string => {
    if (dropTarget?.id !== id) return ''
    if (dropTarget.pos === 'inside') return 'ring-2 ring-inset ring-cyan-500/60'
    if (dropTarget.pos === 'before') return 'shadow-[inset_0_2px_0_0_theme(colors.cyan.500)]'
    return 'shadow-[inset_0_-2px_0_0_theme(colors.cyan.500)]'
  }

  const renderNodes = (nodes: CollectionItem[], depth = 0): ReactNode =>
    nodes.map((node) => {
      const padding = { paddingLeft: `${depth * 16 + 8}px` }
      const isDragging = draggingId === node.id

      if (node.type === 'folder') {
        const isExpanded = expandedFolders.has(node.id)
        return (
          <div key={node.id}>
            <div
              data-collection-drop-id={node.id}
              data-collection-folder="true"
              onPointerDown={(event) => startPointerDrag(event, node.id)}
              onClick={() => onToggleFolder(node.id)}
              style={padding}
              className={`group/folder flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/30 border-b border-border/50 cursor-pointer hover:bg-muted/40 select-none ${indicatorClass(node.id)} ${isDragging ? 'opacity-40' : ''}`}
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/40 opacity-0 group-hover/folder:opacity-100" />
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
              {isExpanded ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
              <span className="truncate">{node.name}</span>
              <span className="ml-1 text-[10px] text-muted-foreground/70">({(node.items || []).length})</span>

              <div className="ml-auto flex items-center gap-1">
                <div className="flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100">
                  <button
                    onClick={(e) => { e.stopPropagation(); onNewInFolder(node.id) }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 active:scale-95 inline-flex items-center gap-0.5"
                    title="New endpoint in this folder"
                  >
                    <Plus className="h-3 w-3" /> Endpoint
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRenameFolder(node.id, node.name) }}
                    className="p-1 rounded hover:bg-muted active:scale-95"
                    title="Rename folder"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDuplicateFolder(node.id) }}
                    className="p-1 rounded hover:bg-muted active:scale-95"
                    title="Duplicate folder"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteFolder(node.id, node.name) }}
                    className="p-1 rounded text-red-400 hover:bg-red-500/10 active:scale-95"
                    title="Delete folder"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {onRunFolder && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRunFolder(node.id) }}
                    className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 active:scale-95"
                    title="Run all requests in this folder"
                  >
                    Run
                  </button>
                )}
                {onRunScenario && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRunScenario(node.id) }}
                    className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-600 hover:bg-cyan-500/20 active:scale-95"
                    title="Run requests in order as a scenario (variables chain between steps)"
                  >
                    Chain
                  </button>
                )}
              </div>
            </div>
            {isExpanded && renderNodes(node.items || [], depth + 1)}
          </div>
        )
      }

      // request
      const req = node as Endpoint & { type: 'request' }
      const isSelected = selectedId === req.id
      const isRunning = runningTestId === req.id && runStatus === 'running'
      const extCount = Object.keys(req.extractors || {}).filter(Boolean).length
      const assertCount = (req.assertions || []).length

      return (
        <div
          key={req.id}
          data-collection-drop-id={req.id}
          data-collection-folder="false"
          onPointerDown={(event) => startPointerDrag(event, req.id)}
          onClick={() => onSelect(req.id)}
          onDoubleClick={(e) => { e.stopPropagation(); onEdit(req.id) }}
          style={padding}
          className={`group flex items-center gap-2 border-b border-border/30 px-3 py-2 text-sm cursor-pointer transition-colors ${
            isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
          } ${isRunning ? 'animate-pulse bg-emerald-500/5' : ''} ${indicatorClass(req.id)} ${isDragging ? 'opacity-40' : ''}`}
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/40 opacity-0 group-hover:opacity-100" />
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${methodColor[req.method] || 'bg-zinc-500/15'}`}>
            {req.method}
          </span>
          {req.target_type === 'web' && (
            <span title="Web page load target" className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-cyan-600 dark:text-cyan-400">
              <Globe2 className="h-3 w-3" /> web
            </span>
          )}
          {extCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1 py-0.5 font-mono text-[9px] text-emerald-600 dark:text-emerald-400"
              title={`${extCount} response extractor(s)`}
            >
              <DatabaseZap className="h-2.5 w-2.5" /> {extCount}
            </span>
          )}
          {assertCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 rounded bg-cyan-500/10 px-1 py-0.5 font-mono text-[9px] text-cyan-600 dark:text-cyan-400"
              title={`${assertCount} assertion(s)`}
            >
              <ShieldCheck className="h-2.5 w-2.5" /> {assertCount}
            </span>
          )}
          <span className="flex-1 truncate font-medium">{req.name}</span>
          <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[180px] lg:max-w-[280px] xl:max-w-[420px] hidden md:inline" title={req.url}>
            {req.url}
          </span>

          <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-cyan-600 dark:text-cyan-400" onClick={(e) => { e.stopPropagation(); onSendRow(req.id) }} title="Send once" disabled={sendingTestId === req.id}>
              <Send className={`h-3.5 w-3.5 ${sendingTestId === req.id ? 'animate-pulse' : ''}`} />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); onRunRow(req.id) }} title="Run">
              <Play className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); onQuickEdit(req.id) }} title="Quick edit params & body">
              <SlidersHorizontal className="h-3.5 w-3.5" />
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

  return (
    <div>
      {renderNodes(items)}

      {/* Drop here to move an item back out to the top level. */}
      {draggingId && (
        <div
          data-collection-drop-id={ROOT_ZONE}
          data-collection-folder="false"
          className={`mx-1 my-1 rounded-md border-2 border-dashed px-3 py-2 text-center text-[11px] text-muted-foreground transition-colors ${
            dropTarget?.id === ROOT_ZONE ? 'border-cyan-500/60 bg-cyan-500/5' : 'border-border/60'
          }`}
        >
          Drop here to move to top level
        </div>
      )}
    </div>
  )
}
