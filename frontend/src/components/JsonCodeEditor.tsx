import { useMemo, useRef } from 'react'
import { AlertTriangle, CheckCircle2, Copy, Minimize2, Wand2 } from 'lucide-react'
import { Button } from './ui/button'
import { toast } from './ui/toast'

interface JsonCodeEditorProps {
  value: string
  onChange?: (value: string) => void
  error?: string | null
  fileName?: string
  placeholder?: string
  minHeight?: string
  showStatus?: boolean
  showToolbar?: boolean
  showHeader?: boolean
  readOnly?: boolean
  className?: string
  onError?: (message: string | null) => void
}

type Token = { text: string; type: 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'space' | 'text' }

function tokenize(value: string): Token[] {
  if (!value) return []
  const tokens: Token[] = []
  // Improved regex for JSON tokens (strings handle basic escapes)
  const re = /("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)|([{}\[\],:])|(\s+)|([^"'\s{}\[\],:]+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(value)) !== null) {
    const t = match[0]
    if (match[1]) tokens.push({ text: t, type: 'string' })
    else if (match[2]) tokens.push({ text: t, type: 'number' })
    else if (match[3]) tokens.push({ text: t, type: t === 'null' ? 'null' : 'boolean' })
    else if (match[4]) tokens.push({ text: t, type: 'punct' })
    else if (match[5]) tokens.push({ text: t, type: 'space' })
    else tokens.push({ text: t, type: 'text' })
  }
  return tokens
}

function isKeyToken(tokens: Token[], index: number): boolean {
  // A string token is a key if followed (skipping whitespace) by a ':'
  for (let j = index + 1; j < tokens.length; j++) {
    const tk = tokens[j]
    if (tk.type === 'space') continue
    return tk.text === ':'
  }
  return false
}

function highlightJson(value: string): React.ReactNode {
  const tokens = tokenize(value)
  return tokens.map((tok, i) => {
    if (tok.type === 'space') return tok.text

    let className = 'text-slate-200'
    if (tok.type === 'string') {
      className = isKeyToken(tokens, i) ? 'text-sky-400' : 'text-emerald-400'
    } else if (tok.type === 'number') {
      className = 'text-amber-400'
    } else if (tok.type === 'boolean') {
      className = 'text-violet-400'
    } else if (tok.type === 'null') {
      className = 'text-zinc-400'
    } else if (tok.type === 'punct') {
      className = 'text-slate-400'
    } else if (tok.type === 'text') {
      className = 'text-red-400/80' // likely invalid token, e.g. unquoted
    }
    return (
      <span key={i} className={className}>
        {tok.text}
      </span>
    )
  })
}

export function JsonCodeEditor({
  value,
  onChange,
  error,
  fileName = 'payload.json',
  placeholder = '{\n  "key": "value"\n}',
  minHeight = '220px',
  showStatus = true,
  showToolbar = true,
  showHeader = true,
  readOnly = false,
  className,
  onError,
}: JsonCodeEditorProps) {
  const lines = useMemo(() => (value || '').split('\n'), [value])
  const lineNumbers = useMemo(() => {
    const count = Math.max(1, lines.length)
    return Array.from({ length: count }, (_, i) => i + 1).join('\n')
  }, [lines.length])

  const linesRef = useRef<HTMLPreElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  const formatJson = () => {
    try {
      const parsed = JSON.parse(value || '{}')
      const formatted = JSON.stringify(parsed, null, 2)
      onChange?.(formatted)
      onError?.(null)
    } catch (e: any) {
      onError?.(e?.message || 'Invalid JSON')
    }
  }

  const minifyJson = () => {
    try {
      const parsed = JSON.parse(value || '{}')
      onChange?.(JSON.stringify(parsed))
      onError?.(null)
    } catch (e: any) {
      onError?.(e?.message || 'Invalid JSON')
    }
  }

  const copyJson = () => {
    navigator.clipboard?.writeText(value || '').then(() => toast.success('JSON copied')).catch(() => {})
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e.target.value)
  }

  const syncLines = (top: number) => {
    if (linesRef.current) {
      linesRef.current.scrollTop = top
    }
  }

  const handleScroll = (e?: React.UIEvent) => {
    const target = (e?.target as HTMLElement) || textareaRef.current || scrollerRef.current
    if (target) syncLines(target.scrollTop)
  }

  const computedError = error ?? null

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border bg-[#07090d] shadow-inner ${computedError ? 'border-red-500/70' : 'border-border'} ${className || ''}`}>
      {showHeader && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/25 px-3 py-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
            <span className="ml-1 font-mono text-[11px] font-bold text-muted-foreground">{fileName}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">
              {lines.length} lines / {(value || '').length} chars
            </span>
            {showStatus && (
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${computedError ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
                {computedError ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                {computedError ? 'Invalid' : 'Valid'}
              </span>
            )}
          </div>
        </div>
      )}

      {showToolbar && (
        <div className="flex items-center gap-1 border-b border-border bg-[#090c12] px-3 py-1.5 shrink-0">
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={formatJson} disabled={readOnly}>
            <Wand2 className="h-3 w-3" /> Format
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={minifyJson} disabled={readOnly}>
            <Minimize2 className="h-3 w-3" /> Minify
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={copyJson}>
            <Copy className="h-3 w-3" /> Copy
          </Button>
        </div>
      )}

      <div 
        className="relative flex-1 min-h-0 overflow-hidden bg-[#07090d] h-full" 
        style={minHeight && minHeight !== '0' ? { minHeight } : { height: '100%' }}
      >
        {/* Line numbers (synced via scroll handler) */}
        <pre
          ref={linesRef}
          className="pointer-events-none absolute inset-y-0 left-0 z-30 w-11 select-none overflow-hidden border-r border-border/70 bg-[#07090d] px-2 py-3 text-right font-mono text-[10px] leading-[1.45] text-muted-foreground/50"
          aria-hidden="true"
        >
          {lineNumbers}
        </pre>

        {/* Scrollable code area - this is what needs to scroll */}
        <div
          ref={scrollerRef}
          className="absolute inset-0 pl-11 overflow-auto"
          onScroll={handleScroll}
          onClick={() => !readOnly && textareaRef.current?.focus()}
        >
          {/* Highlighted layer */}
          <pre
            className="pointer-events-none m-0 px-3 py-3 pb-6 pr-3 font-mono text-xs leading-[1.45] text-slate-100 whitespace-pre-wrap break-all"
            aria-hidden="true"
          >
            {value ? highlightJson(value) : <span className="text-muted-foreground/40">{placeholder}</span>}
          </pre>

          {/* Editing layer */}
          {!readOnly && (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onScroll={handleScroll}
              spellCheck={false}
              className="absolute inset-0 left-11 w-[calc(100%-2.75rem)] resize-none border-0 bg-transparent px-3 py-3 pr-3 font-mono text-xs leading-[1.45] text-transparent caret-white outline-none placeholder:text-muted-foreground/40 focus:ring-0"
              style={{ WebkitTextFillColor: 'transparent' }}
            />
          )}
        </div>
      </div>

      {computedError && <div className="border-t border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-[11px] text-red-300 shrink-0">{computedError}</div>}
    </div>
  )
}
