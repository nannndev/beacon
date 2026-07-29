import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs'
import { JsonCodeEditor } from '../JsonCodeEditor'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Upload, FileJson, ClipboardPaste, AlertCircle, CheckCircle2, FolderTree, Globe2, Loader2, GitBranch, FolderOpen, SearchCheck } from 'lucide-react'
import type { CloneRepositoryResult, ImportPreview } from '../../lib/api'
import { isDesktop } from '../../lib/platform'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Receives the parsed JSON payload. Should throw on failure so the dialog can show the error. */
  onImport: (payload: unknown) => Promise<void>
  /** Parses and validates without creating a project. */
  onPreview: (payload: unknown) => Promise<ImportPreview>
  /** Loads a blank template into the editor to make filling-in easy. */
  fetchTemplate: () => Promise<Record<string, unknown>>
  /** Opens a folder that already contains a Beacon project file. */
  onOpenExistingFolder: (path: string) => Promise<void>
  /** Clones and inspects a repository, opening it immediately when it is already a Beacon project. */
  onCloneRepository: (url: string, destination: string) => Promise<CloneRepositoryResult>
  onImportRepositoryCandidate: (path: string, candidate: string) => Promise<void>
  onInitializeRepository: (path: string, name: string) => Promise<void>
}

type ImportTab = 'upload' | 'paste' | 'git' | 'folder'

export function ImportDialog({ open, onOpenChange, onImport, onPreview, fetchTemplate, onOpenExistingFolder, onCloneRepository, onImportRepositoryCandidate, onInitializeRepository }: Props) {
  const [tab, setTab] = useState<ImportTab>('upload')
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [destination, setDestination] = useState('')
  const [existingPath, setExistingPath] = useState('')
  const [inspection, setInspection] = useState<Extract<CloneRepositoryResult, { mode: 'inspection_required' }> | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState('')
  const [repositoryProjectName, setRepositoryProjectName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTab('upload'); setRaw(''); setFileName(''); setGitUrl(''); setDestination(''); setExistingPath('')
      setInspection(null); setSelectedCandidate(''); setRepositoryProjectName('')
      setError(''); setPreviewError(''); setBusy(false); setPreview(null); setChecking(false)
    }
  }, [open])

  useEffect(() => {
    if (!open || (tab !== 'upload' && tab !== 'paste') || !raw.trim()) { setPreview(null); setChecking(false); return }
    let active = true
    const timer = window.setTimeout(async () => {
      setChecking(true)
      setError('')
      setPreviewError('')
      try {
        const result = await onPreview({ content: raw, filename: fileName })
        if (active) setPreview(result)
      } catch (e: any) {
        if (active) {
          setPreview(null)
          setPreviewError(e?.message || 'Could not preview this project')
        }
      } finally {
        if (active) setChecking(false)
      }
    }, 450)
    return () => { active = false; window.clearTimeout(timer) }
  }, [open, tab, raw, fileName, onPreview])

  const readFile = async (file: File) => {
    setError('')
    setPreviewError('')
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
    setPreviewError('')
    try {
      const t = await fetchTemplate()
      setRaw(JSON.stringify(t, null, 2))
      setFileName('')
      setTab('paste')
    } catch (e: any) {
      setError(e?.message || 'Could not load template')
    }
  }

  const chooseDirectory = async (title: string, onSelected: (path: string) => void) => {
    setError('')
    if (!isDesktop()) {
      setError('Folder browsing is available in Beacon Desktop. You can still paste an absolute path.')
      return
    }
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
      const selected = await openDialog({ directory: true, multiple: false, title })
      if (selected && !Array.isArray(selected)) onSelected(selected)
    } catch (e: any) {
      setError(e?.message || 'Could not open the folder picker')
    }
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      if (tab === 'git') {
        if (inspection) {
          if (inspection.candidates.length > 0) {
            if (!selectedCandidate) throw new Error('Select an API file to import.')
            await onImportRepositoryCandidate(inspection.repository_path, selectedCandidate)
          } else {
            await onInitializeRepository(inspection.repository_path, repositoryProjectName.trim() || inspection.repository_name)
          }
          onOpenChange(false)
          return
        }
        if (!gitUrl.trim()) throw new Error('Enter a Git repository URL.')
        if (!destination.trim()) throw new Error('Choose the parent folder where Beacon should clone it.')
        const result = await onCloneRepository(gitUrl.trim(), destination.trim())
        if (result.mode === 'inspection_required') {
          setInspection(result)
          setSelectedCandidate(result.candidates[0]?.path || '')
          setRepositoryProjectName(result.repository_name)
          return
        }
      } else if (tab === 'folder') {
        if (!existingPath.trim()) throw new Error('Choose a folder containing beacon.yaml.')
        await onOpenExistingFolder(existingPath.trim())
      } else {
        if (!raw.trim()) throw new Error('Nothing to import yet — upload a file or paste JSON.')
        await onImport({ content: raw, filename: fileName })
      }
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const initializeInspectedRepository = async () => {
    if (!inspection) return
    setBusy(true)
    setError('')
    try {
      await onInitializeRepository(
        inspection.repository_path,
        repositoryProjectName.trim() || inspection.repository_name,
      )
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || 'Could not initialize this repository')
    } finally {
      setBusy(false)
    }
  }

  const fileImportTab = tab === 'upload' || tab === 'paste'
  const canSubmit = tab === 'git'
    ? inspection
      ? inspection.candidates.length === 0 || Boolean(selectedCandidate)
      : Boolean(gitUrl.trim() && destination.trim())
    : tab === 'folder'
      ? Boolean(existingPath.trim())
      : Boolean(raw.trim())
  const submitLabel = tab === 'git'
    ? inspection
      ? inspection.candidates.length > 0
        ? (busy ? 'Importing…' : 'Import selected API')
        : (busy ? 'Initializing…' : 'Initialize Beacon project')
      : (busy ? 'Cloning & inspecting…' : 'Clone & inspect')
    : tab === 'folder'
      ? (busy ? 'Opening…' : 'Open project')
      : (busy ? 'Importing…' : preview ? `Import ${preview.summary.endpoints} endpoints` : 'Import project')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Import API project</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Import a file once, or keep a team project linked to Git.</p>
          {fileImportTab && (
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={loadTemplate}>
              <FileJson className="h-3.5 w-3.5" /> Load template
            </Button>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => { setTab(v as ImportTab); setError(''); setPreviewError('') }} className="mt-1">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-4">
            <TabsTrigger value="upload" className="gap-1.5"><Upload className="h-3.5 w-3.5" /> File</TabsTrigger>
            <TabsTrigger value="paste" className="gap-1.5"><ClipboardPaste className="h-3.5 w-3.5" /> Paste</TabsTrigger>
            <TabsTrigger value="git" className="gap-1.5"><GitBranch className="h-3.5 w-3.5" /> Git repo</TabsTrigger>
            <TabsTrigger value="folder" className="gap-1.5"><FolderOpen className="h-3.5 w-3.5" /> Folder</TabsTrigger>
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
              onChange={(v) => { setRaw(v); setError(''); setPreviewError('') }}
              error={null}
              fileName={fileName || 'api-project.json'}
              placeholder={'openapi: 3.0.3\ninfo:\n  title: My API\npaths: ...'}
              minHeight="240px"
              showStatus={false}
              showToolbar={true}
            />
          </TabsContent>

          <TabsContent value="git" className="mt-3 space-y-4">
            {inspection ? (
              <RepositoryInspection
                inspection={inspection}
                selectedCandidate={selectedCandidate}
                onSelectCandidate={setSelectedCandidate}
                projectName={repositoryProjectName}
                onProjectNameChange={setRepositoryProjectName}
                onInitialize={() => void initializeInspectedRepository()}
                busy={busy}
              />
            ) : <>
            <div className="rounded-xl border border-primary/20 bg-primary/[0.035] p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary"><GitBranch className="h-4 w-4" /></div>
                <div>
                  <p className="text-sm font-semibold">Clone and inspect a repository</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Beacon opens an existing <span className="font-mono text-foreground">beacon.yaml</span>, or finds OpenAPI, Postman, Insomnia, and HAR files you can turn into a linked project.</p>
                </div>
              </div>
            </div>
            <Field label="Repository URL" hint="HTTPS or SSH — uses this device's Git credentials.">
              <Input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="git@github.com:team/api-project.git" className="font-mono text-xs" autoFocus />
            </Field>
            <Field label="Clone into" hint="Choose the parent folder. The repository folder is created inside it.">
              <div className="flex gap-2">
                <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="/Users/you/Projects" className="min-w-0 font-mono text-xs" />
                <Button type="button" variant="outline" onClick={() => chooseDirectory('Choose where to clone the repository', setDestination)}><FolderOpen className="mr-2 h-4 w-4" /> Browse</Button>
              </div>
            </Field>
            </>}
          </TabsContent>

          <TabsContent value="folder" className="mt-3 space-y-4">
            <div className="rounded-xl border border-primary/20 bg-primary/[0.035] p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary"><FolderOpen className="h-4 w-4" /></div>
                <div>
                  <p className="text-sm font-semibold">Open an existing Beacon project</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Select a folder containing <span className="font-mono text-foreground">beacon.yaml</span>. Beacon opens it in place, so changes stay visible to your normal Git workflow.</p>
                </div>
              </div>
            </div>
            <Field label="Project folder" hint="The folder must contain a valid beacon.yaml file.">
              <div className="flex gap-2">
                <Input value={existingPath} onChange={(e) => setExistingPath(e.target.value)} placeholder="/Users/you/Projects/team-api" className="min-w-0 font-mono text-xs" autoFocus />
                <Button type="button" variant="outline" onClick={() => chooseDirectory('Choose a Beacon project folder', setExistingPath)}><FolderOpen className="mr-2 h-4 w-4" /> Browse</Button>
              </div>
            </Field>
          </TabsContent>
        </Tabs>

        {fileImportTab && checking && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" /> Inspecting structure and validating requests…
          </div>
        )}

        {fileImportTab && preview && !checking && (
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

        {fileImportTab && previewError && !checking && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-words">
              Preview unavailable: {previewError}. You can still try importing; Beacon will validate the file before creating a project.
            </span>
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
          <Button onClick={submit} disabled={busy || !canSubmit}>{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RepositoryInspection({
  inspection,
  selectedCandidate,
  onSelectCandidate,
  projectName,
  onProjectNameChange,
  onInitialize,
  busy,
}: {
  inspection: Extract<CloneRepositoryResult, { mode: 'inspection_required' }>
  selectedCandidate: string
  onSelectCandidate: (path: string) => void
  projectName: string
  onProjectNameChange: (name: string) => void
  onInitialize: () => void
  busy: boolean
}) {
  const hasCandidates = inspection.candidates.length > 0
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.035] p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-500"><SearchCheck className="h-4 w-4" /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">Repository cloned</p>
              <span className="rounded border border-border bg-background/70 px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">inspected locally</span>
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={inspection.repository_path}>{inspection.repository_path}</p>
          </div>
        </div>
      </div>

      {hasCandidates ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Choose an API definition</p>
            <span className="text-[10px] text-muted-foreground">{inspection.candidates.length} found</span>
          </div>
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1" role="radiogroup" aria-label="API definitions">
            {inspection.candidates.map((candidate) => {
              const selected = selectedCandidate === candidate.path
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  key={candidate.path}
                  onClick={() => onSelectCandidate(candidate.path)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${selected ? 'border-primary bg-primary/[0.07]' : 'border-border hover:border-muted-foreground/40 hover:bg-muted/25'}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-primary' : 'border-muted-foreground/40'}`}>
                      {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-xs font-medium">{candidate.path}</span>
                        <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-primary">{candidate.format_label}</span>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {candidate.summary.endpoints} endpoints · {candidate.summary.folders} folders · {candidate.summary.environments} environments
                        {candidate.warnings.length > 0 ? ` · ${candidate.warnings.length} warnings` : ''}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/15 px-4 py-6 text-center">
          <FileJson className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">No API definition found</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">The source code is untouched. Initialize Beacon here to start adding endpoints while keeping the project Git-backed.</p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-muted/15 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Beacon project name" hint={hasCandidates ? 'Only used if you initialize without importing the detected file.' : 'Written to the new beacon.yaml.'}>
            <Input value={projectName} onChange={(event) => onProjectNameChange(event.target.value)} />
          </Field>
          {hasCandidates && (
            <Button type="button" variant="outline" className="shrink-0" disabled={busy || !projectName.trim()} onClick={onInitialize}>
              Initialize empty instead
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block flex-1 space-y-2">
      <span className="text-xs font-semibold">{label}</span>
      {children}
      <span className="block text-[10px] leading-4 text-muted-foreground">{hint}</span>
    </label>
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
