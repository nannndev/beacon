import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Textarea } from './ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

interface KVEditorProps {
  data: Record<string, any>
  onChange: (data: Record<string, any>) => void
  label?: string
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

export function KVEditor({ data, onChange, label }: KVEditorProps) {
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

      <Tabs value={mode} onValueChange={(v) => setMode(v as 'table' | 'json')}>
        <TabsList className="h-7">
          <TabsTrigger value="table" className="text-xs h-6 px-2.5">Table</TabsTrigger>
          <TabsTrigger value="json" className="text-xs h-6 px-2.5">Paste JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="mt-2 space-y-2">
          {entries.map(([key, value], index) => {
            const valStr = String(value)
            const isTemplate = valStr.includes('{{') && valStr.includes('}}')
            return (
              <div key={index} className="flex gap-2 items-center">
                <Input
                  value={key}
                  onChange={(e) => updateEntry(index, e.target.value, value)}
                  placeholder="Key"
                  className="flex-1 h-8"
                />
                <div className="flex-1 relative">
                  <Input
                    value={valStr}
                    onChange={(e) => updateEntry(index, key, e.target.value)}
                    placeholder="Value (use {{var}} for dynamic)"
                    className={`font-mono pr-16 h-8 ${isTemplate ? 'template-var' : ''}`}
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
                  className="text-red-400 hover:text-red-500 h-8 w-8 p-0"
                >
                  ×
                </Button>
              </div>
            )
          })}
          <Button variant="outline" size="sm" onClick={addEntry} className="h-7 text-xs">
            + Add row
          </Button>
        </TabsContent>

        <TabsContent value="json" className="mt-2 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Paste a JSON object — e.g. {'{"access_token": "eyJ...", "api_key": "{{api_key}}"}'}
          </p>
          <Textarea
            value={jsonText}
            onChange={(e) => { setJsonText(e.target.value); setJsonError('') }}
            placeholder={'{\n  "access_token": "your-token",\n  "client_id": "abc123"\n}'}
            className="font-mono text-xs min-h-[140px]"
            spellCheck={false}
          />
          {jsonError && <p className="text-xs text-red-500">{jsonError}</p>}
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
        </TabsContent>
      </Tabs>
    </div>
  )
}