import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { JsonCodeEditor } from './JsonCodeEditor'

interface KVEditorProps {
  data: Record<string, any>
  onChange: (data: Record<string, any>) => void
  label?: string
  allowJson?: boolean
}

function toStringRecord(data: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data || {})) {
    if (k === '') continue
    out[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }
  return out
}

function parseJsonVars(raw: string): Record<string, string> {
  const obj = JSON.parse(raw)
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

export function KVEditor({ data, onChange, label, allowJson = true }: KVEditorProps) {
  const [mode, setMode] = useState<'table' | 'json'>('table')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')

  const entries = Object.entries(data || {})

  useEffect(() => {
    if (mode === 'json') {
      setJsonText(JSON.stringify(toStringRecord(data), null, 2))
      setJsonError('')
    }
  }, [data, mode])

  const updateEntry = (index: number, key: string, value: any) => {
    const newEntries = [...entries]
    newEntries[index] = [key, value]
    onChange(Object.fromEntries(newEntries))
  }

  const addEntry = () => {
    onChange({ ...data, '': '' })
  }

  const removeEntry = (index: number) => {
    const newEntries = entries.filter((_, i) => i !== index)
    onChange(Object.fromEntries(newEntries))
  }

  const applyJson = () => {
    try {
      const parsed = parseJsonVars(jsonText)
      onChange(parsed)
      setJsonError('')
      setMode('table')
    } catch (e: any) {
      setJsonError(e?.message || 'Invalid JSON')
    }
  }

  return (
    <div className="space-y-2">
      {label && <div className="text-sm font-medium">{label}</div>}

      {allowJson && (
        <div className="inline-grid h-8 grid-cols-2 rounded-lg border border-border bg-muted/35 p-0.5">
          <button
            type="button"
            onClick={() => setMode('table')}
            className={`rounded-md px-3 text-xs font-bold transition-all ${mode === 'table' ? 'bg-background shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Table
          </button>
          <button
            type="button"
            onClick={() => setMode('json')}
            className={`rounded-md px-3 text-xs font-bold transition-all ${mode === 'json' ? 'bg-background shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'}`}
          >
            JSON
          </button>
        </div>
      )}

      {mode === 'table' ? (
        <div className="space-y-2">
          {entries.map(([key, value], index) => {
            const valStr = String(value)
            const isTemplate = valStr.includes('{{') && valStr.includes('}}')
            return (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={key}
                  onChange={(e) => updateEntry(index, e.target.value, value)}
                  placeholder="Key"
                  className="h-8 flex-1"
                />
                <div className="relative flex-1">
                  <Input
                    value={valStr}
                    onChange={(e) => updateEntry(index, key, e.target.value)}
                    placeholder="Value (use {{var}} for dynamic)"
                    className={`h-8 pr-16 font-mono ${isTemplate ? 'template-var' : ''}`}
                  />
                  {isTemplate && (
                    <Badge variant="template" className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px]">
                      template
                    </Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeEntry(index)}
                  className="h-8 w-8 p-0 text-red-400 hover:text-red-500"
                >
                  x
                </Button>
              </div>
            )
          })}
          <Button variant="outline" size="sm" onClick={addEntry} className="h-7 text-xs">
            + Add row
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Paste a JSON object, for example {'{"access_token": "eyJ...", "api_key": "{{api_key}}"}'}.
          </p>
          <JsonCodeEditor
            value={jsonText}
            onChange={(v) => { setJsonText(v); setJsonError('') }}
            error={jsonError || null}
            fileName="variables.json"
            placeholder={'{\n  "access_token": "your-token",\n  "client_id": "abc123"\n}'}
            minHeight="160px"
            showStatus={false}
            showToolbar={false}
          />
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={applyJson}>Apply JSON</Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setJsonText(JSON.stringify(toStringRecord(data), null, 2))}
            >
              Reset from table
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
