import { LayoutList, Plus, X } from 'lucide-react'

import type { EditorTab } from '../lib/editorTabs'

const METHOD_TEXT: Record<string, string> = {
  GET: 'text-emerald-600 dark:text-emerald-400',
  POST: 'text-cyan-600 dark:text-cyan-400',
  PUT: 'text-amber-600 dark:text-amber-400',
  PATCH: 'text-violet-600 dark:text-violet-400',
  DELETE: 'text-red-600 dark:text-red-400',
}

export interface EditorTabLabel {
  name: string
  method?: string
}

interface Props {
  tabs: EditorTab[]
  activeKey: string | null
  labels: Record<string, EditorTabLabel>
  dirty: Record<string, boolean>
  onActivate: (key: string | null) => void
  onClose: (key: string) => void
  onNew: () => void
}

/** Workspace + one tab per open request, so several endpoints can be edited
 *  side by side without losing drafts. */
export function EditorTabBar({ tabs, activeKey, labels, dirty, onActivate, onClose, onNew }: Props) {
  const base = 'group flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors'
  const idle = 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
  const current = 'border-border bg-background text-foreground shadow-sm'

  return (
    <div role="tablist" aria-label="Open requests" className="flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-2 py-1.5">
      <button
        type="button"
        role="tab"
        aria-selected={activeKey === null}
        onClick={() => onActivate(null)}
        className={`${base} ${activeKey === null ? current : idle} font-medium`}
      >
        <LayoutList className="h-3.5 w-3.5" /> Workspace
      </button>
      <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
      {tabs.map((tab) => {
        const label = labels[tab.key] || { name: 'New endpoint' }
        const method = (label.method || '').toUpperCase()
        const selected = tab.key === activeKey
        return (
          <div
            key={tab.key}
            role="tab"
            tabIndex={0}
            aria-selected={selected}
            title={label.name}
            onClick={() => onActivate(tab.key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(tab.key) } }}
            // Middle-click closes, as in browsers and editors.
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(tab.key) } }}
            className={`${base} ${selected ? current : idle} max-w-[220px] cursor-pointer`}
          >
            {method && <span className={`font-mono text-[10px] font-bold ${METHOD_TEXT[method] || ''}`}>{method}</span>}
            <span className="truncate">{label.name}</span>
            {dirty[tab.key] && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-label="Unsaved changes" />}
            <button
              type="button"
              aria-label={`Close ${label.name}`}
              onClick={(e) => { e.stopPropagation(); onClose(tab.key) }}
              className="-mr-1 rounded p-0.5 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={onNew}
        aria-label="New endpoint tab"
        title="New endpoint (⌘/Ctrl+N)"
        className="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
