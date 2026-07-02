import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs'
import { JsonCodeEditor } from '../JsonCodeEditor'
import { Button } from '../ui/button'
import { Upload, FileJson, ClipboardPaste, AlertCircle } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Receives the parsed JSON payload. Should throw on failure so the dialog can show the error. */
  onImport: (payload: unknown) => Promise<void>
  /** Loads a blank template into the editor to make filling-in easy. */
  fetchTemplate: () => Promise<Record<string, unknown>>
}

export function ImportDialog({ open, onOpenChange, onImport, fetchTemplate }: Props) {
  const [tab, setTab] = useState<'upload' | 'paste'>('upload')
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) { setTab('upload'); setRaw(''); setFileName(''); setError(''); setBusy(false) }
  }, [open])

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
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch (e: any) {
      setError(`Invalid JSON: ${e?.message || 'could not parse'}`)
      return
    }
    setBusy(true)
    setError('')
    try {
      await onImport(payload)
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
          <DialogTitle>Import Project</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Import from a <span className="font-mono">.json</span> export, or paste it directly.
          </p>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={loadTemplate}>
            <FileJson className="h-3.5 w-3.5" /> Load template
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'upload' | 'paste')} className="mt-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" className="gap-1.5"><Upload className="h-3.5 w-3.5" /> Upload File</TabsTrigger>
            <TabsTrigger value="paste" className="gap-1.5"><ClipboardPaste className="h-3.5 w-3.5" /> Paste JSON</TabsTrigger>
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
                  <>Drop a <span className="font-mono">.json</span> file here, or <span className="text-primary">browse</span></>
                )}
              </div>
              {fileName && <div className="text-[10px] text-muted-foreground">Click to choose a different file</div>}
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f) }}
              />
            </div>
          </TabsContent>

          <TabsContent value="paste" className="mt-3">
            <JsonCodeEditor
              value={raw}
              onChange={(v) => { setRaw(v); setError('') }}
              error={error && error.startsWith('Invalid') ? error : null}
              fileName="project.json"
              placeholder='{ "format": "security-tools.project", "version": 1, "project": { ... } }'
              minHeight="240px"
              showStatus={false}
              showToolbar={true}
            />
          </TabsContent>
        </Tabs>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 text-destructive px-3 py-2 text-xs">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !raw.trim()}>{busy ? 'Importing…' : 'Import'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
