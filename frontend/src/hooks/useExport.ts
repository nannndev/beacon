import { useState } from 'react'
import { RunStats } from '../components/LiveMonitor'
import { RunResponse } from '../types'
import { toast } from '../components/ui/toast'

export type ExportFormat = 'json' | 'csv' | 'logs'

interface ExportPayload {
  responses: RunResponse[]
  logs: string[]
  stats: RunStats
  runName?: string
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return filename
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'run'
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

// ---- JSON export -----------------------------------------------------------

function exportJson(payload: ExportPayload, filename: string) {
  const data = {
    exported_at: new Date().toISOString(),
    run_name: payload.runName ?? null,
    summary: payload.stats,
    responses: payload.responses,
    logs: payload.logs,
  }
  return downloadBlob(JSON.stringify(data, null, 2), filename + '.json', 'application/json')
}

// ---- CSV export ------------------------------------------------------------

function escapeCsv(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  // Wrap in quotes if it contains comma, quote, or newline
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function exportCsv(payload: ExportPayload, filename: string) {
  const headers = ['attempt', 'method', 'url', 'status', 'time_ms', 'success', 'rate_limited', 'error', 'body_preview']
  const rows = payload.responses.map((r) => [
    r.attempt,
    r.method ?? '',
    r.url ?? '',
    r.status ?? '',
    r.time != null ? Math.round(r.time * 1000) : '',
    r.success ? 'true' : 'false',
    r.rate_limited ? 'true' : 'false',
    r.error ?? '',
    // Truncate body to 200 chars for CSV readability
    r.body ? r.body.slice(0, 200).replace(/\r?\n/g, ' ') : '',
  ])

  const lines = [
    headers.join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ]
  return downloadBlob(lines.join('\r\n'), filename + '.csv', 'text/csv;charset=utf-8;')
}

// ---- Logs export -----------------------------------------------------------

function exportLogs(payload: ExportPayload, filename: string) {
  const header = [
    `# Beacon Run Export`,
    `# Run: ${payload.runName ?? 'unnamed'}`,
    `# Exported: ${new Date().toISOString()}`,
    `# Attempts: ${payload.stats.attempts}  Success: ${payload.stats.success}  Rate-limited: ${payload.stats.rate_limited}  Errors: ${payload.stats.errors}`,
    '',
  ].join('\n')

  return downloadBlob(header + payload.logs.join('\n'), filename + '.log', 'text/plain')
}

// ---- Public hook -----------------------------------------------------------

export function useExport() {
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const exportRun = async (format: ExportFormat, payload: ExportPayload) => {
    setExporting(format)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const base = slugify(payload.runName ?? 'run') + '_' + timestamp()
    try {
      let filename: string
      switch (format) {
        case 'json': filename = exportJson(payload, base); break
        case 'csv': filename = exportCsv(payload, base); break
        case 'logs': filename = exportLogs(payload, base); break
      }
      toast.success(`Downloaded ${filename}`)
    } catch (error: any) {
      toast.error(error?.message || 'Could not export this run')
    } finally {
      setExporting(null)
    }
  }

  return { exportRun, exporting }
}
