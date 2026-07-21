import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Command {
  id: string
  label: string
  hint?: string
  keywords?: string
  icon?: React.ComponentType<{ className?: string }>
  run: () => void
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: Command[]
}

export function CommandPalette({ open, onOpenChange, commands }: Props) {
  const [query, setQuery] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setIdx(0)
      const t = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = commands.filter(
    (c) => !q || c.label.toLowerCase().includes(q) || (c.keywords || '').toLowerCase().includes(q),
  )
  const activeIdx = Math.min(idx, Math.max(0, filtered.length - 1))

  const run = (cmd?: Command) => {
    if (!cmd) return
    onOpenChange(false)
    cmd.run()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIdx(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); run(filtered[activeIdx]) }
            }}
            placeholder="Type a command…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</kbd>
        </div>
        <div className="max-h-[340px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">No matching commands</div>
          ) : (
            filtered.map((c, i) => {
              const Icon = c.icon
              return (
                <button
                  key={c.id}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => run(c)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    i === activeIdx ? 'bg-muted' : 'hover:bg-muted/50',
                  )}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="flex-1 truncate text-foreground">{c.label}</span>
                  {c.hint && <span className="shrink-0 text-[10px] text-muted-foreground">{c.hint}</span>}
                </button>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
