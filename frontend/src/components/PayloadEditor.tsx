import { useEffect, useRef, useState } from 'react'
import { KVEditor } from './KVEditor'
import { MultipartEditor } from './MultipartEditor'
import { JsonCodeEditor } from './JsonCodeEditor'
import { Textarea } from './ui/textarea'

interface Props {
  value: any
  onChange: (v: any) => void
  payloadType?: string
}

type Mode = 'fields' | 'json'

const PLACEHOLDER = `{
  "email": "{{random_email}}",
  "password": "secret",
  "device": { "id": "{{random_uuid}}" }
}`

function canonicalPayload(val: any): string {
  try {
    return JSON.stringify(val ?? {})
  } catch {
    return '{}'
  }
}

/**
 * Payload editor with two views:
 *  - Fields: key/value (KVEditor) — quick for flat bodies
 *  - JSON: paste / edit raw JSON — handles nested objects & arrays
 * The two stay in sync; JSON is parsed live and only pushed up when valid,
 * without reformatting the user's buffer mid-keystroke.
 */
export function PayloadEditor({ value, onChange, payloadType }: Props) {
  const [mode, setMode] = useState<Mode>('fields')
  const [jsonText, setJsonText] = useState(() => JSON.stringify(value ?? {}, null, 2))
  const [error, setError] = useState<string | null>(null)
  const lastEmittedRef = useRef<string>(canonicalPayload(value))

  // Keep the raw JSON text in sync only when the outer value changes externally
  // (e.g. from Fields edits, cURL import, or loading another endpoint), not on
  // every keystroke inside Raw JSON mode.
  useEffect(() => {
    const incoming = canonicalPayload(value)
    if (incoming !== lastEmittedRef.current) {
      lastEmittedRef.current = incoming
      setJsonText(JSON.stringify(value ?? {}, null, 2))
      setError(null)
    }
  }, [value])

  // multipart/form-data: per-field text or file (Postman-style)
  if (payloadType === 'multipart') {
    return <MultipartEditor value={value} onChange={onChange} />
  }

  // raw: free-form body (text / XML / GraphQL). Stored as a plain string; the
  // Content-Type comes from the Headers editor. Supports {{variables}}.
  if (payloadType === 'raw') {
    const text =
      typeof value === 'string'
        ? value
        : value && Object.keys(value).length
        ? JSON.stringify(value, null, 2)
        : ''
    return (
      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground">
          Sent verbatim. Set <code className="font-mono">Content-Type</code> in Headers (e.g.{' '}
          <code className="font-mono">application/xml</code>, <code className="font-mono">text/plain</code>,
          <code className="font-mono"> application/graphql</code>). Supports{' '}
          <code className="font-mono">{'{{variables}}'}</code>.
        </p>
        <Textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder={'<note>\n  <to>{{name}}</to>\n</note>'}
          className="min-h-[220px] font-mono text-xs"
        />
      </div>
    )
  }

  const switchToFields = () => {
    if (mode === 'fields') return
    if (error) return
    setMode('fields')
  }

  const toJson = () => {
    const text = JSON.stringify(value ?? {}, null, 2)
    setJsonText(text)
    lastEmittedRef.current = canonicalPayload(value)
    setError(null)
    setMode('json')
  }

  const onJsonChange = (text: string) => {
    setJsonText(text)
    if (!text.trim()) {
      setError(null)
      lastEmittedRef.current = canonicalPayload({})
      onChange({})
      return
    }
    try {
      const parsed = JSON.parse(text)
      lastEmittedRef.current = canonicalPayload(parsed)
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
            onClick={switchToFields}
            title={error ? 'Fix invalid JSON before switching to Fields' : undefined}
            className={`rounded-md px-3 text-xs font-bold transition-all ${
              mode === 'fields'
                ? 'bg-background shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Fields
          </button>
          <button
            type="button"
            onClick={toJson}
            className={`rounded-md px-3 text-xs font-bold transition-all ${
              mode === 'json'
                ? 'bg-background shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Raw JSON
          </button>
        </div>
        {mode === 'json' && (
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${
              error
                ? 'bg-red-500/10 text-red-500'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {error ? 'Invalid JSON' : 'Valid JSON'}
          </span>
        )}
      </div>

      {mode === 'fields' ? (
        <KVEditor
          data={value || {}}
          onChange={(next) => {
            lastEmittedRef.current = canonicalPayload(next)
            onChange(next)
          }}
          allowJson={false}
        />
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
