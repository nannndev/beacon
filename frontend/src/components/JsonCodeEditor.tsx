import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Copy, Minimize2, Wand2, WrapText } from 'lucide-react'
import { Button } from './ui/button'
import { toast } from './ui/toast'

interface JsonCodeEditorProps {
  value: string
  onChange?: (value: string) => void
  error?: string | null
  fileName?: string
  placeholder?: string
  minHeight?: string
  maxHeight?: string
  showStatus?: boolean
  showToolbar?: boolean
  showHeader?: boolean
  readOnly?: boolean
  wordWrap?: boolean
  className?: string
  onError?: (message: string | null) => void
}

type Token = {
  text: string
  type: 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'template' | 'space' | 'text'
}

function tokenize(value: string): Token[] {
  if (!value) return []
  const tokens: Token[] = []
  const re = /(\{\{[^{}\n]+\}\})|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)|([{}\[\],:])|(\s+)|([^"'\s{}\[\],:]+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(value)) !== null) {
    const t = match[0]
    if (match[1]) tokens.push({ text: t, type: 'template' })
    else if (match[2]) tokens.push({ text: t, type: 'string' })
    else if (match[3]) tokens.push({ text: t, type: 'number' })
    else if (match[4]) tokens.push({ text: t, type: t === 'null' ? 'null' : 'boolean' })
    else if (match[5]) tokens.push({ text: t, type: 'punct' })
    else if (match[6]) tokens.push({ text: t, type: 'space' })
    else tokens.push({ text: t, type: 'text' })
  }
  return tokens
}

function isKeyToken(tokens: Token[], index: number): boolean {
  for (let j = index + 1; j < tokens.length; j++) {
    const tk = tokens[j]
    if (tk.type === 'space') continue
    return tk.text === ':'
  }
  return false
}

function renderStringWithTemplates(text: string, baseClass: string): React.ReactNode {
  if (!text.includes('{{')) return text
  const parts = text.split(/(\{\{[^{}\n]+\}\})/g)
  return parts.map((part, idx) =>
    part.startsWith('{{') && part.endsWith('}}') ? (
      <span key={idx} className="text-cyan-300">
        {part}
      </span>
    ) : (
      <span key={idx} className={baseClass}>
        {part}
      </span>
    ),
  )
}

function highlightJson(value: string, isLikelyJson: boolean): React.ReactNode {
  if (!isLikelyJson) {
    return <span className="text-slate-200">{renderStringWithTemplates(value, 'text-slate-200')}</span>
  }
  const tokens = tokenize(value)
  return tokens.map((tok, i) => {
    if (tok.type === 'space') return tok.text

    if (tok.type === 'template') {
      return (
        <span key={i} className="text-cyan-300">
          {tok.text}
        </span>
      )
    }

    if (tok.type === 'string') {
      const key = isKeyToken(tokens, i)
      const cls = key ? 'text-sky-400' : 'text-emerald-400'
      return (
        <span key={i} className={cls}>
          {renderStringWithTemplates(tok.text, cls)}
        </span>
      )
    }

    let className = 'text-slate-200'
    if (tok.type === 'number') {
      className = 'text-amber-400'
    } else if (tok.type === 'boolean') {
      className = 'text-violet-400'
    } else if (tok.type === 'null') {
      className = 'text-zinc-400'
    } else if (tok.type === 'punct') {
      className = 'text-slate-400'
    } else if (tok.type === 'text') {
      className = 'text-rose-400/90'
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
  maxHeight,
  showStatus = true,
  showToolbar = true,
  showHeader = true,
  readOnly = false,
  wordWrap: initialWordWrap = true,
  className,
  onError,
}: JsonCodeEditorProps) {
  const [wrap, setWrap] = useState(initialWordWrap)
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const safeValue = value ?? ''
  const lines = useMemo(() => safeValue.split('\n'), [safeValue])
  const lineNumbers = useMemo(() => {
    const count = Math.max(1, lines.length)
    return Array.from({ length: count }, (_, i) => i + 1).join('\n')
  }, [lines.length])

  const isLikelyJson = useMemo(() => {
    if (!readOnly) return true
    const trimmed = safeValue.trim()
    return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')
  }, [readOnly, safeValue])

  const validationError = useMemo(() => {
    if (error !== undefined) return error
    if (!safeValue.trim() || !isLikelyJson) return null
    try {
      JSON.parse(safeValue)
      return null
    } catch (e: any) {
      return e?.message || 'Invalid JSON'
    }
  }, [error, safeValue, isLikelyJson])

  const formatJson = () => {
    try {
      const parsed = JSON.parse(safeValue || '{}')
      const formatted = JSON.stringify(parsed, null, 2)
      onChange?.(formatted)
      onError?.(null)
    } catch (e: any) {
      onError?.(e?.message || 'Invalid JSON')
    }
  }

  const minifyJson = () => {
    try {
      const parsed = JSON.parse(safeValue || '{}')
      onChange?.(JSON.stringify(parsed))
      onError?.(null)
    } catch (e: any) {
      onError?.(e?.message || 'Invalid JSON')
    }
  }

  const copyJson = () => {
    navigator.clipboard
      ?.writeText(safeValue)
      .then(() => {
        setCopied(true)
        toast.success('Copied to clipboard')
        window.setTimeout(() => setCopied(false), 1400)
      })
      .catch(() => {})
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e.target.value)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? 0
      const next = safeValue.slice(0, start) + '  ' + safeValue.slice(end)
      onChange?.(next)
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + 2
          textareaRef.current.selectionEnd = start + 2
        }
      })
    }
  }

  const computedError = error !== undefined ? error : validationError
  const wrapClass = wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border bg-[#07090d] text-slate-100 shadow-inner ${
        computedError ? 'border-red-500/70' : 'border-border'
      } ${className || ''}`}
    >
      {showHeader && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-[#0b0f17] px-3 py-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
            <span className="ml-1 font-mono text-[11px] font-bold text-slate-300">{fileName}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-slate-400">
              {lines.length} {lines.length === 1 ? 'line' : 'lines'} · {safeValue.length.toLocaleString()} chars
            </span>
            {showStatus && isLikelyJson && (
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  computedError
                    ? 'bg-red-500/15 text-red-400'
                    : 'bg-emerald-500/15 text-emerald-400'
                }`}
              >
                {computedError ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                {computedError ? 'Invalid' : 'Valid'}
              </span>
            )}
          </div>
        </div>
      )}

      {showToolbar && (
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-800/80 bg-[#090c12] px-2.5 py-1.5 shrink-0">
          {!readOnly && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
                onClick={formatJson}
              >
                <Wand2 className="h-3 w-3 text-cyan-400" /> Format
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
                onClick={minifyJson}
              >
                <Minimize2 className="h-3 w-3" /> Minify
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={() => setWrap((w) => !w)}
            title="Toggle line wrapping"
          >
            <WrapText className="h-3 w-3" /> {wrap ? 'Wrap: On' : 'Wrap: Off'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1.5 px-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={copyJson}
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}

      <div
        className="relative flex-1 min-h-0 overflow-auto bg-[#07090d]"
        style={{
          ...(minHeight && minHeight !== '0' ? { minHeight } : { height: '100%' }),
          ...(maxHeight ? { maxHeight } : {}),
        }}
        onClick={(e) => {
          if (!readOnly && e.target === e.currentTarget) {
            textareaRef.current?.focus()
          }
        }}
      >
        <div className="grid min-h-full min-w-full grid-cols-[2.75rem_minmax(0,1fr)]">
          {/* Line numbers column */}
          <pre
            className="pointer-events-none sticky left-0 z-20 m-0 select-none border-r border-slate-800/80 bg-[#07090d] px-2 py-3 text-right font-mono text-xs leading-[1.5] text-slate-500"
            aria-hidden="true"
          >
            {lineNumbers}
          </pre>

          {/* Code + textarea overlay in the exact same grid cell */}
          <div className="relative grid min-h-full min-w-0">
            <pre
              className={`pointer-events-none col-start-1 row-start-1 m-0 min-h-full w-full px-3 py-3 pb-6 font-mono text-xs leading-[1.5] text-slate-100 [tab-size:2] ${wrapClass}`}
              aria-hidden="true"
            >
              {safeValue ? (
                highlightJson(safeValue, isLikelyJson)
              ) : (
                <span className="text-slate-500">{placeholder}</span>
              )}
              {safeValue.endsWith('\n') ? ' ' : null}
            </pre>

            {!readOnly && (
              <textarea
                ref={textareaRef}
                value={safeValue}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                className={`col-start-1 row-start-1 m-0 h-full min-h-full w-full resize-none overflow-hidden border-0 bg-transparent px-3 py-3 pb-6 font-mono text-xs leading-[1.5] text-transparent caret-cyan-400 outline-none [tab-size:2] focus:ring-0 ${wrapClass}`}
                style={{ WebkitTextFillColor: 'transparent' }}
              />
            )}
          </div>
        </div>
      </div>

      {computedError && (
        <div className="border-t border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-[11px] text-red-300 shrink-0">
          {computedError}
        </div>
      )}
    </div>
  )
}
