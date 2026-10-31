import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FileJson,
  FileText,
  Globe,
  Loader2,
  Lock,
  Printer,
  ShieldCheck,
} from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { JsonCodeEditor } from '../JsonCodeEditor'
import { toast } from '../ui/toast'
import { Project, TestConfig } from '../../types'
import { api } from '../../lib/api'
import {
  buildExportOutput,
  ExportedProjectEnvelope,
  flattenExportItems,
  ProjectExportFormat,
  slugifyFileName,
} from '../../lib/projectExport'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: Project
  config: TestConfig
  initialFormat?: ProjectExportFormat
}

const FORMAT_OPTIONS: Array<{
  id: ProjectExportFormat
  label: string
  badge: string
  description: string
  icon: typeof Globe
}> = [
  {
    id: 'html',
    label: 'HTML API Preview',
    badge: '.html',
    description: 'Interactive standalone API Explorer UI with search, env switcher & snippets',
    icon: Globe,
  },
  {
    id: 'beacon',
    label: 'Beacon Project',
    badge: '.project.json',
    description: 'Full portable Beacon workspace file for backup or sharing',
    icon: FileJson,
  },
  {
    id: 'openapi',
    label: 'OpenAPI 3.0 Spec',
    badge: '.openapi.json',
    description: 'Standard OpenAPI 3.0.3 schema for Swagger UI, Scalar, or Redoc',
    icon: FileCode2,
  },
  {
    id: 'postman',
    label: 'Postman v2.1',
    badge: '.postman.json',
    description: 'Postman Collection v2.1 with folders, headers, bodies & variables',
    icon: Code2,
  },
  {
    id: 'markdown',
    label: 'Markdown Docs',
    badge: '.md',
    description: 'Clean Markdown API reference ready for GitHub READMEs or wikis',
    icon: FileText,
  },
]

function buildFallbackEnvelope(project: Project | undefined, config: TestConfig, includeSecrets: boolean): ExportedProjectEnvelope {
  const envs = (project?.environments || []).map((e) => {
    const vars = e.variables || {}
    return {
      name: e.name || 'Local',
      base_url: e.base_url || config.base_url || '',
      variables: includeSecrets ? { ...vars } : Object.fromEntries(Object.keys(vars).map((k) => [k, ''])),
    }
  })

  const items =
    project?.items && project.items.length > 0
      ? project.items
      : (config.tests || []).map((t) => ({ ...t, type: 'request' as const }))

  return {
    format: 'security-tools.project',
    version: 1,
    project: {
      name: project?.name || 'Beacon Project',
      environments: envs.length > 0 ? envs : [{ name: 'Local', base_url: config.base_url || '', variables: {} }],
      items,
    },
    secrets_included: includeSecrets,
  }
}

export function ExportDialog({ open, onOpenChange, project, config, initialFormat = 'html' }: Props) {
  const [format, setFormat] = useState<ProjectExportFormat>(initialFormat)
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [htmlViewMode, setHtmlViewMode] = useState<'preview' | 'source'>('preview')
  const [customBaseUrl, setCustomBaseUrl] = useState<string>('')
  const [envelope, setEnvelope] = useState<ExportedProjectEnvelope | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (open) {
      setFormat(initialFormat)
      setHtmlViewMode('preview')
      setCopied(false)
      setCustomBaseUrl('')
    }
  }, [open, initialFormat])

  useEffect(() => {
    if (!open || !project) return
    let cancelled = false
    setLoading(true)
    api
      .exportProject(project.id, includeSecrets)
      .then((data) => {
        if (!cancelled) setEnvelope(data as ExportedProjectEnvelope)
      })
      .catch(() => {
        if (!cancelled) setEnvelope(buildFallbackEnvelope(project, config, includeSecrets))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, project, includeSecrets, config])

  const effectiveEnvelope = useMemo(() => {
    const raw = envelope ?? buildFallbackEnvelope(project, config, includeSecrets)
    if (!customBaseUrl.trim()) return raw
    const updatedEnvs = (raw.project.environments || []).map((e, idx) =>
      idx === 0 ? { ...e, base_url: customBaseUrl.trim() } : e
    )
    return {
      ...raw,
      project: {
        ...raw.project,
        environments:
          updatedEnvs.length > 0
            ? updatedEnvs
            : [{ name: 'Default', base_url: customBaseUrl.trim(), variables: {} }],
      },
    }
  }, [envelope, project, config, includeSecrets, customBaseUrl])

  const endpointCount = useMemo(
    () => flattenExportItems(effectiveEnvelope.project.items || []).length,
    [effectiveEnvelope],
  )

  const output = useMemo(
    () => buildExportOutput(format, effectiveEnvelope),
    [format, effectiveEnvelope],
  )

  const fileName = `${slugifyFileName(effectiveEnvelope.project.name)}.${output.extension}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output.content)
      setCopied(true)
      toast.success(`Copied ${ FORMAT_OPTIONS.find((f) => f.id === format)?.label || 'export' } to clipboard`)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const handleDownload = () => {
    try {
      const blob = new Blob([output.content], { type: output.mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(
        `Downloaded ${fileName} · ${includeSecrets ? 'secrets included' : 'secrets redacted'}`,
      )
    } catch (e: any) {
      toast.error(e?.message || 'Failed to download export')
    }
  }

  const openHtmlInNewTab = (printAfterOpen = false) => {
    const htmlContent = format === 'html' ? output.content : buildExportOutput('html', effectiveEnvelope).content
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(htmlContent)
      win.document.close()
      if (printAfterOpen) {
        window.setTimeout(() => win.print(), 400)
      }
    } else {
      toast.error('Popup blocked — use Download to save the HTML file.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[920px]">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
            <div>
              <DialogTitle className="text-base font-bold">
                Export &amp; Preview APIs — {project?.name || 'Project'}
              </DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {endpointCount} endpoint{endpointCount === 1 ? '' : 's'} ·{' '}
                {effectiveEnvelope.project.environments?.length || 0} environment
                {(effectiveEnvelope.project.environments?.length || 0) === 1 ? '' : 's'}
              </p>
            </div>

            <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs">
              <input
                type="checkbox"
                checked={includeSecrets}
                onChange={(e) => setIncludeSecrets(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-cyan-500"
              />
              {includeSecrets ? (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                  <Lock className="h-3 w-3" /> Include secret values
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" /> Secrets redacted (Safe)
                </span>
              )}
            </label>
          </div>
        </DialogHeader>

        {/* Format Selector */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {FORMAT_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const active = format === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFormat(opt.id)}
                className={`flex flex-col items-start rounded-xl border p-3 text-left transition-all ${
                  active
                    ? 'border-cyan-500/60 bg-cyan-500/10 ring-1 ring-cyan-500/30'
                    : 'border-border bg-card hover:border-muted-foreground/40 hover:bg-muted/30'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-1">
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-lg ${
                      active ? 'bg-cyan-500/20 text-cyan-400' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                    {opt.badge}
                  </span>
                </div>
                <div className="mt-2 text-xs font-bold">{opt.label}</div>
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                  {opt.description}
                </p>
              </button>
            )
          })}
        </div>

        {/* Target Base URL Override */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-2.5">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-cyan-500 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-foreground">Target Base URL</div>
              <div className="text-[10px] text-muted-foreground">
                Override host URL across exported HTML, OpenAPI spec, Postman collection &amp; snippets
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder={effectiveEnvelope.project.environments?.[0]?.base_url || 'https://api.example.com'}
              className="h-8 w-full sm:w-80 rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            {customBaseUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setCustomBaseUrl('')}
              >
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* Preview Header + Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono font-semibold text-foreground">{fileName}</span>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-500" />}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {format === 'html' && (
              <>
                <div className="inline-flex rounded-md border border-border bg-background p-0.5">
                  <button
                    type="button"
                    onClick={() => setHtmlViewMode('preview')}
                    className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      htmlViewMode === 'preview'
                        ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Eye className="h-3 w-3" /> Interactive UI Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setHtmlViewMode('source')}
                    className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      htmlViewMode === 'source'
                        ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Code2 className="h-3 w-3" /> HTML Source
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => openHtmlInNewTab(false)}
                >
                  <ExternalLink className="h-3 w-3" /> Open in Tab
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => openHtmlInNewTab(true)}
                >
                  <Printer className="h-3 w-3" /> Print / PDF
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Preview Area */}
        <div className="min-h-[380px]">
          {format === 'html' && htmlViewMode === 'preview' ? (
            <div className="overflow-hidden rounded-xl border border-border bg-[#070a10] shadow-inner">
              <iframe
                title="Interactive API Documentation Preview"
                srcDoc={output.content}
                className="h-[420px] w-full border-0"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          ) : output.isJson ? (
            <JsonCodeEditor
              value={output.content}
              readOnly
              fileName={fileName}
              minHeight="380px"
              maxHeight="420px"
              showHeader={true}
              showToolbar={true}
              showStatus={true}
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-[#07090d]">
              <div className="flex items-center justify-between border-b border-slate-800 bg-[#0b0f17] px-3 py-2">
                <span className="font-mono text-[11px] font-bold text-slate-300">{fileName}</span>
                <span className="font-mono text-[10px] text-slate-400">
                  {output.content.split('\n').length} lines · {output.content.length.toLocaleString()} chars
                </span>
              </div>
              <pre className="max-h-[380px] overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap break-words">
                {output.content}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="text-[11px] text-muted-foreground self-center">
            {format === 'html'
              ? 'Self-contained HTML file — works offline in any browser with zero dependencies.'
              : format === 'openapi'
              ? 'OpenAPI 3.0.3 JSON — ready for Swagger UI, Scalar, Redoc, or Postman.'
              : 'Ready to share or commit to version control.'}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="button" variant="outline" className="gap-1.5" onClick={() => void handleCopy()}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button type="button" className="gap-1.5" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5" /> Download { FORMAT_OPTIONS.find((f) => f.id === format)?.badge }
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

