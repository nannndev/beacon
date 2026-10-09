import { useRef, useState } from 'react'
import { Database, Loader2, X } from 'lucide-react'

import { api, type DatasetSpec, type DatasetSummary } from '../lib/api'
import { toast } from './ui/toast'

export interface TestData {
  name: string
  spec: DatasetSpec
  summary: DatasetSummary
}

interface Props {
  value: TestData | null
  onChange: (value: TestData | null) => void
  disabled?: boolean
}

const MAX_FILE_BYTES = 10 * 1024 * 1024

// File.text() is missing in some older WebViews; FileReader works everywhere.
function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsText(file)
  })
}

/**
 * Attach CSV/JSON test data to the next runs. Each request (load modes) or
 * each virtual-user journey (Scenario) takes the next row, and the row's
 * columns are available as {{column}} variables. The file stays in memory for
 * this session only; it is never written into the project.
 */
export function TestDataPicker({ value, onChange, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)

  const pick = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      toast.error('Test data must be 10 MB or smaller')
      return
    }
    setLoading(true)
    try {
      const text = await readText(file)
      const lower = file.name.toLowerCase()
      const format = lower.endsWith('.json') ? 'json' : lower.endsWith('.csv') ? 'csv' : undefined
      const summary = await api.previewDataset(text, format)
      onChange({ name: file.name, spec: { text, format, mode: value?.spec.mode ?? 'sequential' }, summary })
      toast.success(`Loaded ${summary.rows.toLocaleString()} rows from ${file.name}`)
    } catch (e: any) {
      toast.error(e?.message || 'Could not read the test data')
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".csv,.json,text/csv,application/json"
      className="hidden"
      aria-label="Test data file"
      onChange={(e) => void pick(e.target.files?.[0])}
    />
  )

  if (!value) {
    return (
      <>
        {fileInput}
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => inputRef.current?.click()}
          title="Feed each request (or each scenario journey) a row from a CSV or JSON file, as {{column}} variables"
          className="flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-cyan-500/50 hover:text-foreground disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
          Test data
        </button>
      </>
    )
  }

  const columns = value.summary.columns
  return (
    <div
      className="flex h-8 items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 pl-2 pr-1 text-[11px]"
      title={`Columns: ${columns.map((column) => `{{${column}}}`).join(', ')}`}
    >
      {fileInput}
      <Database className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => inputRef.current?.click()}
        className="max-w-[10rem] truncate font-medium text-foreground hover:underline"
        aria-label={`Replace test data ${value.name}`}
      >
        {value.name}
      </button>
      <span className="shrink-0 font-mono text-muted-foreground">
        {value.summary.rows.toLocaleString()} rows · {columns.length} cols
      </span>
      <select
        aria-label="Row order"
        disabled={disabled}
        value={value.spec.mode ?? 'sequential'}
        onChange={(e) => onChange({ ...value, spec: { ...value.spec, mode: e.target.value as DatasetSpec['mode'] } })}
        className="h-6 rounded border border-border bg-background px-1 text-[11px]"
      >
        <option value="sequential">In order</option>
        <option value="random">Random</option>
      </select>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(null)}
        aria-label="Remove test data"
        className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
