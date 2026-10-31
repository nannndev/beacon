import { useState } from 'react'
import { RunStats } from '../components/LiveMonitor'
import { RunResponse } from '../types'
import { toast } from '../components/ui/toast'

export type ExportFormat = 'html' | 'json' | 'csv' | 'md' | 'logs'

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
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'run'
  )
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
    r.body ? r.body.slice(0, 200).replace(/\r?\n/g, ' ') : '',
  ])

  const lines = [headers.join(','), ...rows.map((row) => row.map(escapeCsv).join(','))]
  return downloadBlob(lines.join('\r\n'), filename + '.csv', 'text/csv;charset=utf-8;')
}

// ---- Markdown export -------------------------------------------------------

function exportMarkdown(payload: ExportPayload, filename: string) {
  const { stats, responses } = payload
  const successRate = stats.attempts > 0 ? ((stats.success / stats.attempts) * 100).toFixed(1) : '0.0'
  const lines = [
    `# Beacon Run Report — ${payload.runName ?? 'API Run'}`,
    '',
    `- **Exported At:** ${new Date().toISOString()}`,
    `- **Attempts:** ${stats.attempts}`,
    `- **Success:** ${stats.success} (${successRate}%)`,
    `- **Rate Limited:** ${stats.rate_limited}`,
    `- **Errors:** ${stats.errors}`,
    `- **Avg Latency:** ${Math.round(stats.latency_ms?.avg ?? 0)} ms`,
    '',
    '## Response Samples',
    '',
    '| # | Method | URL | Status | Latency | Outcome |',
    '| --- | --- | --- | --- | --- | --- |',
    ...responses.slice(0, 100).map((r) => {
      const ms = r.time != null ? `${Math.round(r.time * 1000)} ms` : '—'
      const outcome = r.error ? `Error: ${r.error}` : r.rate_limited ? 'Rate limited' : r.success ? 'Success' : 'Failed'
      return `| ${r.attempt} | \`${r.method || 'REQ'}\` | \`${r.url || ''}\` | ${r.status ?? 'ERR'} | ${ms} | ${outcome} |`
    }),
    '',
  ]
  return downloadBlob(lines.join('\n'), filename + '.md', 'text/markdown;charset=utf-8;')
}

// ---- HTML Interactive Run Report -------------------------------------------

function formatPrettyJson(body?: string): string {
  if (!body) return '(empty body)'
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

function exportHtml(payload: ExportPayload, filename: string) {
  const { stats, responses } = payload
  const title = payload.runName || 'API Load Run'
  const attempts = stats.attempts || 0
  const successRate = attempts > 0 ? ((stats.success / attempts) * 100).toFixed(1) : '0.0'
  const sPct = attempts > 0 ? (stats.success / attempts) * 100 : 0
  const rPct = attempts > 0 ? (stats.rate_limited / attempts) * 100 : 0
  const ePct = attempts > 0 ? (stats.errors / attempts) * 100 : 0

  const rowsHtml = responses
    .slice(0, 200)
    .map((r) => {
      const ms = r.time != null ? `${Math.round(r.time * 1000)} ms` : '—'
      const statusBadge = r.error
        ? `<span class="badge err">ERR</span>`
        : r.rate_limited
        ? `<span class="badge warn">${escapeHtml(r.status)}</span>`
        : r.success
        ? `<span class="badge ok">${escapeHtml(r.status)}</span>`
        : `<span class="badge err">${escapeHtml(r.status ?? 'FAIL')}</span>`
      const bodyFormatted = escapeHtml(formatPrettyJson(r.error || r.body))
      return `
      <details class="resp-item">
        <summary>
          <span class="att">#${escapeHtml(r.attempt)}</span>
          <span class="method">${escapeHtml(r.method || 'REQ')}</span>
          <span class="url">${escapeHtml(r.url || '')}</span>
          ${statusBadge}
          <span class="lat">${escapeHtml(ms)}</span>
        </summary>
        <pre class="resp-body">${bodyFormatted}</pre>
      </details>`
    })
    .join('')

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Beacon Run Report — ${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #070a10; color: #f1f5f9; line-height: 1.5; }
    .wrap { max-width: 960px; margin: 0 auto; padding: 32px 20px 64px; }
    .banner { background: linear-gradient(135deg, #0d1526 0%, #111c33 100%); border: 1px solid #1e293b; border-radius: 16px; padding: 22px 26px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
    .banner h1 { margin: 6px 0 2px; font-size: 22px; }
    .sub { font-size: 12px; color: #94a3b8; }
    .btn { background: #1e293b; color: #f8fafc; border: 1px solid #334155; border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 20px 0; }
    .card { background: #0d121c; border: 1px solid #1e293b; border-radius: 12px; padding: 14px; }
    .card .k { font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600; }
    .card .v { font-size: 22px; font-weight: 800; margin-top: 4px; font-family: ui-monospace, monospace; }
    .bar { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: #1e293b; margin: 16px 0 24px; }
    .seg-ok { background: #10b981; }
    .seg-warn { background: #f59e0b; }
    .seg-err { background: #ef4444; }
    h2 { font-size: 15px; margin: 24px 0 12px; color: #cbd5e1; }
    .resp-item { background: #0d121c; border: 1px solid #1e293b; border-radius: 10px; margin-bottom: 8px; overflow: hidden; }
    .resp-item summary { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; font-family: ui-monospace, monospace; font-size: 12px; list-style: none; }
    .resp-item summary::-webkit-details-marker { display: none; }
    .att { color: #64748b; min-width: 36px; }
    .method { font-weight: 700; color: #38bdf8; min-width: 48px; }
    .url { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cbd5e1; }
    .lat { color: #94a3b8; min-width: 60px; text-align: right; }
    .badge { padding: 2px 7px; border-radius: 5px; font-size: 10px; font-weight: 700; }
    .badge.ok { background: rgba(16,185,129,0.15); color: #34d399; }
    .badge.warn { background: rgba(245,158,11,0.15); color: #fbbf24; }
    .badge.err { background: rgba(239,68,68,0.15); color: #f87171; }
    .resp-body { margin: 0; padding: 12px 14px; background: #05070b; border-top: 1px solid #1e293b; font-family: ui-monospace, monospace; font-size: 11.5px; color: #e2e8f0; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
    @media print { body { background: #fff; color: #000; } .btn { display: none; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="banner">
      <div>
        <div class="sub">BEACON LIVE RUN REPORT</div>
        <h1>${escapeHtml(title)}</h1>
        <div class="sub">Exported ${escapeHtml(new Date().toLocaleString())}</div>
      </div>
      <button class="btn" onclick="window.print()">Print / Save PDF</button>
    </div>

    <div class="cards">
      <div class="card"><div class="k">Attempts</div><div class="v">${attempts.toLocaleString()}</div></div>
      <div class="card"><div class="k">Success Rate</div><div class="v" style="color:#34d399">${successRate}%</div></div>
      <div class="card"><div class="k">Avg Latency</div><div class="v" style="color:#38bdf8">${Math.round(stats.latency_ms?.avg ?? 0)} ms</div></div>
      <div class="card"><div class="k">Rate Limited</div><div class="v" style="color:#fbbf24">${stats.rate_limited.toLocaleString()}</div></div>
      <div class="card"><div class="k">Errors</div><div class="v" style="color:#f87171">${stats.errors.toLocaleString()}</div></div>
    </div>

    <div class="bar">
      <div class="seg-ok" style="width:${sPct.toFixed(1)}%"></div>
      <div class="seg-warn" style="width:${rPct.toFixed(1)}%"></div>
      <div class="seg-err" style="width:${ePct.toFixed(1)}%"></div>
    </div>

    <h2>Captured Responses (${responses.length}) — click any row to inspect JSON body</h2>
    ${rowsHtml || '<div class="sub">No responses recorded.</div>'}
  </div>
</body>
</html>`
  return downloadBlob(html, filename + '.html', 'text/html;charset=utf-8;')
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
        case 'html':
          filename = exportHtml(payload, base)
          break
        case 'json':
          filename = exportJson(payload, base)
          break
        case 'csv':
          filename = exportCsv(payload, base)
          break
        case 'md':
          filename = exportMarkdown(payload, base)
          break
        case 'logs':
          filename = exportLogs(payload, base)
          break
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
