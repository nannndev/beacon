import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Badge } from '../ui/badge'
import { KVEditor } from '../KVEditor'
import { Copy, Download, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from '../ui/toast'
import { Project, Environment } from '../../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: Project
  activeEnvId?: string
  onSave: (environments: Environment[]) => Promise<void> | void
}

export function EnvironmentsDialog({ open, onOpenChange, project, activeEnvId, onSave }: Props) {
  const [envs, setEnvs] = useState<Environment[]>([])
  const [sel, setSel] = useState(0)
  const [exporting, setExporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open && project) {
      const copy: Environment[] = JSON.parse(JSON.stringify(project.environments || []))
      setEnvs(copy)
      // start on the active env if present
      const idx = copy.findIndex((e) => e.id === activeEnvId)
      setSel(idx >= 0 ? idx : 0)
    }
  }, [open, project, activeEnvId])

  const current = envs[sel]

  const patch = (p: Partial<Environment>) =>
    setEnvs((prev) => prev.map((e, i) => (i === sel ? { ...e, ...p } : e)))

  const addEnv = () => {
    const env: Environment = { id: 'env-' + Date.now(), name: 'New Environment', base_url: '', variables: {} }
    setEnvs((prev) => {
      const next = [...prev, env]
      setSel(next.length - 1)
      return next
    })
  }

  const deleteEnv = (idx: number) => {
    setEnvs((prev) => {
      const next = prev.filter((_, i) => i !== idx)
      setSel((s) => Math.max(0, Math.min(s, next.length - 1)))
      return next
    })
  }

  const duplicateEnv = () => {
    if (!current) return
    const clone: Environment = {
      ...JSON.parse(JSON.stringify(current)),
      id: `env-${Date.now()}`,
      name: `${current.name || 'Environment'} copy`,
    }
    setEnvs((prev) => {
      const next = [...prev, clone]
      setSel(next.length - 1)
      return next
    })
  }

  const exportEnvironments = async () => {
    setExporting(true)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    try {
      const blob = new Blob([JSON.stringify({ version: 1, environments: envs }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const filename = `${(project?.name || 'beacon').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-environments.json`
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)
      toast.success(`Downloaded ${filename}`)
    } catch (error: any) {
      toast.error(error?.message || 'Could not export environments')
    } finally {
      setExporting(false)
    }
  }

  const importEnvironments = async (file?: File) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      const incoming = Array.isArray(parsed) ? parsed : parsed.environments
      if (!Array.isArray(incoming)) throw new Error('Expected an environments array')
      const normalized: Environment[] = incoming.map((env: Partial<Environment>, index: number) => ({
        id: `env-${Date.now()}-${index}`,
        name: String(env.name || `Imported ${index + 1}`),
        base_url: String(env.base_url || ''),
        variables: typeof env.variables === 'object' && env.variables ? env.variables as Record<string, string> : {},
      }))
      setEnvs((prev) => [...prev, ...normalized])
      setSel(envs.length)
      toast.success(`Imported ${normalized.length} environment${normalized.length === 1 ? '' : 's'}`)
    } catch (error: any) {
      toast.error(error?.message || 'Invalid environment file')
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <div className="flex flex-col gap-2 pr-8 sm:flex-row sm:items-center sm:justify-between">
            <DialogTitle>Environments — {project?.name}</DialogTitle>
            <div className="flex items-center gap-1">
              <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void importEnvironments(e.target.files?.[0])} />
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => importRef.current?.click()}><Upload className="h-3.5 w-3.5" /> Import</Button>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={envs.length === 0 || exporting} onClick={() => void exportEnvironments()}>{exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {exporting ? 'Preparing…' : 'Export'}</Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-[320px] flex-col gap-4 py-1 sm:flex-row">
          {/* Master: environment list */}
          <div className="flex max-h-40 w-full shrink-0 flex-col border-b border-border pb-3 sm:max-h-none sm:w-44 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-3">
            <div className="flex-1 overflow-auto space-y-0.5">
              {envs.length === 0 && (
                <p className="text-xs text-muted-foreground px-1 py-2">No environments yet.</p>
              )}
              {envs.map((env, idx) => (
                <button
                  key={env.id || idx}
                  onClick={() => setSel(idx)}
                  className={`w-full text-left px-2.5 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${
                    idx === sel ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  <span className="truncate flex-1">{env.name || 'Untitled'}</span>
                  {env.id === activeEnvId && (
                    <span className={`text-[9px] px-1 rounded ${idx === sel ? 'bg-primary-foreground/20' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'}`}>
                      active
                    </span>
                  )}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-2 h-8 text-xs gap-1.5" onClick={addEnv}>
              <Plus className="h-3.5 w-3.5" /> Add environment
            </Button>
          </div>

          {/* Detail: selected environment */}
          <div className="flex-1 min-w-0">
            {!current ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Add an environment to get started.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Label className="text-xs">Name</Label>
                    <Input value={current.name || ''} onChange={(e) => patch({ name: e.target.value })} className="h-8 mt-1" />
                  </div>
                  {current.id === activeEnvId && (
                    <Badge className="mt-5 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">active</Badge>
                  )}
                </div>

                <div>
                  <Label className="text-xs">Base URL</Label>
                  <Input value={current.base_url || ''} onChange={(e) => patch({ base_url: e.target.value })} className="h-8 mt-1 font-mono" placeholder="https://api.example.com" />
                </div>

                <div>
                  <Label className="text-xs">Variables <span className="text-muted-foreground font-normal">— tokens, cookies… use {'{{key}}'} in endpoints</span></Label>
                  <div className="mt-1">
                    <KVEditor data={current.variables || {}} onChange={(vars) => patch({ variables: vars })} maskSensitive />
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={duplicateEnv}>
                    <Copy className="h-3 w-3" /> Duplicate
                  </Button>
                  <Button size="sm" variant="destructive" className="h-7 text-xs gap-1.5" onClick={() => deleteEnv(sel)}>
                    <Trash2 className="h-3 w-3" /> Delete environment
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <div className="mr-auto text-[11px] text-muted-foreground self-center">
            Switch the active environment from the sidebar dropdown.
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave(envs)}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
