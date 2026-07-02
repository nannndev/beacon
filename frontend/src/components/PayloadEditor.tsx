import { useEffect, useState } from 'react'
import { KVEditor } from './KVEditor'
import { MultipartEditor } from './MultipartEditor'
import { JsonCodeEditor } from './JsonCodeEditor'
import { Button } from './ui/button'

interface Props {
  value: Record<string, any>
  onChange: (v: Record<string, any>) => void
  payloadType?: string
}

type Mode = 'fields' | 'json'

const PLACEHOLDER = `{
  "email": "{{random_email}}",
  "password": "secret",
  "device": { "id": "{{random_uuid}}" }
}`

/**
 * Payload editor with two views:
 *  - Fields: key/value (KVEditor) — quick for flat bodies
 *  - JSON: paste / edit raw JSON — handles nested objects & arrays
 * The two stay in sync; JSON is parsed live and only pushed up when valid.
 */
export function PayloadEditor({ value, onChange, payloadType }: Props) {
  const [mode, setMode] = useState<Mode>('fields')
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Keep the raw JSON text in sync if the outer value changes (e.g. from Fields edits)
  useEffect(() => {
    if (mode === 'json') {
      setJsonText(JSON.stringify(value ?? {}, null, 2))
      setError(null)
    }
  }, [value, mode])

  // multipart/form-data: per-field text or file (Postman-style)
  if (payloadType === 'multipart') {
    return <MultipartEditor value={value} onChange={onChange} />
  }

  const toJson = () => {
    const text = JSON.stringify(value ?? {}, null, 2)
    setJsonText(text)
    setError(null)
    setMode('json')
  }

  const onJsonChange = (text: string) => {
    setJsonText(text)
    if (!text.trim()) {
      setError(null)
      onChange({})
      return
    }
    try {
      const parsed = JSON.parse(text)
      onChange(parsed)
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Invalid JSON')
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-grid h-8 grid-cols-2 rounded-lg border border-border bg-muted/35 p-0.5">
          <button
            type="button"
            onClick={() => setMode('fields')}
            className={`rounded-md px-3 text-xs font-bold transition-all ${mode === 'fields' ? 'bg-background shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Fields
          </button>
          <button
            type="button"
            onClick={toJson}
            className={`rounded-md px-3 text-xs font-bold transition-all ${mode === 'json' ? 'bg-background shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Raw JSON
          </button>
        </div>
        {mode === 'json' && (
          <span className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${error ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
            {error ? 'Invalid JSON' : 'Valid JSON'}
          </span>
        )}
      </div>

      {mode === 'fields' ? (
        <KVEditor data={value || {}} onChange={onChange} allowJson={false} />
      ) : (
        <JsonCodeEditor
          value={jsonText}
          onChange={onJsonChange}
          error={error}
          fileName="request.body.json"
          placeholder={PLACEHOLDER}
          minHeight="220px"
          showStatus={false}
          showToolbar={true}
          onError={setError}
        />
      )}
    </div>
  )
}
