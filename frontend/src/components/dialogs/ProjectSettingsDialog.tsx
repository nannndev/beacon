import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Trash2, Send, Loader2, CheckCircle2, AlertTriangle, BellOff, Radio, ShieldCheck, Laptop, History, Copy, RefreshCw, Users, ArrowLeft, ArrowRight, FolderGit2, FolderOpen, Unlink, FileDiff, GitCommitHorizontal, GitPullRequestArrow, Upload, GitBranch, GitFork, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '../../lib/api'
import { toast } from '../ui/toast'
import { Project, ProjectNotifications, NotifyMode, ProjectRevision, SharingStatus, ProjectFileSyncStatus, ProjectGitStatus, ProjectGitDiff, ProjectGitBranches, ProjectGitBranchComparison } from '../../types'
import { isDesktop } from '../../lib/platform'

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

// Loosely matches webhook URLs so we can disable the test button.
const DISCORD_WEBHOOK_RE = /^https:\/\/([\w-]+\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i
const SLACK_WEBHOOK_RE = /^https:\/\/hooks\.slack\.com\/services\/[\w-]+\/[\w-]+\/[\w-]+/i

export function ProjectSettingsPage({ onBack, project, sharingStatus, sharingStatusLoading = false, onSharingStatusChange, onSave, onDelete, onProjectListChange }: Props) {
  const [name, setName] = useState('')
  const [discordWebhook, setDiscordWebhook] = useState('')
  const [slackWebhook, setSlackWebhook] = useState('')
  const [mode, setMode] = useState<NotifyMode>('off')
  const [testingDiscord, setTestingDiscord] = useState(false)
  const [testingSlack, setTestingSlack] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sharingBusy, setSharingBusy] = useState(false)
  const [sharingError, setSharingError] = useState('')
  const [revisions, setRevisions] = useState<ProjectRevision[]>([])
  const [revisionsLoading, setRevisionsLoading] = useState(false)
  const [conflictChoices, setConflictChoices] = useState<Record<string, 'team' | 'mine'>>({})
  const [fileSync, setFileSync] = useState<ProjectFileSyncStatus | null>(null)
  const [fileSyncBusy, setFileSyncBusy] = useState(false)
  const [gitStatus, setGitStatus] = useState<ProjectGitStatus | null>(null)
  const [gitBusy, setGitBusy] = useState('')
  const [gitRemote, setGitRemote] = useState('')
  const [gitBranches, setGitBranches] = useState<ProjectGitBranches | null>(null)
  const [selectedBranch, setSelectedBranch] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [branchComparison, setBranchComparison] = useState<ProjectGitBranchComparison | null>(null)
  const [branchComparisonLoading, setBranchComparisonLoading] = useState(false)
  const branchComparisonRequest = useRef(0)
  const [commitMessage, setCommitMessage] = useState('')
  const [gitDiff, setGitDiff] = useState<ProjectGitDiff | null>(null)
  const [gitDiffScope, setGitDiffScope] = useState<'working' | 'last_commit'>('working')
  const [gitDiffPath, setGitDiffPath] = useState('')
  const [gitDiffLoading, setGitDiffLoading] = useState(false)
  const [gitDiffOpen, setGitDiffOpen] = useState(false)
  const isMember = Boolean(sharingStatus?.member)
  const isViewer = sharingStatus?.member?.role === 'viewer'

  useEffect(() => {
    setName(project?.name || '')
    setDiscordWebhook(project?.notifications?.discord_webhook || '')
    setSlackWebhook(project?.notifications?.slack_webhook || '')
    setMode(project?.notifications?.mode || 'off')
    setGitDiff(null)
    setGitDiffOpen(false)
    setGitDiffPath('')
    setBranchComparison(null)
  }, [project])

  useEffect(() => {
    setConflictChoices({})
  }, [sharingStatus?.member?.conflict?.detected_at])

  useEffect(() => {
    if (!project?.id) { setFileSync(null); return }
    let cancelled = false
    api.projectFileSyncStatus(project.id)
      .then(async (status) => {
        if (cancelled) return
        setFileSync(status)
        if (status.linked) {
          try {
            const git = await api.projectGitStatus(project.id)
            if (!cancelled) {
              setGitStatus(git)
              setGitRemote(git.remote_url || '')
              if (git.repository) {
                try {
                  const branches = await api.projectGitBranches(project.id)
                  if (!cancelled) { setGitBranches(branches); setSelectedBranch(branches.current || '') }
                } catch {
                  if (!cancelled) setGitBranches(null)
                }
              } else setGitBranches(null)
            }
          } catch {
            if (!cancelled) { setGitStatus(null); setGitBranches(null) }
          }
        } else { setGitStatus(null); setGitBranches(null) }
      })
      .catch((error) => { if (!cancelled) setFileSync({ linked: Boolean(project.file_sync), path: project.file_sync?.path || null, state: 'write_error', last_synced_at: project.file_sync?.last_synced_at || null, changes: [], message: error?.message || 'Could not inspect linked project files' }) })
    return () => { cancelled = true }
  }, [project?.id, project?.file_sync?.path, project?.file_sync?.last_synced_at])

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

  const discordWebhookValid = DISCORD_WEBHOOK_RE.test(discordWebhook.trim())
  const slackWebhookValid = SLACK_WEBHOOK_RE.test(slackWebhook.trim())
  const sshGithubPath = gitRemote.match(/^git@github\.com:(.+)$/)?.[1]
  const suggestedHttpsRemote = sshGithubPath ? `https://github.com/${sshGithubPath}` : null
  const selectedGitDiff = gitDiff?.files.find((file) => file.path === gitDiffPath) || null

  const handleTestDiscord = async () => {
    if (!project?.id || !discordWebhookValid) return
    setTestingDiscord(true)
    try {
      const r = await api.testNotification(project.id, discordWebhook.trim())
      if (r.ok) toast.success('Test message sent — check your Discord channel')
      else toast.error(r.error || 'Could not reach that webhook')
    } catch (e: any) {
      toast.error(e?.message || 'Test failed')
    } finally {
      setTestingDiscord(false)
    }
  }

  const handleTestSlack = async () => {
    if (!project?.id || !slackWebhookValid) return
    setTestingSlack(true)
    try {
      const r = await api.testNotification(project.id, slackWebhook.trim())
      if (r.ok) toast.success('Test message sent — check your Slack channel')
      else toast.error(r.error || 'Could not reach that webhook')
    } catch (e: any) {
      toast.error(e?.message || 'Test failed')
    } finally {
      setTestingSlack(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave(name.trim(), { 
        discord_webhook: discordWebhook.trim(), 
        slack_webhook: slackWebhook.trim(), 
        mode 
      })
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

  const resolveConflict = async (resolution: 'team' | 'mine' | 'merge') => {
    if (!project?.id || sharingBusy) return
    setSharingBusy(true)
    try {
      const result = await api.resolveSharingConflict(project.id, resolution, resolution === 'merge' ? conflictChoices : undefined)
      onSharingStatusChange(result.status)
      await onProjectListChange()
      toast.success(resolution === 'team' ? 'Team version applied' : resolution === 'mine' ? 'Your changes applied to the latest revision' : 'Selected changes merged successfully')
    } catch (error: any) {
      toast.error(error?.message || 'Could not resolve sharing conflict')
    } finally {
      setSharingBusy(false)
    }
  }

  const retryConnection = async () => {
    if (!project?.id || sharingBusy) return
    setSharingBusy(true)
    try {
      const result = await api.syncSharedProject(project.id)
      onSharingStatusChange(result.status)
      if (result.changed) await onProjectListChange()
      if (result.status.member?.connection_state === 'connected') toast.success('Reconnected to sharing host')
      else toast.info('Host is still unavailable; your local snapshot is safe')
    } catch (error: any) {
      toast.error(error?.message || 'Could not reach sharing host')
    } finally {
      setSharingBusy(false)
    }
  }

  const linkProjectFolder = async () => {
    if (!project?.id || fileSyncBusy || !isDesktop()) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ directory: true, multiple: false, title: `Link ${project.name} to a folder` })
      if (!selected || Array.isArray(selected)) return
      setFileSyncBusy(true)
      const status = await api.linkProjectFolder(project.id, selected)
      setFileSync(status)
      const git = await api.projectGitStatus(project.id)
      setGitStatus(git)
      setGitRemote(git.remote_url || '')
      if (git.repository) {
        const branches = await api.projectGitBranches(project.id)
        setGitBranches(branches)
        setSelectedBranch(branches.current || '')
      }
      await onProjectListChange()
      toast.success('Project files linked — use any Git client to version this folder')
    } catch (error: any) {
      toast.error(error?.message || 'Could not link project folder')
    } finally {
      setFileSyncBusy(false)
    }
  }

  const refreshFileSync = async () => {
    if (!project?.id || fileSyncBusy) return
    setFileSyncBusy(true)
    try {
      setFileSync(await api.projectFileSyncStatus(project.id))
      const git = await api.projectGitStatus(project.id)
      setGitStatus(git)
      setGitRemote(git.remote_url || '')
      if (git.repository) {
        const branches = await api.projectGitBranches(project.id)
        setGitBranches(branches)
        setSelectedBranch(branches.current || '')
      }
    } catch (error: any) {
      toast.error(error?.message || 'Could not inspect project files')
    } finally {
      setFileSyncBusy(false)
    }
  }

  const reloadProjectFolder = async () => {
    if (!project?.id || fileSyncBusy || fileSync?.state === 'conflict') return
    setFileSyncBusy(true)
    try {
      const status = await api.reloadProjectFolder(project.id)
      setFileSync(status)
      await onProjectListChange()
      toast.success('External project changes loaded')
    } catch (error: any) {
      toast.error(error?.message || 'Could not reload project files')
    } finally {
      setFileSyncBusy(false)
    }
  }

  const unlinkProjectFolder = async () => {
    if (!project?.id || fileSyncBusy) return
    setFileSyncBusy(true)
    try {
      const status = await api.unlinkProjectFolder(project.id)
      setFileSync(status)
      setGitStatus(null)
      setGitBranches(null)
      await onProjectListChange()
      toast.success('Project unlinked; every file remains in the folder')
    } catch (error: any) {
      toast.error(error?.message || 'Could not unlink project folder')
    } finally {
      setFileSyncBusy(false)
    }
  }

  const runGitAction = async (label: string, action: () => Promise<ProjectGitStatus>, success: string) => {
    if (gitBusy) return
    setGitBusy(label)
    try {
      const status = await action()
      setGitStatus(status)
      setGitRemote(status.remote_url || gitRemote)
      if (status.repository && project?.id) {
        const branches = await api.projectGitBranches(project.id)
        setGitBranches(branches)
        setSelectedBranch(branches.current || '')
      }
      if (label === 'commit') setCommitMessage('')
      if (label === 'pull' && project?.id) {
        setFileSync(await api.projectFileSyncStatus(project.id))
        await onProjectListChange()
      }
      if (gitDiffOpen && project?.id) await loadGitDiff(gitDiffScope)
      toast.success(success)
    } catch (error: any) {
      toast.error(error?.message || `Git ${label} failed`)
    } finally {
      setGitBusy('')
    }
  }

  const refreshBranches = async (fetchRemote = false) => {
    if (!project?.id || gitBusy) return
    setGitBusy(fetchRemote ? 'fetch' : 'branches')
    try {
      const branches = fetchRemote
        ? await api.fetchProjectGitBranches(project.id)
        : await api.projectGitBranches(project.id)
      setGitBranches(branches)
      setSelectedBranch(branches.current || '')
      setBranchComparison(null)
      setGitStatus(await api.projectGitStatus(project.id))
      toast.success(fetchRemote ? 'Remote branches fetched' : 'Branches refreshed')
    } catch (error: any) {
      toast.error(error?.message || 'Could not refresh branches')
    } finally {
      setGitBusy('')
    }
  }

  const createBranch = async () => {
    if (!project?.id || gitBusy || !newBranchName.trim()) return
    setGitBusy('create-branch')
    try {
      const branches = await api.createProjectGitBranch(project.id, newBranchName.trim())
      setGitBranches(branches)
      setSelectedBranch(branches.current || '')
      setBranchComparison(null)
      setNewBranchName('')
      setGitStatus(await api.projectGitStatus(project.id))
      toast.success(`Created and switched to ${branches.current}`)
    } catch (error: any) {
      toast.error(error?.message || 'Could not create branch')
    } finally {
      setGitBusy('')
    }
  }

  const switchBranch = async () => {
    if (!project?.id || gitBusy || !selectedBranch || selectedBranch === gitBranches?.current) return
    setGitBusy('switch-branch')
    try {
      const branches = await api.switchProjectGitBranch(project.id, selectedBranch)
      setGitBranches(branches)
      setSelectedBranch(branches.current || '')
      setGitStatus(await api.projectGitStatus(project.id))
      setFileSync(await api.projectFileSyncStatus(project.id))
      setGitDiff(null)
      setGitDiffOpen(false)
      setBranchComparison(null)
      await onProjectListChange()
      toast.success(`Switched to ${branches.current}`)
    } catch (error: any) {
      toast.error(error?.message || 'Could not switch branch')
    } finally {
      setGitBusy('')
    }
  }

  const previewBranch = async (branch: string) => {
    setSelectedBranch(branch)
    const request = ++branchComparisonRequest.current
    if (!project?.id || !branch || branch === gitBranches?.current) {
      setBranchComparison(null)
      setBranchComparisonLoading(false)
      return
    }
    setBranchComparisonLoading(true)
    setBranchComparison(null)
    try {
      const comparison = await api.compareProjectGitBranch(project.id, branch)
      if (request === branchComparisonRequest.current) setBranchComparison(comparison)
    } catch (error: any) {
      if (request === branchComparisonRequest.current) toast.error(error?.message || 'Could not compare branches')
    } finally {
      if (request === branchComparisonRequest.current) setBranchComparisonLoading(false)
    }
  }

  const loadGitDiff = async (scope: 'working' | 'last_commit') => {
    if (!project?.id || gitDiffLoading) return
    setGitDiffLoading(true)
    setGitDiffScope(scope)
    setGitDiffOpen(true)
    try {
      const result = await api.projectGitDiff(project.id, scope)
      setGitDiff(result)
      setGitDiffPath((current) => result.files.some((file) => file.path === current) ? current : result.files[0]?.path || '')
    } catch (error: any) {
      toast.error(error?.message || 'Could not load Git diff')
    } finally {
      setGitDiffLoading(false)
    }
  }

  return (
    <div className="w-full animate-fade-in pb-24">
      <div className="mb-6 flex items-start gap-4 border-b border-border pb-5">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="mt-0.5 h-8 w-8" onClick={onBack} aria-label="Back to workspace">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Project Settings</h1>
            <p className="mt-1 text-xs text-muted-foreground">Manage {project?.name || 'this project'}, sharing, and integrations.</p>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-5 2xl:grid-cols-2">
        <div className="contents">
          <section className="order-1 rounded-xl border border-border bg-card/30 p-4">
            <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="sm:col-span-2">
                <h2 className="text-sm font-semibold">General</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">The name teammates see when this project is shared.</p>
              </div>
              <div>
                <Label className="text-xs">Project Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" disabled={isViewer}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }} />
              </div>
              <Button className="w-fit" onClick={handleSave} disabled={!name.trim() || saving || isViewer}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save changes
              </Button>
            </div>
            {isViewer ? <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">Viewer access: shared project source is read-only on this device.</p> : null}
          </section>

          <section className={cn('order-3 overflow-hidden rounded-xl border border-violet-500/20 bg-violet-500/[0.035]', gitDiffOpen && '2xl:col-span-2')}>
            <div className="flex flex-wrap items-start gap-3 p-4">
              <div className="flex min-w-0 gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-400">
                  <FolderGit2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">Git-backed project files</h3>
                    <span className={cn(
                      'rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide',
                      fileSync?.state === 'clean' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : ['external_changes', 'conflict'].includes(fileSync?.state || '') ? 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : fileSync?.linked ? 'border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400'
                            : 'border-border bg-muted/50 text-muted-foreground',
                    )}>{fileSync?.state?.replaceAll('_', ' ') || 'checking'}</span>
                  </div>
                  <p className="mt-1 max-w-[52ch] text-[11px] leading-relaxed text-muted-foreground">
                    Store endpoints, folders, assertions, and environments as readable YAML. Commit them with GitHub Desktop, your IDE, or Git CLI—no Beacon account required.
                  </p>
                </div>
              </div>
              {!fileSync?.linked ? (
                <Button type="button" size="sm" className="h-8 shrink-0" disabled={!project?.id || fileSyncBusy || !isDesktop()} onClick={linkProjectFolder}
                  title={isDesktop() ? 'Choose an empty folder' : 'Folder linking is available in Beacon Desktop'}>
                  {fileSyncBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                  Link folder
                </Button>
              ) : (
                <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" disabled={fileSyncBusy} onClick={refreshFileSync}>
                  <RefreshCw className={cn('h-3.5 w-3.5', fileSyncBusy && 'animate-spin')} /> Refresh
                </Button>
              )}
            </div>

            {fileSync?.linked ? (
              <div className="border-t border-violet-500/15">
                <div className="grid gap-px bg-violet-500/15 sm:grid-cols-[minmax(0,1fr)_180px]">
                  <div className="min-w-0 bg-background/65 px-4 py-3">
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Linked folder</div>
                    <div className="mt-1 truncate font-mono text-[10px]" title={fileSync.path || ''}>{fileSync.path}</div>
                  </div>
                  <div className="bg-background/65 px-4 py-3">
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Last synced</div>
                    <div className="mt-1 text-[10px] font-medium">{fileSync.last_synced_at ? new Date(fileSync.last_synced_at).toLocaleString() : 'Not yet'}</div>
                  </div>
                </div>
                <div className={cn(
                  'flex items-start gap-2 border-t px-4 py-3 text-[11px]',
                  fileSync.state === 'clean' ? 'border-emerald-500/15 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                    : ['external_changes', 'conflict'].includes(fileSync.state) ? 'border-amber-500/15 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                      : 'border-red-500/15 bg-red-500/5 text-red-600 dark:text-red-400',
                )}>
                  {fileSync.state === 'clean' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <FileDiff className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div>{fileSync.message}</div>
                    {fileSync.changes.length ? (
                      <div className="mt-2 space-y-1">
                        {fileSync.changes.slice(0, 6).map((change) => (
                          <div key={`${change.kind}:${change.path}`} className="flex gap-2 font-mono text-[9px]">
                            <span className="w-12 shrink-0 uppercase opacity-75">{change.kind}</span>
                            <span className="truncate" title={change.path}>{change.path}</span>
                          </div>
                        ))}
                        {fileSync.changes.length > 6 ? <div className="text-[9px] opacity-75">+{fileSync.changes.length - 6} more files</div> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                {gitStatus ? (
                  <div className="border-t border-violet-500/15 bg-background/35 p-4">
                    {!gitStatus.available ? (
                      <div className="text-[11px] text-amber-600 dark:text-amber-400">{gitStatus.message}</div>
                    ) : !gitStatus.repository ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold">Start versioning this project</div>
                          <p className="mt-1 text-[10px] text-muted-foreground">Creates a local Git repository on the <span className="font-mono">main</span> branch.</p>
                        </div>
                        <Button type="button" size="sm" className="h-8" disabled={Boolean(gitBusy)}
                          onClick={() => project?.id && runGitAction('init', () => api.initProjectGit(project.id), 'Git repository initialized')}>
                          {gitBusy === 'init' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderGit2 className="h-3.5 w-3.5" />} Initialize Git
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {gitBusy ? (
                          <div className="flex items-center gap-2 rounded-md border border-blue-500/20 bg-blue-500/[0.06] px-3 py-2 text-[10px] text-blue-700 dark:text-blue-300" role="status">
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                            <span>{gitBusy === 'push' ? `Connecting to origin and publishing ${gitStatus.branch || 'branch'}…`
                              : gitBusy === 'pull' ? 'Downloading remote changes and validating Beacon files…'
                                : gitBusy === 'commit' ? 'Creating a local commit…'
                                  : gitBusy === 'remote' ? 'Validating and saving origin…'
                                    : 'Refreshing repository state…'}</span>
                          </div>
                        ) : null}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-[10px]">
                            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-1 font-mono"><GitBranch className="h-3 w-3" />{gitStatus.branch || 'detached'}</span>
                            {gitStatus.upstream ? <span className="text-muted-foreground">↑ {gitStatus.ahead} · ↓ {gitStatus.behind}</span> : <span className="text-amber-600 dark:text-amber-400">Not published yet</span>}
                            <span className={gitStatus.changes.length ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>{gitStatus.message}</span>
                          </div>
                          <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px]" disabled={Boolean(gitBusy)}
                            onClick={() => project?.id && runGitAction('refresh', () => api.projectGitStatus(project.id), 'Git status refreshed')}>
                            <RefreshCw className={cn('h-3 w-3', gitBusy === 'refresh' && 'animate-spin')} /> Refresh Git
                          </Button>
                        </div>

                        <div className="rounded-lg border border-violet-500/15 bg-background/45 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5 text-xs font-semibold"><GitFork className="h-3.5 w-3.5 text-violet-500" /> Branches</div>
                              <p className="mt-0.5 text-[9px] text-muted-foreground">Each branch keeps a version of this same Beacon project.</p>
                            </div>
                            <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px]" disabled={Boolean(gitBusy) || !gitStatus.remote_url}
                              title={gitStatus.remote_url ? 'Fetch branch names from origin' : 'Add an origin remote before fetching'}
                              onClick={() => refreshBranches(true)}>
                              {gitBusy === 'fetch' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Fetch
                            </Button>
                          </div>
                          <div className="mt-2 grid gap-2 lg:grid-cols-2">
                            <div className="flex min-w-0 gap-2">
                              <select value={selectedBranch} onChange={(event) => previewBranch(event.target.value)}
                                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[10px] outline-none focus:ring-1 focus:ring-ring"
                                aria-label="Git branch" disabled={Boolean(gitBusy)}>
                                {gitBranches?.local.map((branch) => (
                                  <option key={`local:${branch.full_name}`} value={branch.full_name}>{branch.current ? '● ' : ''}{branch.name}</option>
                                ))}
                                {gitBranches?.remote.filter((branch) => !branch.local_name).map((branch) => (
                                  <option key={`remote:${branch.full_name}`} value={branch.full_name}>↳ {branch.full_name}</option>
                                ))}
                              </select>
                              <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" disabled={Boolean(gitBusy) || !selectedBranch || selectedBranch === gitBranches?.current}
                                onClick={switchBranch}>
                                {gitBusy === 'switch-branch' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />} Switch
                              </Button>
                            </div>
                            <div className="flex min-w-0 gap-2">
                              <Input value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)}
                                onKeyDown={(event) => { if (event.key === 'Enter') createBranch() }}
                                className="h-8 min-w-0 flex-1 font-mono text-[10px]" maxLength={200} placeholder="feature/auth-flow" />
                              <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" disabled={Boolean(gitBusy) || !newBranchName.trim()}
                                onClick={createBranch}>
                                {gitBusy === 'create-branch' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create
                              </Button>
                            </div>
                          </div>
                          {branchComparisonLoading ? (
                            <div className="mt-2 flex h-20 items-center justify-center gap-2 rounded-md border border-dashed border-violet-500/20 text-[10px] text-muted-foreground" role="status">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Comparing project files…
                            </div>
                          ) : branchComparison ? (
                            <div className="mt-2 overflow-hidden rounded-md border border-violet-500/20 bg-background/60">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                                <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px]">
                                  <span className="truncate">{branchComparison.current}</span>
                                  <ArrowRight className="h-3 w-3 shrink-0 text-violet-500" />
                                  <span className="truncate text-violet-600 dark:text-violet-400">{branchComparison.target}</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5 text-[9px]">
                                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">+{branchComparison.summary.added} added</span>
                                  <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-400">{branchComparison.summary.modified} modified</span>
                                  <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-600 dark:text-red-400">−{branchComparison.summary.deleted} deleted</span>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border bg-muted/20 px-3 py-1.5 text-[9px] text-muted-foreground">
                                <span><strong className="text-foreground">{branchComparison.target_only_commits}</strong> incoming commit{branchComparison.target_only_commits === 1 ? '' : 's'}</span>
                                <span><strong className="text-foreground">{branchComparison.current_only_commits}</strong> current-only commit{branchComparison.current_only_commits === 1 ? '' : 's'}</span>
                              </div>
                              {branchComparison.files.length ? (
                                <div className="max-h-40 overflow-auto p-1.5" aria-label="Branch file comparison">
                                  {branchComparison.files.map((file) => (
                                    <div key={`${file.status}:${file.path}`} className="flex items-center gap-2 rounded px-2 py-1.5 text-[9px] hover:bg-muted/35">
                                      <span className={cn('w-4 shrink-0 text-center font-mono font-bold uppercase', file.status === 'added' ? 'text-emerald-500' : file.status === 'deleted' ? 'text-red-500' : 'text-amber-500')}>
                                        {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>{file.path}</span>
                                      <span className="shrink-0 font-mono"><span className="text-emerald-500">+{file.additions}</span> <span className="text-red-500">−{file.deletions}</span></span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="px-3 py-3 text-center text-[9px] text-muted-foreground">Project files are identical on both branches.</div>
                              )}
                            </div>
                          ) : null}
                          <p className="mt-2 text-[9px] text-muted-foreground">Switch is allowed only when the entire repository is clean. Beacon verifies the destination branch belongs to this project, then reloads its YAML.</p>
                        </div>

                        <div className="flex max-w-5xl flex-wrap gap-2">
                          <Input value={gitRemote} onChange={(event) => setGitRemote(event.target.value)} className="h-8 min-w-[260px] flex-1 font-mono text-[10px]" placeholder="git@github.com:team/project.git" />
                          {suggestedHttpsRemote ? (
                            <Button type="button" size="sm" variant="secondary" className="h-8" disabled={Boolean(gitBusy)}
                              title="Use GitHub CLI or system credential-manager authentication"
                              onClick={() => setGitRemote(suggestedHttpsRemote)}>Use HTTPS</Button>
                          ) : null}
                          <Button type="button" size="sm" variant="outline" className="h-8" disabled={Boolean(gitBusy) || !gitRemote.trim()}
                            onClick={() => project?.id && runGitAction('remote', () => api.setProjectGitRemote(project.id, gitRemote), 'Origin remote saved')}>Save origin</Button>
                        </div>
                        {suggestedHttpsRemote ? <p className="text-[9px] text-amber-600 dark:text-amber-400">SSH origin requires a GitHub-registered SSH key. Use HTTPS to reuse GitHub CLI credentials on this device.</p> : null}

                        <div className="flex max-w-6xl flex-wrap gap-2">
                          <Input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} className="h-8 min-w-[240px] flex-1 text-[11px]" maxLength={200} placeholder="Describe this project change" />
                          <Button type="button" size="sm" variant="outline" className="h-8" disabled={Boolean(gitBusy) || !commitMessage.trim() || !gitStatus.changes.length}
                            onClick={() => project?.id && runGitAction('commit', () => api.commitProjectGit(project.id, commitMessage), 'Beacon project changes committed')}>
                            {gitBusy === 'commit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommitHorizontal className="h-3.5 w-3.5" />} Commit
                          </Button>
                          <Button type="button" size="sm" variant="outline" className="h-8" disabled={Boolean(gitBusy) || !gitStatus.upstream || Boolean(gitStatus.changes.length)}
                            title={gitStatus.changes.length ? 'Commit local changes before pulling' : 'Pull fast-forward changes from the upstream branch'}
                            onClick={() => project?.id && runGitAction('pull', () => api.pullProjectGit(project.id), 'Remote changes pulled and loaded into Beacon')}>
                            {gitBusy === 'pull' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitPullRequestArrow className="h-3.5 w-3.5" />} Pull
                          </Button>
                          <Button type="button" size="sm" className="h-8" disabled={Boolean(gitBusy) || !gitStatus.remote_url || Boolean(gitStatus.changes.length)}
                            title={gitStatus.changes.length ? 'Commit local changes before pushing' : 'Push the current branch to origin'}
                            onClick={() => project?.id && runGitAction('push', () => api.pushProjectGit(project.id), 'Project pushed to origin')}>
                            {gitBusy === 'push' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Push
                          </Button>
                        </div>
                        <p className="text-[9px] text-muted-foreground">Beacon commits only project YAML and <span className="font-mono">.gitignore</span>. Authentication uses this device's SSH key or Git credential manager. Pull is fast-forward only.</p>

                        <div className="overflow-hidden rounded-lg border border-border bg-background/55">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                            <div className="flex items-center gap-1">
                              <Button type="button" size="sm" variant={gitDiffOpen && gitDiffScope === 'working' ? 'secondary' : 'ghost'} className="h-7 text-[10px]"
                                disabled={gitDiffLoading} onClick={() => loadGitDiff('working')}>
                                <FileDiff className="h-3 w-3" /> Changes <span className="font-mono text-[9px]">{gitStatus.changes.length}</span>
                              </Button>
                              <Button type="button" size="sm" variant={gitDiffOpen && gitDiffScope === 'last_commit' ? 'secondary' : 'ghost'} className="h-7 text-[10px]"
                                disabled={gitDiffLoading} onClick={() => loadGitDiff('last_commit')}>
                                <History className="h-3 w-3" /> Last commit
                              </Button>
                            </div>
                            {gitDiffOpen ? (
                              <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setGitDiffOpen(false)}>Close diff</Button>
                            ) : <span className="text-[9px] text-muted-foreground">Review exactly what changed before committing</span>}
                          </div>

                          {gitDiffOpen ? (
                            gitDiffLoading ? (
                              <div className="flex h-40 items-center justify-center gap-2 text-[10px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Building diff…</div>
                            ) : gitDiff ? (
                              <>
                                {gitDiff.commit ? (
                                  <div className="border-b border-border bg-muted/20 px-3 py-2">
                                    <div className="flex flex-wrap items-center gap-2 text-[10px]"><span className="font-mono text-violet-600 dark:text-violet-400">{gitDiff.commit.short_id}</span><span className="font-semibold">{gitDiff.commit.subject}</span></div>
                                    <div className="mt-0.5 text-[9px] text-muted-foreground">{gitDiff.commit.author} · {new Date(gitDiff.commit.committed_at).toLocaleString()}</div>
                                  </div>
                                ) : null}
                                {gitDiff.files.length ? (
                                  <div className="grid min-h-[260px] max-h-[440px] md:grid-cols-[220px_minmax(0,1fr)]">
                                    <div className="overflow-auto border-b border-border p-1.5 md:border-b-0 md:border-r">
                                      {gitDiff.files.map((file) => (
                                        <button type="button" key={`${file.status}:${file.path}`} onClick={() => setGitDiffPath(file.path)}
                                          className={cn('mb-1 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors', gitDiffPath === file.path ? 'bg-violet-500/10 text-foreground' : 'text-muted-foreground hover:bg-muted/50')}>
                                          <span className={cn('mt-0.5 w-5 shrink-0 rounded px-1 py-0.5 text-center font-mono text-[8px] font-bold', file.status.includes('A') || file.status === '??' ? 'bg-emerald-500/10 text-emerald-500' : file.status.includes('D') ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500')}>{file.status === '??' ? 'A' : file.status.trim()}</span>
                                          <span className="min-w-0 flex-1">
                                            <span className="block truncate font-mono text-[9px]" title={file.path}>{file.path}</span>
                                            <span className="mt-0.5 block font-mono text-[8px]"><span className="text-emerald-500">+{file.additions}</span> <span className="text-red-500">−{file.deletions}</span></span>
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                    <div className="min-w-0 overflow-auto bg-[#0b0d10]">
                                      {selectedGitDiff?.patch ? (
                                        <pre className="min-w-max p-3 font-mono text-[9px] leading-5 text-slate-300" aria-label={`Diff for ${selectedGitDiff.path}`}>
                                          {selectedGitDiff.patch.split('\n').map((line, index) => (
                                            <span key={index} className={cn('block px-2', line.startsWith('+') && !line.startsWith('+++') ? 'bg-emerald-500/10 text-emerald-300' : line.startsWith('-') && !line.startsWith('---') ? 'bg-red-500/10 text-red-300' : line.startsWith('@@') ? 'bg-blue-500/10 text-blue-300' : line.startsWith('diff ') || line.startsWith('index ') ? 'text-slate-500' : '')}>{line || ' '}</span>
                                          ))}
                                        </pre>
                                      ) : <div className="flex h-full min-h-[220px] items-center justify-center text-[10px] text-muted-foreground">Select a file to inspect its patch</div>}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex h-36 flex-col items-center justify-center gap-1 text-center">
                                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                    <div className="text-xs font-medium">No uncommitted Beacon changes</div>
                                    <div className="text-[9px] text-muted-foreground">Open Last commit to review what was published.</div>
                                  </div>
                                )}
                              </>
                            ) : null
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3 border-t border-violet-500/15 px-4 py-3">
                  <p className="text-[10px] text-muted-foreground">Private values live under <span className="font-mono">.beacon/</span> and are added to <span className="font-mono">.gitignore</span>.</p>
                  <div className="flex gap-2">
                    {fileSync.state === 'external_changes' ? (
                      <Button type="button" size="sm" className="h-7 text-[10px]" disabled={fileSyncBusy} onClick={reloadProjectFolder}>Reload from folder</Button>
                    ) : null}
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px] text-red-500" disabled={fileSyncBusy} onClick={unlinkProjectFolder}>
                      <Unlink className="h-3 w-3" /> Unlink
                    </Button>
                  </div>
                </div>
                {fileSync.state === 'conflict' ? (
                  <div className="border-t border-amber-500/20 bg-amber-500/[0.07] px-4 py-3 text-[10px] text-amber-700 dark:text-amber-300">
                    Beacon and the folder both changed. Automatic writes are paused. Keep the files safe and unlink for now; field-level resolution arrives in phase 2.
                  </div>
                ) : null}
              </div>
            ) : !isDesktop() ? (
              <div className="border-t border-violet-500/15 px-4 py-3 text-[10px] text-muted-foreground">Open Beacon Desktop to link a local folder.</div>
            ) : null}
          </section>

          <section className={cn('order-4 overflow-hidden rounded-xl border border-blue-500/20 bg-blue-500/[0.035]', gitDiffOpen && '2xl:col-span-2')}>
            <div className="flex flex-wrap items-start gap-3 p-4">
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
                    <div className="mt-0.5 truncate font-mono text-[8px] text-muted-foreground" title={sharingStatus.member?.certificate_fingerprint || sharingStatus.host?.certificate_fingerprint}>
                      TLS {sharingStatus.member?.certificate_fingerprint || sharingStatus.host?.certificate_fingerprint || 'starting…'}
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><History className="h-3 w-3" /> Source revision</div>
                    <div className="mt-1 font-mono text-sm font-semibold">r{sharingStatus.revision}</div>
                  </div>
                </div>

                {isMember && sharingStatus.member?.conflict ? (
                  <div className="border-t border-red-500/25 bg-red-500/[0.055] p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-md bg-red-500/10 p-2 text-red-500"><AlertTriangle className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold text-red-600 dark:text-red-400">Source changes need your decision</h4>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          Team source advanced to r{sharingStatus.member.conflict.current_revision} while this device had unsynced edits.
                          Requests still run locally, but source sync is paused until this is resolved.
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-md border border-border bg-background/60 p-3">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Team version</div>
                            <div className="mt-1 truncate text-xs font-medium">{String(sharingStatus.member.conflict.team_source?.name || 'Latest shared source')}</div>
                            <p className="mt-1 text-[10px] text-muted-foreground">Discard this device's conflicting source edits.</p>
                          </div>
                          <div className="rounded-md border border-border bg-background/60 p-3">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">My version</div>
                            <div className="mt-1 truncate text-xs font-medium">{String(sharingStatus.member.conflict.local_source?.name || 'Local source')}</div>
                            <p className="mt-1 text-[10px] text-muted-foreground">Apply the complete local source on top of the latest revision.</p>
                          </div>
                        </div>
                        {(sharingStatus.member.conflict.fields?.length || 0) > 0 ? (
                          <div className="mt-3 space-y-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Conflicting fields</div>
                            {sharingStatus.member.conflict.fields!.map((field) => {
                              const display = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value)
                              return (
                                <div key={field.label} className="rounded-md border border-red-500/15 bg-background/55 p-3">
                                  <div className="mb-2 truncate font-mono text-[10px] font-semibold">{field.label || 'project source'}</div>
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <button type="button" onClick={() => setConflictChoices((current) => ({ ...current, [field.label]: 'team' }))}
                                      className={cn('rounded border p-2 text-left text-[10px]', conflictChoices[field.label] === 'team' ? 'border-blue-500 bg-blue-500/10' : 'border-border hover:border-blue-500/40')}>
                                      <span className="block font-semibold text-blue-600 dark:text-blue-400">Use team</span>
                                      <span className="mt-1 block max-h-16 overflow-auto break-all font-mono text-muted-foreground">{display(field.team_value)}</span>
                                    </button>
                                    <button type="button" onClick={() => setConflictChoices((current) => ({ ...current, [field.label]: 'mine' }))}
                                      className={cn('rounded border p-2 text-left text-[10px]', conflictChoices[field.label] === 'mine' ? 'border-violet-500 bg-violet-500/10' : 'border-border hover:border-violet-500/40')}>
                                      <span className="block font-semibold text-violet-600 dark:text-violet-400">Keep mine</span>
                                      <span className="mt-1 block max-h-16 overflow-auto break-all font-mono text-muted-foreground">{display(field.local_value)}</span>
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[10px] text-emerald-600 dark:text-emerald-400">
                            Beacon found no overlapping fields. These changes can be merged safely.
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" className="h-8 text-[11px]" disabled={sharingBusy} onClick={() => resolveConflict('team')}>Use team version</Button>
                          <Button size="sm" className="h-8 text-[11px]" disabled={sharingBusy || isViewer} onClick={() => resolveConflict('mine')}>Keep my version</Button>
                          <Button size="sm" variant="secondary" className="h-8 text-[11px]" disabled={sharingBusy || isViewer || (sharingStatus.member.conflict.fields || []).some((field) => !conflictChoices[field.label])}
                            onClick={() => resolveConflict('merge')}>{sharingStatus.member.conflict.fields?.length ? 'Merge selected fields' : 'Apply safe merge'}</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {isMember && ['host_offline', 'access_expired'].includes(sharingStatus.member?.connection_state || '') ? (
                  <div className="border-t border-amber-500/25 bg-amber-500/[0.06] p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-md bg-amber-500/10 p-2 text-amber-500"><AlertTriangle className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                          {sharingStatus.member.connection_state === 'access_expired' ? 'Host restarted — rejoin required' : 'Sharing host is offline'}
                        </h4>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          Your latest local snapshot remains available and requests can still run on this device. Source changes stay local until the connection returns.
                        </p>
                        {sharingStatus.member.offline_since ? (
                          <p className="mt-1 font-mono text-[9px] text-muted-foreground">Offline since {new Date(sharingStatus.member.offline_since).toLocaleString()} · {sharingStatus.member.retry_count || 0} retries</p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" className="h-8 text-[11px]" disabled={sharingBusy} onClick={retryConnection}>
                            {sharingBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Retry connection
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 text-[11px]" disabled={sharingBusy} onClick={duplicatePrivate}>Make private copy</Button>
                          <Button size="sm" variant="ghost" className="h-8 text-[11px] text-red-500" disabled={sharingBusy} onClick={leaveProject}>Leave project</Button>
                        </div>
                        {sharingStatus.member.connection_state === 'access_expired' ? (
                          <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">Ask the owner to enable sharing again, then leave and rejoin using the new address and pairing code.</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {isMember && sharingStatus.member?.connection_state === 'identity_changed' ? (
                  <div className="border-t border-red-500/30 bg-red-500/[0.07] p-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-md bg-red-500/10 p-2 text-red-500"><ShieldCheck className="h-4 w-4" /></div>
                      <div>
                        <h4 className="text-sm font-semibold text-red-600 dark:text-red-400">Host identity changed</h4>
                        <p className="mt-1 text-[11px] text-muted-foreground">Beacon stopped before sending credentials or project source. Confirm with the owner whether the host device was reinstalled. If legitimate, revoke this trust and pair again.</p>
                        <div className="mt-2 break-all font-mono text-[9px] text-muted-foreground">Pinned fingerprint: {sharingStatus.member.certificate_fingerprint}</div>
                        <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={duplicatePrivate}>Make private copy</Button><Button size="sm" variant="ghost" className="h-8 text-[11px] text-red-500" onClick={leaveProject}>Leave project</Button></div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {isMember ? (
                  <div className="grid grid-cols-2 gap-3 border-t border-blue-500/15 px-4 py-3">
                    <div>
                      <div className="text-[10px] text-muted-foreground">Connection</div>
                      <div className="mt-1 text-xs font-semibold capitalize">{sharingStatus.member?.connection_state?.replace('_', ' ') || 'connected'}</div>
                      {sharingStatus.member?.discovered_at ? <div className="mt-0.5 text-[9px] text-muted-foreground">Host auto-discovered · {new Date(sharingStatus.member.discovered_at).toLocaleTimeString()}</div> : null}
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
                            <div className="mt-0.5 text-[9px] text-muted-foreground">Beacon {request.app_version || 'unknown'} · {request.platform || 'unknown'} · protocol {request.protocol || 1}</div>
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
                        <span className="flex items-center gap-1.5"><span className={cn('h-1.5 w-1.5 rounded-full', member.connection_state === 'offline' ? 'bg-muted-foreground' : 'bg-emerald-500')} />{member.device_name}</span>
                        <span className="block font-mono text-[9px] text-muted-foreground">{member.device_ip || 'IP unavailable'} · {member.device_id}</span>
                        <span className="block text-[9px] text-muted-foreground">{member.connection_state || 'online'}{member.last_seen ? ` · last seen ${new Date(member.last_seen * 1000).toLocaleTimeString()}` : ''}</span>
                        {member.activity && member.active_target_name ? <span className="block truncate text-[9px] font-medium text-blue-600 dark:text-blue-400">{member.activity} {member.active_target_name}</span> : null}
                        <span className="block text-[9px] text-muted-foreground">Beacon {member.app_version || 'unknown'} · {member.platform || 'unknown'} · <span className={member.protocol === 2 ? 'text-emerald-500' : 'text-amber-500'}>{member.protocol === 2 ? 'compatible' : 'update required'}</span></span>
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

                {!isMember && sharingStatus.trusted_devices?.length ? (
                  <div className="border-t border-blue-500/15 px-4 py-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><ShieldCheck className="h-3 w-3" /> Trusted devices</div>
                    <div className="space-y-2">
                      {sharingStatus.trusted_devices.map((device) => {
                        const online = sharingStatus.host?.connected_members?.some((member) => member.device_id === device.device_id && member.connection_state !== 'offline')
                        return (
                          <div key={device.device_id} className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/40 p-2.5 text-[10px]">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 font-semibold"><span className={cn('h-1.5 w-1.5 rounded-full', online ? 'bg-emerald-500' : 'bg-muted-foreground')} />{device.device_name}</div>
                              <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">{device.device_ip || 'IP may change'} · {device.device_id}</div>
                              <div className="mt-0.5 text-[9px] text-muted-foreground">Last connected {new Date(device.last_seen_at).toLocaleString()}</div>
                              <div className="mt-0.5 text-[9px] text-muted-foreground">Beacon {device.app_version || 'unknown'} · {device.platform || 'unknown'} · <span className={device.protocol === 2 ? 'text-emerald-500' : 'text-amber-500'}>{device.protocol === 2 ? 'Compatible' : 'Update required'}</span></div>
                            </div>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[9px]" disabled={sharingBusy} onClick={() => updateMember(device.device_id, device.role === 'viewer' ? 'editor' : 'viewer')}>{device.role}</Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[9px] text-red-500" disabled={sharingBusy} onClick={() => updateMember(device.device_id)}>Revoke trust</Button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

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
                  <ShieldCheck className="h-3 w-3" /> HTTPS encrypted transport · pinned host fingerprint.
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

        <aside className="contents">
          <section className="order-2 space-y-3 rounded-xl border border-border bg-card/30 p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Run notifications</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Post finished run results to Discord or Slack channels.</p>

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
              <div className="space-y-4 pt-1">
                {/* Discord webhook input */}
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase text-muted-foreground">Discord Webhook</Label>
                  <div className="flex gap-1.5">
                    <Input
                      value={discordWebhook}
                      onChange={(e) => setDiscordWebhook(e.target.value)}
                      placeholder="https://discord.com/api/webhooks/..."
                      spellCheck={false}
                      className="h-8 text-xs font-mono"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 gap-1.5 px-2.5"
                      disabled={!discordWebhookValid || testingDiscord}
                      onClick={handleTestDiscord}
                    >
                      {testingDiscord ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Test
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Discord → Server Settings → Integrations → Webhooks → copy URL.
                    {discordWebhook.trim() && !discordWebhookValid && (
                      <span className="text-amber-500"> That doesn’t look like a Discord webhook URL.</span>
                    )}
                  </p>
                </div>

                {/* Slack webhook input */}
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase text-muted-foreground">Slack Webhook</Label>
                  <div className="flex gap-1.5">
                    <Input
                      value={slackWebhook}
                      onChange={(e) => setSlackWebhook(e.target.value)}
                      placeholder="https://hooks.slack.com/services/..."
                      spellCheck={false}
                      className="h-8 text-xs font-mono"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 gap-1.5 px-2.5"
                      disabled={!slackWebhookValid || testingSlack}
                      onClick={handleTestSlack}
                    >
                      {testingSlack ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Test
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Slack → Server Settings → Integrations → Webhooks → copy URL.
                    {slackWebhook.trim() && !slackWebhookValid && (
                      <span className="text-amber-500"> That doesn’t look like a Slack webhook URL.</span>
                    )}
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="order-5 rounded-xl border border-red-500/30 bg-red-500/5 p-4 2xl:col-span-2">
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
