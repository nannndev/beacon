import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Badge } from '../ui/badge'
import { KVEditor } from '../KVEditor'
import { CheckCircle2, Copy, Download, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from '../ui/toast'
import { Project, Environment } from '../../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: Project
  activeEnvId?: string
  onSave: (environments: Environment[], nextActiveEnvId?: string) => Promise<void> | void
}

export function EnvironmentsDialog({ open, onOpenChange, project, activeEnvId, onSave }: Props) {
  const [envs, setEnvs] = useState<Environment[]>([])
  const [sel, setSel] = useState(0)
  const [selectedActiveId, setSelectedActiveId] = useState<string | undefined>(activeEnvId)
  const [exporting, setExporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const initializedForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      initializedForRef.current = null
      return
    }
    const key = `${project?.id || 'none'}`
    if (project && initializedForRef.current !== key) {
      initializedForRef.current = key
      const copy: Environment[] = JSON.parse(JSON.stringify(project.environments || []))
      setEnvs(copy)
      setSelectedActiveId(activeEnvId || copy[0]?.id)
      const idx = copy.findIndex((e) => e.id === activeEnvId)
      setSel(idx >= 0 ? idx : 0)
    }
  }, [open, project, activeEnvId])

  const current = envs[sel]

  const patch = (p: Partial<Environment>) =>
    setEnvs((prev) => prev.map((e, i) => (i === sel ? { ...e, ...p } : e)))

  const addEnv = () => {
    const env: Environment = {
      id: 'env-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: 'New Environment',
      base_url: '',
      variables: {},
    }
    setEnvs((prev) => {
      const next = [...prev, env]
      setSel(next.length - 1)
      if (!selectedActiveId) setSelectedActiveId(env.id)
      return next
    })
  }

  const deleteEnv = (idx: number) => {
    setEnvs((prev) => {
      const removed = prev[idx]
      const next = prev.filter((_, i) => i !== idx)
      setSel((s) => Math.max(0, Math.min(s, next.length - 1)))
      if (removed && selectedActiveId === removed.id) {
        setSelectedActiveId(next[0]?.id)
      }
      return next
    })
  }

  const duplicateEnv = () => {
    if (!current) return
    const clone: Environment = {
      ...JSON.parse(JSON.stringify(current)),
      id: `env-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
        base_url: String(env.base_url || '').trim(),
        variables: typeof env.variables === 'object' && env.variables ? (env.variables as Record<string, string>) : {},
      }))
      setEnvs((prev) => {
        const next = [...prev, ...normalized]
        setSel(prev.length)
        if (!selectedActiveId && next[0]) setSelectedActiveId(next[0].id)
        return next
      })
      toast.success(`Imported ${normalized.length} environment${normalized.length === 1 ? '' : 's'}`)
    } catch (error: any) {
      toast.error(error?.message || 'Invalid environment file')
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  const handleSave = () => {
    const cleaned = envs.map((env, index) => ({
      ...env,
      name: (env.name || '').trim() || `Environment ${index + 1}`,
      base_url: (env.base_url || '').trim(),
      variables: env.variables || {},
    }))
    void onSave(cleaned, selectedActiveId)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <div className="flex flex-col gap-2 pr-8 sm:flex-row sm:items-center sm:justify-between">
            <DialogTitle>Environments — {project?.name}</DialogTitle>
            <div className="flex items-center gap-1">
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => void importEnvironments(e.target.files?.[0])}
              />
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => importRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Import
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={envs.length === 0 || exporting}
                onClick={() => void exportEnvironments()}
              >
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{' '}
                {exporting ? 'Preparing…' : 'Export'}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-[340px] flex-col gap-4 py-1 sm:flex-row">
          {/* Master: environment list */}
          <div className="flex max-h-44 w-full shrink-0 flex-col border-b border-border pb-3 sm:max-h-none sm:w-48 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-3">
            <div className="flex-1 overflow-auto space-y-1">
              {envs.length === 0 && (
                <p className="text-xs text-muted-foreground px-1 py-2">No environments yet.</p>
              )}
              {envs.map((env, idx) => {
                const varCount = Object.keys(env.variables || {}).filter(Boolean).length
                const isActive = env.id === selectedActiveId
                return (
                  <button
                    key={env.id || idx}
                    type="button"
                    onClick={() => setSel(idx)}
                    className={`w-full text-left px-2.5 py-2 rounded-md text-xs flex items-center gap-2 transition-colors ${idx === sel ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                      }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{env.name || 'Untitled'}</div>
                      <div className={`text-[10px] truncate ${idx === sel ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>
                        {varCount} {varCount === 1 ? 'var' : 'vars'}
                        {env.base_url ? ` · ${env.base_url.replace(/^https?:\/\//, '')}` : ''}
                      </div>
                    </div>
                    {isActive && (
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${idx === sel
                          ? 'bg-primary-foreground/20 text-primary-foreground'
                          : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          }`}
                      >
                        active
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2 h-8 text-xs gap-1.5" onClick={addEnv}>
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
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor="env-name-input" className="text-xs">Name</Label>
                    <Input
                      id="env-name-input"
                      value={current.name ?? ''}
                      onChange={(e) => patch({ name: e.target.value })}
                      placeholder="Local / Staging / Production"
                      className="h-8 mt-1"
                    />
                  </div>
                  {current.id === selectedActiveId ? (
                    <Badge className="h-8 px-2.5 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Active
                    </Badge>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => setSelectedActiveId(current.id)}
                    >
                      Set as active
                    </Button>
                  )}
                </div>

                <div>
                  <Label htmlFor="env-base-url-input" className="text-xs">Base URL</Label>
                  <Input
                    id="env-base-url-input"
                    value={current.base_url ?? ''}
                    onChange={(e) => patch({ base_url: e.target.value })}
                    className="h-8 mt-1 font-mono text-xs"
                    placeholder="https://api.example.com"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Prepended to relative endpoint paths like <code className="font-mono">/users</code>.
                  </p>
                </div>

                <div>
                  <Label className="text-xs">
                    Variables{' '}
                    <span className="text-muted-foreground font-normal">
                      — tokens, cookies, IDs… reference as {'{{key}}'} in URLs, headers, or bodies
                    </span>
                  </Label>
                  <div className="mt-1.5">
                    <KVEditor
                      data={current.variables || {}}
                      onChange={(vars) => patch({ variables: vars })}
                      maskSensitive
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={duplicateEnv}>
                    <Copy className="h-3 w-3" /> Duplicate
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => deleteEnv(sel)}
                  >
                    <Trash2 className="h-3 w-3" /> Delete environment
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <div className="mr-auto text-[11px] text-muted-foreground self-center">
            {selectedActiveId && envs.find((e) => e.id === selectedActiveId)
              ? `Active environment: ${envs.find((e) => e.id === selectedActiveId)?.name || 'Untitled'}`
              : 'Switch the active environment here or from the workspace header.'}
          </div>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
