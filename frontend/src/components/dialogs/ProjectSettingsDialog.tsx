import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Trash2, Send, Loader2, CheckCircle2, AlertTriangle, BellOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '../../lib/api'
import { toast } from '../ui/toast'
import { Project, ProjectNotifications, NotifyMode } from '../../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: Project
  onSave: (name: string, notifications: ProjectNotifications) => Promise<void> | void
  onDelete: () => Promise<void> | void
}

const MODES: { value: NotifyMode; label: string; hint: string; icon: typeof BellOff }[] = [
  { value: 'off', label: 'Off', hint: 'Never notify', icon: BellOff },
  { value: 'on_failure', label: 'On failure', hint: 'Only when errors occur', icon: AlertTriangle },
  { value: 'always', label: 'Always', hint: 'Every finished run', icon: CheckCircle2 },
]

// Loosely matches https://discord.com/api/webhooks/<id>/<token> so we can
// disable the test button before a paste is even plausibly complete.
const WEBHOOK_RE = /^https:\/\/([\w-]+\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i

export function ProjectSettingsDialog({ open, onOpenChange, project, onSave, onDelete }: Props) {
  const [name, setName] = useState('')
  const [webhook, setWebhook] = useState('')
  const [mode, setMode] = useState<NotifyMode>('off')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(project?.name || '')
    setWebhook(project?.notifications?.discord_webhook || '')
    setMode(project?.notifications?.mode || 'off')
  }, [open, project])

  const webhookValid = WEBHOOK_RE.test(webhook.trim())

  const handleTest = async () => {
    if (!project?.id || !webhookValid) return
    setTesting(true)
    try {
      const r = await api.testNotification(project.id, webhook.trim())
      if (r.ok) toast.success('Test message sent — check your Discord channel')
      else toast.error(r.error || 'Could not reach that webhook')
    } catch (e: any) {
      toast.error(e?.message || 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave(name.trim(), { discord_webhook: webhook.trim(), mode })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div>
            <Label className="text-xs">Project Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }} />
          </div>

          {/* Discord notifications */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">Discord notifications</span>
              <span className="text-[10px] text-muted-foreground">Post run results to a channel</span>
            </div>

            {/* Segmented mode selector */}
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1">
              {MODES.map((m) => {
                const Icon = m.icon
                const active = mode === m.value
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMode(m.value)}
                    title={m.hint}
                    className={cn(
                      'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors',
                      active
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {m.label}
                  </button>
                )
              })}
            </div>

            {mode !== 'off' && (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  <Input
                    value={webhook}
                    onChange={(e) => setWebhook(e.target.value)}
                    placeholder="https://discord.com/api/webhooks/..."
                    spellCheck={false}
                    className="h-8 text-xs font-mono"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 px-2.5"
                    disabled={!webhookValid || testing}
                    onClick={handleTest}
                  >
                    {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Test
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Discord → Server Settings → Integrations → Webhooks → copy URL.
                  {webhook.trim() && !webhookValid && (
                    <span className="text-amber-500"> That doesn’t look like a webhook URL.</span>
                  )}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
            <div className="text-xs font-medium text-red-500 mb-1">Danger zone</div>
            <p className="text-[11px] text-muted-foreground mb-2">Deleting a project removes all its environments and endpoints.</p>
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => onDelete()}>
              <Trash2 className="h-3.5 w-3.5" /> Delete Project
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
