import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { JsonCodeEditor } from './JsonCodeEditor'

interface KVEditorProps {
  data: Record<string, any>
  onChange: (data: Record<string, any>) => void
  label?: string
  allowJson?: boolean
  maskSensitive?: boolean
}

interface KVRow {
  id: string
  key: string
  value: string
}

const SENSITIVE_KEY = /(token|secret|password|passwd|api[_-]?key|authorization|cookie|credential)/i

let _rowSeq = 0
function nextRowId(): string {
  _rowSeq += 1
  return `kv-row-${_rowSeq}`
}

function toStringRecord(data: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data || {})) {
    if (k === '') continue
    out[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }
  return out
}

function recordToRows(data: Record<string, any>): KVRow[] {
  return Object.entries(data || {}).map(([k, v]) => ({
    id: nextRowId(),
    key: k,
    value: typeof v === 'string' ? v : JSON.stringify(v),
  }))
}

function rowsToRecord(rows: KVRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    const k = row.key
    if (!k) continue
    out[k] = row.value
  }
  return out
}

function canonicalize(data: Record<string, any>): string {
  return JSON.stringify(toStringRecord(data))
}

function parseJsonVars(raw: string): Record<string, string> {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  const obj = JSON.parse(trimmed)
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new Error('Expected a JSON object like {"key": "value"}')
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (!k) continue
    out[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }
  return out
}

export function KVEditor({ data, onChange, label, allowJson = true, maskSensitive = false }: KVEditorProps) {
  const [mode, setMode] = useState<'table' | 'json'>('table')
  const [rows, setRows] = useState<KVRow[]>(() => recordToRows(data))
  const [jsonText, setJsonText] = useState(() => JSON.stringify(toStringRecord(data), null, 2))
  const [jsonError, setJsonError] = useState('')
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set())
  const lastEmittedRef = useRef<string>(canonicalize(data))

  // Sync from outer `data` only when it changed externally (e.g. switching environments,
  // loading an endpoint, or importing), so in-progress empty/duplicate rows stay intact.
  useEffect(() => {
    const incoming = canonicalize(data)
    if (incoming !== lastEmittedRef.current) {
      lastEmittedRef.current = incoming
      setRows(recordToRows(data))
      setJsonText(JSON.stringify(toStringRecord(data), null, 2))
      setJsonError('')
    }
  }, [data])

  const emitRows = (nextRows: KVRow[]) => {
    setRows(nextRows)
    const nextRecord = rowsToRecord(nextRows)
    lastEmittedRef.current = canonicalize(nextRecord)
    onChange(nextRecord)
  }

  const updateRow = (id: string, field: 'key' | 'value', nextVal: string) => {
    const nextRows = rows.map((row) => (row.id === id ? { ...row, [field]: nextVal } : row))
    emitRows(nextRows)
  }

  const addEntry = () => {
    setRows((prev) => [...prev, { id: nextRowId(), key: '', value: '' }])
  }

  const removeEntry = (id: string) => {
    const nextRows = rows.filter((row) => row.id !== id)
    emitRows(nextRows)
  }

  const switchToMode = (nextMode: 'table' | 'json') => {
    if (nextMode === mode) return
    if (nextMode === 'json') {
      const currentRecord = rowsToRecord(rows)
      setJsonText(JSON.stringify(currentRecord, null, 2))
      setJsonError('')
      setMode('json')
    } else {
      if (jsonText.trim()) {
        try {
          const parsed = parseJsonVars(jsonText)
          const nextRows = recordToRows(parsed)
          setRows(nextRows)
          lastEmittedRef.current = canonicalize(parsed)
          onChange(parsed)
          setJsonError('')
        } catch (e: any) {
          setJsonError(e?.message || 'Invalid JSON')
          return
        }
      }
      setMode('table')
    }
  }

  const handleJsonChange = (nextText: string) => {
    setJsonText(nextText)
    try {
      const parsed = parseJsonVars(nextText)
      setJsonError('')
      setRows(recordToRows(parsed))
      lastEmittedRef.current = canonicalize(parsed)
      onChange(parsed)
    } catch (e: any) {
      setJsonError(e?.message || 'Invalid JSON')
    }
  }

  const applyJson = () => {
    try {
      const parsed = parseJsonVars(jsonText)
      const nextRows = recordToRows(parsed)
      setRows(nextRows)
      lastEmittedRef.current = canonicalize(parsed)
      onChange(parsed)
      setJsonError('')
      setMode('table')
    } catch (e: any) {
      setJsonError(e?.message || 'Invalid JSON')
    }
  }

  // Count non-empty key occurrences to warn on duplicates without deleting user's draft row.
  const keyCounts = new Map<string, number>()
  for (const row of rows) {
    if (row.key) keyCounts.set(row.key, (keyCounts.get(row.key) || 0) + 1)
  }

  const sensitiveRows = maskSensitive ? rows.filter((r) => r.key && SENSITIVE_KEY.test(r.key)) : []
  const allRevealed = sensitiveRows.length > 0 && sensitiveRows.every((r) => revealed.has(r.id))

  const toggleRevealAll = () => {
    if (allRevealed) {
      setRevealed(new Set())
    } else {
      setRevealed(new Set(sensitiveRows.map((r) => r.id)))
    }
  }

  return (
    <div className="space-y-2">
      {label && <div className="text-sm font-medium">{label}</div>}

      {(allowJson || (maskSensitive && sensitiveRows.length > 0)) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {allowJson ? (
            <div className="inline-grid h-8 grid-cols-2 rounded-lg border border-border bg-muted/35 p-0.5">
              <button
                type="button"
                onClick={() => switchToMode('table')}
                className={`rounded-md px-3 text-xs font-bold transition-all ${
                  mode === 'table'
                    ? 'bg-background shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => switchToMode('json')}
                className={`rounded-md px-3 text-xs font-bold transition-all ${
                  mode === 'json'
                    ? 'bg-background shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                JSON
              </button>
            </div>
          ) : <div />}

          {mode === 'table' && maskSensitive && sensitiveRows.length > 0 && (
            <button
              type="button"
              onClick={toggleRevealAll}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {allRevealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {allRevealed ? 'Hide values' : 'Reveal all'}
            </button>
          )}
        </div>
      )}

      {mode === 'table' ? (
        <div className="space-y-2">
          {rows.map((row) => {
            const valStr = String(row.value)
            const isTemplate = valStr.includes('{{') && valStr.includes('}}')
            const isSensitive = maskSensitive && Boolean(row.key) && SENSITIVE_KEY.test(row.key)
            const isRevealed = revealed.has(row.id)
            const isDuplicate = Boolean(row.key) && (keyCounts.get(row.key) || 0) > 1
            return (
              <div key={row.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={row.key}
                    onChange={(e) => updateRow(row.id, 'key', e.target.value)}
                    placeholder="Key"
                    className={`h-8 flex-1 font-mono text-xs ${isDuplicate ? 'border-amber-500/60 focus-visible:ring-amber-500' : ''}`}
                  />
                  <div className="relative flex-1">
                    <Input
                      type={isSensitive && !isRevealed ? 'password' : 'text'}
                      value={valStr}
                      onChange={(e) => updateRow(row.id, 'value', e.target.value)}
                      placeholder="Value (use {{var}} for dynamic)"
                      className={`h-8 text-xs ${isSensitive ? 'pr-9' : isTemplate ? 'pr-16' : ''} font-mono ${isTemplate ? 'template-var' : ''}`}
                    />
                    {isSensitive ? (
                      <button
                        type="button"
                        aria-label={isRevealed ? `Hide ${row.key}` : `Reveal ${row.key}`}
                        onClick={() =>
                          setRevealed((current) => {
                            const next = new Set(current)
                            if (next.has(row.id)) next.delete(row.id)
                            else next.add(row.id)
                            return next
                          })
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    ) : isTemplate ? (
                      <Badge variant="template" className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px]">
                        template
                      </Badge>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeEntry(row.id)}
                    aria-label={row.key ? `Remove ${row.key}` : 'Remove row'}
                    className="h-8 w-8 p-0 text-red-400 hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {isDuplicate && (
                  <p className="flex items-center gap-1 pl-1 text-[10px] text-amber-500">
                    <AlertCircle className="h-3 w-3" /> Duplicate key "{row.key}" — the last row with this key takes effect.
                  </p>
                )}
              </div>
            )
          })}
          <Button type="button" variant="outline" size="sm" onClick={addEntry} className="h-7 gap-1 text-xs">
            <Plus className="h-3 w-3" /> Add row
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Paste or edit a JSON object, e.g. <code className="font-mono">{'{"access_token": "eyJ...", "api_key": "{{api_key}}"}'}</code>. Valid edits sync automatically.
          </p>
          <JsonCodeEditor
            value={jsonText}
            onChange={handleJsonChange}
            error={jsonError || null}
            fileName="variables.json"
            placeholder={'{\n  "access_token": "your-token",\n  "client_id": "abc123"\n}'}
            minHeight="160px"
            showStatus={true}
            showToolbar={true}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-7 text-xs" onClick={applyJson}>
              Apply JSON
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                const currentRecord = rowsToRecord(rows)
                setJsonText(JSON.stringify(currentRecord, null, 2))
                setJsonError('')
              }}
            >
              Reset from table
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
