import { useEffect, useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Trash2, Send, Loader2, CheckCircle2, AlertTriangle, BellOff, Radio, ShieldCheck, Laptop, History, Copy, RefreshCw, Users, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '../../lib/api'
import { toast } from '../ui/toast'
import { Project, ProjectNotifications, NotifyMode, ProjectRevision, SharingStatus } from '../../types'

interface Props {
  onBack: () => void
  project?: Project
  sharingStatus?: SharingStatus | null
  sharingStatusLoading?: boolean
  onSharingStatusChange: (status: SharingStatus) => void
  onSave: (name: string, notifications: ProjectNotifications) => Promise<void> | void
  onDelete: () => Promise<void> | void
  onProjectListChange: () => Promise<void> | void
}

const MODES: { value: NotifyMode; label: string; hint: string; icon: typeof BellOff }[] = [
  { value: 'off', label: 'Off', hint: 'Never notify', icon: BellOff },
  { value: 'on_failure', label: 'On failure', hint: 'Only when errors occur', icon: AlertTriangle },
  { value: 'always', label: 'Always', hint: 'Every finished run', icon: CheckCircle2 },
]

// Loosely matches https://discord.com/api/webhooks/<id>/<token> so we can
// disable the test button before a paste is even plausibly complete.
const WEBHOOK_RE = /^https:\/\/([\w-]+\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i

export function ProjectSettingsPage({ onBack, project, sharingStatus, sharingStatusLoading = false, onSharingStatusChange, onSave, onDelete, onProjectListChange }: Props) {
  const [name, setName] = useState('')
  const [webhook, setWebhook] = useState('')
  const [mode, setMode] = useState<NotifyMode>('off')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sharingBusy, setSharingBusy] = useState(false)
  const [sharingError, setSharingError] = useState('')
  const [revisions, setRevisions] = useState<ProjectRevision[]>([])
  const [revisionsLoading, setRevisionsLoading] = useState(false)
  const isMember = Boolean(sharingStatus?.member)
  const isViewer = sharingStatus?.member?.role === 'viewer'

  useEffect(() => {
    setName(project?.name || '')
    setWebhook(project?.notifications?.discord_webhook || '')
    setMode(project?.notifications?.mode || 'off')
  }, [project])

  useEffect(() => {
    if (!project?.id || !sharingStatus?.sharing_enabled || sharingStatus.member) {
      setRevisions([])
      return
    }
    let cancelled = false
    setRevisionsLoading(true)
    api.sharingRevisions(project.id)
      .then(({ items }) => { if (!cancelled) setRevisions(items.slice(-5).reverse()) })
      .catch((error) => { if (!cancelled) setSharingError(error?.message || 'Could not load sharing activity') })
      .finally(() => { if (!cancelled) setRevisionsLoading(false) })
    return () => { cancelled = true }
  }, [project?.id, sharingStatus?.sharing_enabled, sharingStatus?.revision, sharingStatus?.member])

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

  const toggleSharing = async () => {
    if (!project?.id || sharingBusy) return
    setSharingBusy(true)
    setSharingError('')
    try {
      const status = sharingStatus?.sharing_enabled
        ? await api.disableSharing(project.id)
        : await api.enableSharing(project.id)
      onSharingStatusChange(status)
      toast.success(status.sharing_enabled ? 'Project source is ready to share locally' : 'Local project sharing stopped')
    } catch (error: any) {
      const message = error?.message || 'Could not update sharing'
      setSharingError(message)
      toast.error(message)
    } finally {
      setSharingBusy(false)
    }
  }

  const copyValue = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copied`)
  }

  const refreshPairingCode = async () => {
    if (!project?.id || sharingBusy) return
    setSharingBusy(true)
    try {
      const host = await api.refreshPairingCode(project.id)
      onSharingStatusChange({ ...sharingStatus!, host })
      toast.success('New pairing code generated')
    } catch (error: any) {
      toast.error(error?.message || 'Could not refresh pairing code')
    } finally {
      setSharingBusy(false)
    }
  }

  const decidePairing = async (requestId: string, approved: boolean, role: 'viewer' | 'editor') => {
    if (!project?.id || sharingBusy) return
    setSharingBusy(true)
    try {
      await api.decidePairing(project.id, requestId, approved, role)
      onSharingStatusChange(await api.sharingStatus(project.id))
      toast.success(approved ? `Device approved as ${role}` : 'Join request rejected')
    } catch (error: any) {
      toast.error(error?.message || 'Could not update join request')
    } finally {
      setSharingBusy(false)
    }
  }

  const updateMember = async (deviceId: string, role?: 'viewer' | 'editor') => {
    if (!project?.id || sharingBusy) return
    setSharingBusy(true)
    try {
      if (role) {
        await api.updateSharingMember(project.id, deviceId, role)
        toast.success(`Member changed to ${role}`)
      } else {
        await api.removeSharingMember(project.id, deviceId)
        toast.success('Member access revoked')
      }
      onSharingStatusChange(await api.sharingStatus(project.id))
    } catch (error: any) {
      toast.error(error?.message || 'Could not update member')
    } finally {
      setSharingBusy(false)
    }
  }

  const duplicatePrivate = async () => {
    if (!project?.id || sharingBusy) return
    setSharingBusy(true)
    try {
      const copy = await api.duplicateSharedProject(project.id)
      await onProjectListChange()
      toast.success(`${copy.project_name} created`)
      onBack()
    } catch (error: any) {
      toast.error(error?.message || 'Could not create private copy')
    } finally {
      setSharingBusy(false)
    }
  }

  const leaveProject = async () => {
    if (!project?.id || sharingBusy) return
    setSharingBusy(true)
    try {
      await api.leaveSharedProject(project.id)
      await onProjectListChange()
      toast.success('Left shared project')
      onBack()
    } catch (error: any) {
      toast.error(error?.message || 'Could not leave shared project')
    } finally {
      setSharingBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl animate-fade-in pb-24">
      <div className="mb-6 flex items-start justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="mt-0.5 h-8 w-8" onClick={onBack} aria-label="Back to workspace">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Project Settings</h1>
            <p className="mt-1 text-xs text-muted-foreground">Manage {project?.name || 'this project'}, sharing, and integrations.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving || isViewer}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-card/30 p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold">General</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">The name teammates see when this project is shared.</p>
            </div>
            <Label className="text-xs">Project Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" disabled={isViewer}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }} />
            {isViewer ? <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">Viewer access: shared project source is read-only on this device.</p> : null}
          </section>

          <section className="overflow-hidden rounded-xl border border-blue-500/20 bg-blue-500/[0.035]">
            <div className="flex items-start justify-between gap-4 p-4">
              <div className="flex min-w-0 gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Radio className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">Local project sharing</h3>
                    <span className={cn(
                      'rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide',
                      sharingStatus?.sharing_enabled
                        ? 'border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        : 'border-border bg-muted/50 text-muted-foreground',
                    )}>
                      {sharingStatusLoading ? 'Checking' : sharingStatus?.sharing_enabled ? 'Source ready' : 'Private'}
                    </span>
                  </div>
                  <p className="mt-1 max-w-[48ch] text-[11px] leading-relaxed text-muted-foreground">
                    Share only this project's source. Requests, responses, history, and private variable values stay on each device.
                  </p>
                </div>
              </div>
              {!isMember ? (
                <Button type="button" size="sm" variant={sharingStatus?.sharing_enabled ? 'outline' : 'default'}
                  className="h-8 shrink-0" disabled={!project?.id || sharingBusy || sharingStatusLoading} onClick={toggleSharing}>
                  {sharingBusy || sharingStatusLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
                  {sharingStatusLoading ? 'Checking' : sharingStatus?.sharing_enabled ? 'Stop sharing' : 'Enable sharing'}
                </Button>
              ) : (
                <span className="rounded-md border border-blue-500/25 bg-blue-500/10 px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase text-blue-600 dark:text-blue-400">
                  {sharingStatus.member?.role}
                </span>
              )}
            </div>

            {sharingError ? <div className="border-t border-red-500/20 bg-red-500/5 px-4 py-2.5 text-[11px] text-red-500">{sharingError}</div> : null}

            {sharingStatus?.sharing_enabled ? (
              <div className="border-t border-blue-500/15">
                <div className="grid grid-cols-3 divide-x divide-blue-500/15">
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><Radio className="h-3 w-3" /> Shared project</div>
                    <div className="mt-1 truncate text-xs font-semibold">{sharingStatus.host?.project_name || project?.name}</div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><Laptop className="h-3 w-3" /> Host device</div>
                    <div className="mt-1 truncate text-xs font-medium">{sharingStatus.member?.host_address || sharingStatus.host?.host_device_name || 'Starting host'}</div>
                    {!isMember && sharingStatus.host?.hosting ? (
                      <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
                        {sharingStatus.host.host_device_ip} · {sharingStatus.host.host_device_id}
                      </div>
                    ) : null}
                  </div>
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><History className="h-3 w-3" /> Source revision</div>
                    <div className="mt-1 font-mono text-sm font-semibold">r{sharingStatus.revision}</div>
                  </div>
                </div>

                {isMember ? (
                  <div className="grid grid-cols-2 gap-3 border-t border-blue-500/15 px-4 py-3">
                    <div>
                      <div className="text-[10px] text-muted-foreground">Connection</div>
                      <div className="mt-1 text-xs font-semibold capitalize">{sharingStatus.member?.connection_state?.replace('_', ' ') || 'connected'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Permission</div>
                      <div className="mt-1 text-xs font-semibold capitalize">{sharingStatus.member?.role}</div>
                    </div>
                    {sharingStatus.member?.sync_error ? <p className="col-span-2 text-[10px] text-red-500">{sharingStatus.member.sync_error}</p> : null}
                  </div>
                ) : sharingStatus.host?.hosting ? (
                  <div className="grid gap-3 border-t border-blue-500/15 px-4 py-3 sm:grid-cols-[1fr_180px]">
                    <div>
                      <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">Host address</div>
                      <button type="button" onClick={() => copyValue(sharingStatus.host?.address || '', 'Host address')}
                        className="flex h-9 w-full items-center justify-between rounded-md border border-blue-500/20 bg-background/60 px-3 font-mono text-xs transition-colors hover:border-blue-500/40">
                        <span>{sharingStatus.host.address}</span><Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                        <span>Pairing code</span>
                        <button type="button" onClick={refreshPairingCode} className="hover:text-foreground" title="Generate a new code"><RefreshCw className="h-3 w-3" /></button>
                      </div>
                      <button type="button" onClick={() => copyValue(sharingStatus.host?.pairing_code || '', 'Pairing code')}
                        className="flex h-9 w-full items-center justify-between rounded-md border border-blue-500/25 bg-blue-500/10 px-3 font-mono text-base font-bold tracking-[0.22em] text-blue-600 transition-colors hover:bg-blue-500/15 dark:text-blue-400">
                        <span>{sharingStatus.host.pairing_code}</span><Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="border-t border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[11px] text-amber-600 dark:text-amber-400">
                    Source is prepared, but this build cannot open the LAN host. Use a debug desktop build until encrypted release transport is ready.
                  </div>
                )}

                {!isMember ? <div className="border-t border-blue-500/15 px-4 py-3">
                  {sharingStatus.host?.pending_requests?.length ? (
                    <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Approval requested</div>
                      {sharingStatus.host.pending_requests.map((request) => (
                        <div key={request.request_id} className="flex flex-wrap items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold">{request.device_name}</div>
                            <div className="truncate font-mono text-[9px] text-muted-foreground">{request.device_ip || 'IP unavailable'} · {request.device_id}</div>
                          </div>
                          <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={sharingBusy}
                            onClick={() => decidePairing(request.request_id, false, 'viewer')}>Reject</Button>
                          <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={sharingBusy}
                            onClick={() => decidePairing(request.request_id, true, 'viewer')}>Viewer</Button>
                          <Button size="sm" className="h-7 text-[10px]" disabled={sharingBusy}
                            onClick={() => decidePairing(request.request_id, true, 'editor')}>Editor</Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Users className="h-3 w-3" /> Connected devices
                  </div>
                  {sharingStatus.host?.connected_members?.length ? sharingStatus.host.connected_members.map((member) => (
                    <div key={member.device_id} className="flex items-center justify-between gap-2 py-1 text-[11px]">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="block">{member.device_name}</span>
                        <span className="block font-mono text-[9px] text-muted-foreground">{member.device_ip || 'IP unavailable'} · {member.device_id}</span>
                      </span>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[9px]" disabled={sharingBusy}
                        onClick={() => updateMember(member.device_id, member.role === 'viewer' ? 'editor' : 'viewer')}>
                        {member.role}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[9px] text-red-500" disabled={sharingBusy}
                        onClick={() => updateMember(member.device_id)}>Revoke</Button>
                    </div>
                  )) : <p className="text-[11px] text-muted-foreground">No teammate has joined this project yet.</p>}
                </div> : null}

                {!isMember ? <div className="border-t border-blue-500/15 px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Source activity</span>
                    <span className="font-mono text-[9px] text-muted-foreground">project source only</span>
                  </div>
                  {revisionsLoading ? (
                    <div className="space-y-2" aria-label="Loading sharing activity">
                      <div className="h-6 animate-pulse rounded bg-muted/70" />
                      <div className="h-6 w-4/5 animate-pulse rounded bg-muted/50" />
                    </div>
                  ) : revisions.length ? (
                    <div className="space-y-1.5">
                      {revisions.map((revision) => (
                        <div key={revision.id} className="flex items-center gap-3 text-[11px]">
                          <span className="w-7 shrink-0 font-mono text-blue-600 dark:text-blue-400">r{revision.revision}</span>
                          <span className="min-w-0 flex-1 truncate text-foreground/90">
                            <span className="block truncate">{revision.summary}</span>
                            <span className="block truncate font-mono text-[9px] text-muted-foreground">
                              by {revision.actor_device_name || 'Beacon device'} · {revision.actor_device_ip || 'local'} · {revision.actor_device_id}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                            {new Date(revision.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-[11px] text-muted-foreground">The initial source revision will appear here.</p>}
                </div> : null}

                <div className="flex items-center gap-1.5 border-t border-amber-500/15 bg-amber-500/5 px-4 py-2.5 text-[10px] text-amber-600 dark:text-amber-400">
                  <ShieldCheck className="h-3 w-3" /> Local authenticated transport. Use sharing only on a trusted network.
                </div>
                {isMember ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-blue-500/15 px-4 py-3">
                    <p className="text-[10px] text-muted-foreground">Keep a private copy before leaving if you want to retain this snapshot.</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={sharingBusy} onClick={duplicatePrivate}>Make private copy</Button>
                      <Button size="sm" variant="outline" className="h-7 text-[10px] text-red-500" disabled={sharingBusy} onClick={leaveProject}>Leave project</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

        </div>

        <aside className="space-y-5 lg:sticky lg:top-4">
          <section className="space-y-3 rounded-xl border border-border bg-card/30 p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Discord notifications</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Post finished run results to a channel.</p>

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
          </section>

          <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
            <div className="text-xs font-medium text-red-500 mb-1">Danger zone</div>
            <p className="text-[11px] text-muted-foreground mb-2">Deleting a project removes all its environments and endpoints.</p>
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => onDelete()}>
              <Trash2 className="h-3.5 w-3.5" /> Delete Project
            </Button>
          </section>
        </aside>
      </div>
    </div>
  )
}
