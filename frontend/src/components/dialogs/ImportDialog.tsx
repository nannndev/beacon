import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs'
import { JsonCodeEditor } from '../JsonCodeEditor'
import { Button } from '../ui/button'
import { Upload, FileJson, ClipboardPaste, AlertCircle, CheckCircle2, FolderTree, Globe2, Loader2 } from 'lucide-react'
import type { ImportPreview } from '../../lib/api'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Receives the parsed JSON payload. Should throw on failure so the dialog can show the error. */
  onImport: (payload: unknown) => Promise<void>
  /** Parses and validates without creating a project. */
  onPreview: (payload: unknown) => Promise<ImportPreview>
  /** Loads a blank template into the editor to make filling-in easy. */
  fetchTemplate: () => Promise<Record<string, unknown>>
}

export function ImportDialog({ open, onOpenChange, onImport, onPreview, fetchTemplate }: Props) {
  const [tab, setTab] = useState<'upload' | 'paste'>('upload')
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) { setTab('upload'); setRaw(''); setFileName(''); setError(''); setBusy(false); setPreview(null); setChecking(false) }
  }, [open])

  useEffect(() => {
    if (!open || !raw.trim()) { setPreview(null); return }
    let active = true
    const timer = window.setTimeout(async () => {
      setChecking(true)
      setError('')
      try {
        const result = await onPreview({ content: raw, filename: fileName })
        if (active) setPreview(result)
      } catch (e: any) {
        if (active) { setPreview(null); setError(e?.message || 'Could not recognize this project') }
      } finally {
        if (active) setChecking(false)
      }
    }, 450)
    return () => { active = false; window.clearTimeout(timer) }
  }, [open, raw, fileName, onPreview])

  const readFile = async (file: File) => {
    setError('')
    setFileName(file.name)
    try {
      setRaw(await file.text())
    } catch {
      setError('Could not read that file.')
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) readFile(file)
  }

  const loadTemplate = async () => {
    setError('')
    try {
      const t = await fetchTemplate()
      setRaw(JSON.stringify(t, null, 2))
      setFileName('')
      setTab('paste')
    } catch (e: any) {
      setError(e?.message || 'Could not load template')
    }
  }

  const submit = async () => {
    if (!raw.trim()) { setError('Nothing to import yet — upload a file or paste JSON.'); return }
    if (!preview) { setError('Wait for a valid import preview before continuing.'); return }
    setBusy(true)
    setError('')
    try {
      await onImport({ content: raw, filename: fileName })
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Import API project</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Beacon, Postman, OpenAPI, Swagger, Insomnia, or HAR.
          </p>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={loadTemplate}>
            <FileJson className="h-3.5 w-3.5" /> Load template
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'upload' | 'paste')} className="mt-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" className="gap-1.5"><Upload className="h-3.5 w-3.5" /> Upload File</TabsTrigger>
            <TabsTrigger value="paste" className="gap-1.5"><ClipboardPaste className="h-3.5 w-3.5" /> Paste JSON / YAML</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-3">
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center cursor-pointer transition-colors ${
                dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
              }`}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <div className="text-sm">
                {fileName ? (
                  <span className="font-medium">{fileName}</span>
                ) : (
                  <>Drop a <span className="font-mono">.json · .yaml · .har</span> file, or <span className="text-primary">browse</span></>
                )}
              </div>
              {fileName && <div className="text-[10px] text-muted-foreground">Click to choose a different file</div>}
              <input
                ref={fileRef}
                type="file"
                accept="application/json,application/yaml,text/yaml,.json,.yaml,.yml,.har"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f) }}
              />
            </div>
          </TabsContent>

          <TabsContent value="paste" className="mt-3">
            <JsonCodeEditor
              value={raw}
              onChange={(v) => { setRaw(v); setError('') }}
              error={null}
              fileName={fileName || 'api-project.json'}
              placeholder={'openapi: 3.0.3\ninfo:\n  title: My API\npaths: ...'}
              minHeight="240px"
              showStatus={false}
              showToolbar={true}
            />
          </TabsContent>
        </Tabs>

        {checking && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" /> Inspecting structure and validating requests…
          </div>
        )}

        {preview && !checking && (
          <div className="overflow-hidden rounded-xl border border-emerald-500/25 bg-emerald-500/[0.035]">
            <div className="flex items-start gap-3 border-b border-emerald-500/15 px-3.5 py-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">{preview.summary.name}</p>
                  <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-primary">{preview.format_label}</span>
                </div>
                <p className="mt-0.5 text-[10px] text-muted-foreground">Ready to create a new project. Existing projects will not be changed.</p>
              </div>
            </div>
            <div className="grid grid-cols-3 divide-x divide-border/60">
              <PreviewMetric icon={<FileJson className="h-3.5 w-3.5" />} value={preview.summary.endpoints} label="endpoints" />
              <PreviewMetric icon={<FolderTree className="h-3.5 w-3.5" />} value={preview.summary.folders} label="folders" />
              <PreviewMetric icon={<Globe2 className="h-3.5 w-3.5" />} value={preview.summary.environments} label="environments" />
            </div>
            {preview.warnings.length > 0 && (
              <div className="border-t border-amber-500/20 bg-amber-500/[0.045] px-3.5 py-2.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">Review after import</p>
                <ul className="max-h-24 space-y-1 overflow-auto text-[10px] leading-4 text-muted-foreground">
                  {preview.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 text-destructive px-3 py-2 text-xs">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || checking || !preview}>{busy ? 'Importing…' : preview ? `Import ${preview.summary.endpoints} endpoints` : 'Import'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PreviewMetric({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-2 py-2.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="font-mono text-sm font-semibold">{value}</span>
      <span className="hidden text-[10px] text-muted-foreground sm:inline">{label}</span>
    </div>
  )
}
