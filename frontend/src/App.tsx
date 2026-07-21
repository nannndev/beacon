import { useState, useEffect } from 'react'
import { TestConfig, Project, Endpoint, RunConfig, CollectionItem, ProjectNotifications } from './types'
import { flattenItems, collectRequestsUnderFolder } from './lib/utils'
import { insertIntoFolder, renameItem, duplicateFolder, removeItem } from './lib/tree'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { EndpointTable } from './components/EndpointTable'
import { ExecutionControls, ExecSettings, DEFAULT_SETTINGS, settingsToConfig, configToSettings } from './components/ExecutionControls'
import LiveMonitor from './components/LiveMonitor'
import EndpointEditor from './components/EndpointEditor'
import { ProjectDialog } from './components/dialogs/ProjectDialog'
import { ImportDialog } from './components/dialogs/ImportDialog'
import { EnvironmentsDialog } from './components/dialogs/EnvironmentsDialog'
import { GlobalVarsDialog } from './components/dialogs/GlobalVarsDialog'
import { ProjectSettingsDialog } from './components/dialogs/ProjectSettingsDialog'
import { SettingsDialog } from './components/dialogs/SettingsDialog'
import { LoadingScreen } from './components/LoadingScreen'
import { McpPage } from './pages/McpPage'
import { CommandPalette, type Command } from './components/CommandPalette'
import { applyThemePref, resolveTheme } from './lib/theme'
import { FilePlus, FolderPlus, Play, ListVideo, Square, History as HistoryIcon, Plug as PlugIcon, SlidersHorizontal, Globe, Braces, Upload as UploadIcon, Download as DownloadIcon, SunMoon } from 'lucide-react'
import { ScenarioResultsDialog } from './components/ScenarioResultsDialog'
import type { ScenarioResult } from './lib/api'
import { useRun } from './hooks/useRun'
import { api } from './lib/api'
import { toast } from './components/ui/toast'
import Onboarding from './pages/Onboarding'
import { hasJsonPlaceholderSample } from './lib/sampleProject'
import { useAppView } from './hooks/useAppView'
import { HistoryPage } from './pages/HistoryPage'
import type { ModeParams, TestMode } from './types/testModes'
import { buildRunPayload } from './lib/modePayload'
import { useConfirmDialog } from './components/ui/confirm-dialog'

function loadGlobalSettings(): ExecSettings {
  try {
    const raw = localStorage.getItem('exec_settings')
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS
}

function App() {
  // First-run onboarding: shown once, then remembered in localStorage. This is
  // in-app onboarding — the marketing landing page lives in the separate
  // `landing/` project, not bundled here.
  const [showIntro, setShowIntro] = useState<boolean>(() => {
    try {
      return localStorage.getItem('beacon_onboarded') !== '1'
    } catch {
      return false
    }
  })

  const finishIntro = () => {
    try {
      localStorage.setItem('beacon_onboarded', '1')
    } catch {
      /* ignore */
    }
    setShowIntro(false)
  }

  const [config, setConfig] = useState<TestConfig>({ base_url: '', variables: {}, tests: [] })
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProjectId, setCurrentProjectId] = useState('')
  const [globalVariables, setGlobalVariables] = useState<Record<string, string>>({})
  const [initializing, setInitializing] = useState(true)
  const [initializationError, setInitializationError] = useState(false)
  const [retryToken, setRetryToken] = useState(0)

  const [showEditor, setShowEditor] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newEndpointFolderId, setNewEndpointFolderId] = useState<string | null>(null)

  const [showProjectDialog, setShowProjectDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem('sidebar_collapsed') === 'true')
  const [showEnvDialog, setShowEnvDialog] = useState(false)
  const [showGlobalDialog, setShowGlobalDialog] = useState(false)
  const [showProjectSettings, setShowProjectSettings] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null)
  const [sampleProjectBusy, setSampleProjectBusy] = useState(false)

  // Execution settings: a global default (persisted) + an active view that may
  // be a per-endpoint override.
  const [globalSettings, setGlobalSettings] = useState<ExecSettings>(loadGlobalSettings)
  const [settings, setSettings] = useState<ExecSettings>(globalSettings)
  const [overrideEnabled, setOverrideEnabled] = useState(false)
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null)

  const run = useRun()
  const appView = useAppView()
  const { confirm, confirmationDialog } = useConfirmDialog()

  const currentProject = projects.find((p) => p.id === currentProjectId)
  const currentEnv = currentProject?.environments?.find((e) => e.id === currentProject?.current_environment_id)
  const projectItems: CollectionItem[] = currentProject?.items || []
  const effectiveTests = flattenItems(projectItems).length ? flattenItems(projectItems) : (config.tests as Endpoint[])
  const selectedName = effectiveTests.find((t) => t.id === selectedTestId)?.name || (config.tests as any[]).find((t) => t.id === selectedTestId)?.name

  // The backend sidecar is launched and supervised by the Tauri Rust layer
  // (see src-tauri/src/main.rs), not from here — the React unmount cleanup did
  // not fire reliably on a hard window close, leaving orphan backend processes.

  useEffect(() => {
    let cancelled = false
    const bootstrap = async () => {
      setInitializing(true)
      setInitializationError(false)
      // The bundled Python sidecar can cold-start slowly on a first launch
      // (macOS Gatekeeper scanning a freshly-built binary, PyInstaller onefile
      // unpacking), so poll generously — ~30s — before surfacing an error.
      for (let attempt = 0; attempt < 60 && !cancelled; attempt += 1) {
        try {
          await fetchAll()
          if (!cancelled) setInitializing(false)
          return
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
      if (!cancelled) {
        setInitializing(false)
        setInitializationError(true)
      }
    }
    void bootstrap()
    return () => { cancelled = true }
  }, [retryToken])

  // ---- Data loading -----------------------------------------------------
  const fetchAll = async () => {
    const [data, nextConfig] = await Promise.all([api.listProjects(), api.getConfig()])
    setProjects(data.projects || [])
    setCurrentProjectId(data.current_project_id || '')
    setGlobalVariables(data.global_variables || {})
    setConfig(nextConfig)
  }
  const fetchConfig = async () => { try { setConfig(await api.getConfig()) } catch {} }

  // ---- Projects / environments -----------------------------------------
  const switchProject = async (id: string) => {
    if (id === currentProjectId) return
    if (showEditor) { setShowEditor(false); setEditingId(null) }
    setSelectedTestId(null)
    try {
      const data: any = await api.switchProject(id)
      if (data?.config) setConfig(data.config)
    } catch {}
    setCurrentProjectId(id)
    await fetchAll()
  }

  const switchEnv = async (envId: string) => {
    if (!currentProjectId) return
    try {
      const data: any = await api.switchEnvironment(currentProjectId, envId)
      if (data?.config) setConfig(data.config)
    } catch {}
    await fetchAll()
  }

  const createProject = async (name: string, base: string) => {
    try {
      const p = await api.createProject(name, base || undefined)
      setShowProjectDialog(false)
      await switchProject(p.id)
      toast.success('Project created')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create project')
    }
  }

  const addSampleProject = async () => {
    setSampleProjectBusy(true)
    try {
      const result = await api.addJsonPlaceholderSample()
      await fetchAll()
      setCurrentProjectId(result.project_id)
      setSelectedTestId(null)
      toast.success(
        result.created
          ? 'JSONPlaceholder sample project added'
          : 'JSONPlaceholder sample project opened',
      )
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add sample project')
    } finally {
      setSampleProjectBusy(false)
    }
  }

  const createFolder = async () => {
    if (!currentProjectId) return
    const folderName = window.prompt('New folder name', 'New Folder')
    if (!folderName) return
    const newFolder: any = {
      id: (crypto as any).randomUUID ? (crypto as any).randomUUID() : 'f-' + Date.now(),
      name: folderName,
      type: 'folder',
      items: [],
    }
    const currentItems = currentProject?.items || []
    const newItems = [...currentItems, newFolder]
    try {
      await api.updateProjectItems(currentProjectId, newItems)
      await fetchAll()
      toast.success('Folder created')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create folder')
    }
  }

  const renameFolder = async (folderId: string, currentName: string) => {
    if (!currentProject) return
    const name = window.prompt('Rename folder', currentName)?.trim()
    if (!name || name === currentName) return
    if (await saveItems(renameItem(currentProject.items || [], folderId, name))) {
      toast.success('Folder renamed')
    }
  }

  const duplicateFolderAction = async (folderId: string) => {
    if (!currentProject) return
    if (await saveItems(duplicateFolder(currentProject.items || [], folderId))) {
      toast.success('Folder duplicated')
    }
  }

  const deleteFolder = async (folderId: string, name: string) => {
    if (!currentProject) return
    if (!await confirm({
      title: `Delete “${name}”?`,
      description: 'The folder and every endpoint inside it will be removed.',
      confirmLabel: 'Delete folder',
      detail: 'This action cannot be undone.',
    })) return
    if (await saveItems(removeItem(currentProject.items || [], folderId))) {
      toast.success('Folder deleted')
    }
  }

  const runFolder = async (folderId: string) => {
    const tests = collectRequestsUnderFolder(projectItems, folderId)
    if (!tests.length) {
      toast.error('No endpoints in this folder')
      return
    }
    if (!await confirm({
      title: `Run ${tests.length} endpoints?`,
      description: 'Beacon will queue every endpoint in this folder using its saved run settings.',
      confirmLabel: 'Start folder run',
      tone: 'action',
    })) return
    run.startAll(
      tests.map((ep) => ({
        testId: ep.id,
        name: ep.name,
        cfg: ep.run_config ?? settingsToConfig(globalSettings),
      })),
      { sourceType: 'folder', targetId: folderId, targetName: 'Folder run' },
    )
  }

  // Run a folder's endpoints in order as a chained scenario (one send each;
  // variables refreshed by extractors carry into later steps).
  const runFolderAsScenario = async (folderId: string) => {
    const tests = collectRequestsUnderFolder(projectItems, folderId)
    if (!tests.length) {
      toast.error('No endpoints in this folder')
      return
    }
    if (!await confirm({
      title: `Run ${tests.length}-step scenario?`,
      description: 'Endpoints will run in order. Extracted variables can be passed into the next step.',
      confirmLabel: 'Start scenario',
      tone: 'action',
    })) return
    try {
      const result = await api.runScenario(tests.map((ep) => ep.id), { continue_on_error: false })
      setScenarioResult(result)
      await fetchAll() // pick up any tokens the chain refreshed
    } catch (e: any) {
      toast.error(e?.message || 'Scenario failed')
    }
  }

  const saveProjectSettings = async (name: string, notifications: ProjectNotifications) => {
    if (!currentProjectId || !name) return
    try {
      await api.updateNotifications(currentProjectId, notifications)
      if (name !== currentProject?.name) await api.renameProject(currentProjectId, name)
      toast.success('Project settings saved')
      setShowProjectSettings(false)
      await fetchAll()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save project settings')
    }
  }

  const deleteProject = async () => {
    if (!currentProject) return
    if (!await confirm({
      title: `Delete “${currentProject.name}”?`,
      description: 'This project, its folders, environments, and endpoints will be removed.',
      confirmLabel: 'Delete project',
      detail: 'This action cannot be undone.',
    })) return
    try {
      await api.deleteProject(currentProjectId)
      toast.success('Project deleted')
      setShowProjectSettings(false)
      setSelectedTestId(null)
      await fetchAll()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete project')
    }
  }

  // ---- export / import (Postman-style) ---------------------------------
  const exportProject = async () => {
    if (!currentProject) return
    try {
      // Default export redacts secret values; the backend keeps variable names.
      const data = await api.exportProject(currentProjectId, false)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safeName = (currentProject.name || 'project').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase()
      a.href = url
      a.download = `${safeName}.project.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Exported (secret values redacted)')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to export project')
    }
  }

  // Parse + send to backend; throws so ImportDialog can surface the error inline.
  const doImport = async (payload: unknown) => {
    const res = await api.importProject(payload)
    toast.success(`Imported "${res.name}" — ${res.imported.tests} endpoint(s)`)
    await switchProject(res.id)
  }

  const saveEnvironments = async (envs: any[]) => {
    if (!currentProjectId) { setShowEnvDialog(false); return }
    try {
      await api.updateEnvironments(currentProjectId, envs)
      toast.success('Environments saved')
      await fetchAll()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save environments')
    }
    setShowEnvDialog(false)
  }

  const saveGlobal = async (vars: Record<string, string>) => {
    try {
      await api.saveGlobal(vars)
      toast.success('Global variables saved')
      await fetchAll()
    } catch {
      setGlobalVariables(vars)
    }
    setShowGlobalDialog(false)
  }

  // ---- Endpoints --------------------------------------------------------
  // folderId is optional; guarded against click events being passed as the arg.
  const openNewEditor = (folderId?: string) => {
    setEditingId(null)
    setNewEndpointFolderId(typeof folderId === 'string' ? folderId : null)
    setShowEditor(true)
  }
  const openEdit = (id: string) => { setEditingId(id); setNewEndpointFolderId(null); setShowEditor(true) }
  const closeEditor = () => { setShowEditor(false); setEditingId(null) }

  // Persist a reordered / moved items tree (drag-and-drop, folder ops).
  // Returns whether the save succeeded so callers can show their own toast.
  const saveItems = async (next: CollectionItem[]): Promise<boolean> => {
    if (!currentProjectId) return false
    try {
      await api.updateProjectItems(currentProjectId, next)
      await fetchAll()
      return true
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save changes')
      return false
    }
  }

  // Editor finished. `created` is set only for brand-new endpoints; if one was
  // targeted at a folder, drop it in there — otherwise just refresh.
  const handleEditorSave = async (created?: Endpoint) => {
    const folderId = newEndpointFolderId
    setNewEndpointFolderId(null)
    if (created && folderId && currentProject) {
      const next = insertIntoFolder(currentProject.items || [], folderId, { ...created, type: 'request' } as CollectionItem)
      await saveItems(next)
      return
    }
    await fetchAll()
  }

  const duplicateEndpoint = async (id: string) => {
    try { await api.duplicateTest(id); toast.success('Endpoint duplicated'); await fetchAll() }
    catch (e: any) { toast.error(e?.message || 'Failed to duplicate') }
  }

  const deleteEndpoint = async (id: string, name: string) => {
    if (!await confirm({
      title: `Delete “${name}”?`,
      description: 'This endpoint will be removed from the current project.',
      confirmLabel: 'Delete endpoint',
      detail: 'This action cannot be undone.',
    })) return
    try {
      await api.deleteTest(id)
      toast.success('Endpoint deleted')
      if (selectedTestId === id) setSelectedTestId(null)
      await fetchAll()
    } catch (e: any) { toast.error(e?.message || 'Failed to delete') }
  }

  // ---- Execution settings ----------------------------------------------
  const selectEndpoint = (id: string) => {
    setSelectedTestId(id)
    const ep = effectiveTests.find((t) => t.id === id) || (config.tests as any[]).find((t) => t.id === id)
    if (ep?.run_config) {
      setOverrideEnabled(true)
      setSettings(configToSettings(ep.run_config))
    } else {
      setOverrideEnabled(false)
      setSettings(globalSettings)
    }
  }

  const onSettingsChange = (s: ExecSettings) => {
    setSettings(s)
    if (!overrideEnabled) {
      setGlobalSettings(s)
      try { localStorage.setItem('exec_settings', JSON.stringify(s)) } catch {}
    }
  }

  const onToggleOverride = (on: boolean) => {
    setOverrideEnabled(on)
    if (!on) setSettings(globalSettings)
  }

  // Persist (or clear) a per-endpoint override before running.
  const persistOverride = async (ep: Endpoint, cfg: RunConfig) => {
    const target = overrideEnabled ? cfg : null
    if (JSON.stringify(ep.run_config ?? null) === JSON.stringify(target)) return
    try {
      await api.updateTest(ep.id, { ...ep, run_config: target })
      await fetchConfig()
    } catch {}
  }

  const runSelected = async (payload?: Record<string, unknown>) => {
    if (!selectedTestId) { toast.error('Select an endpoint first'); return }
    const ep = effectiveTests.find((t) => t.id === selectedTestId) || (config.tests as any[]).find((t) => t.id === selectedTestId)
    if (!ep) return

    // Scenario mode: delegate to the existing runFolderAsScenario-style flow
    if (payload?.__scenario) {
      const allIds = effectiveTests.map((t) => t.id)
      try {
        const result = await api.runScenario(allIds, { continue_on_error: false })
        setScenarioResult(result)
        await fetchAll()
      } catch (e: any) {
        toast.error(e?.message || 'Scenario failed')
      }
      return
    }

    const cfg = settingsToConfig(settings)
    await persistOverride(ep, cfg)
    run.start(ep.id, ep.name, cfg, payload)
  }

  const runRow = (id: string) => {
    const ep = effectiveTests.find((t) => t.id === id) || (config.tests as any[]).find((t) => t.id === id)
    if (!ep) return
    selectEndpoint(id)
    const cfg = ep.run_config ? ep.run_config : settingsToConfig(globalSettings)
    run.start(ep.id, ep.name, cfg)
  }

  const runAll = async (mode: TestMode = 'load', modeParams?: ModeParams['params']) => {
    const tests = effectiveTests
    if (!tests.length) {
      toast.error('No endpoints to run')
      return
    }
    if (!await confirm({
      title: `Run all ${tests.length} endpoints?`,
      description: 'Beacon will run the entire project sequentially.',
      confirmLabel: mode === 'scenario' ? 'Start scenario' : 'Start run',
      tone: 'action',
      detail: 'Saved endpoint overrides take priority. Other endpoints use the global settings.',
    })) return
    if (mode === 'scenario') {
      void api.runScenario(tests.map((ep) => ep.id), { continue_on_error: false })
        .then((result) => setScenarioResult(result))
        .catch((e: any) => toast.error(e?.message || 'Scenario failed'))
      return
    }
    run.startAll(
      tests.map((ep) => ({
        testId: ep.id,
        name: ep.name,
        cfg: ep.run_config ?? settingsToConfig(globalSettings),
        payload: modeParams ? buildRunPayload(ep.id, mode, modeParams) : undefined,
      })),
      { sourceType: 'run_all', targetName: `Run all · ${currentProject?.name || 'Project'}` },
    )
  }

  // ⌘K / Ctrl+K toggles the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const paletteCommands: Command[] = [
    { id: 'new-endpoint', label: 'New endpoint', hint: '⌘N', icon: FilePlus, keywords: 'create request add', run: () => openNewEditor() },
    { id: 'new-folder', label: 'New folder', icon: FolderPlus, keywords: 'group', run: () => createFolder() },
    { id: 'new-project', label: 'New project', icon: FilePlus, keywords: 'workspace', run: () => setShowProjectDialog(true) },
    ...(selectedTestId ? [{ id: 'run-selected', label: `Run “${selectedName || 'selected'}”`, icon: Play, keywords: 'test load', run: () => runSelected() } as Command] : []),
    { id: 'run-all', label: 'Run all endpoints', icon: ListVideo, keywords: 'test load', run: () => runAll() },
    ...(run.status === 'running' ? [{ id: 'stop', label: 'Stop run', icon: Square, keywords: 'cancel halt', run: () => run.stop() } as Command] : []),
    { id: 'history', label: 'Open Run History', icon: HistoryIcon, keywords: 'runs past results', run: () => appView.openHistory() },
    { id: 'mcp', label: 'Open MCP Server', icon: PlugIcon, keywords: 'ai agent claude cursor', run: () => appView.openMcp() },
    { id: 'settings', label: 'Open Settings', icon: SlidersHorizontal, keywords: 'preferences config', run: () => setShowSettings(true) },
    { id: 'environments', label: 'Manage environments', icon: Globe, keywords: 'env base url variables', run: () => setShowEnvDialog(true) },
    { id: 'global-vars', label: 'Global variables', icon: Braces, keywords: 'template', run: () => setShowGlobalDialog(true) },
    { id: 'import', label: 'Import project', icon: UploadIcon, keywords: 'postman json', run: () => setShowImportDialog(true) },
    ...(currentProject ? [{ id: 'export', label: 'Export project', icon: DownloadIcon, keywords: 'save json', run: () => exportProject() } as Command] : []),
    { id: 'theme', label: 'Toggle light / dark', icon: SunMoon, keywords: 'appearance mode', run: () => applyThemePref(resolveTheme() === 'dark' ? 'light' : 'dark') },
  ]

  if (showIntro) {
    return <Onboarding onGetStarted={finishIntro} />
  }

  if (initializing || initializationError) {
    return <LoadingScreen error={initializationError} onRetry={() => setRetryToken((t) => t + 1)} />
  }

  if (appView.view === 'history') {
    return (
      <div className="app-surface animate-fade-in h-screen text-foreground">
        <HistoryPage
          projectId={currentProjectId}
          initialRunId={appView.runId}
          onBack={appView.openWorkspace}
        />
      </div>
    )
  }

  if (appView.view === 'mcp') {
    return (
      <div className="app-surface animate-fade-in h-screen text-foreground">
        <McpPage onBack={appView.openWorkspace} />
      </div>
    )
  }

  return (
    <div className="app-surface flex h-screen text-foreground">
      <Sidebar
        projects={projects}
        currentProjectId={currentProjectId}
        currentProject={currentProject}
        config={config}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => { localStorage.setItem('sidebar_collapsed', String(!c)); return !c })}
        onSwitchProject={switchProject}
        onNewProject={() => setShowProjectDialog(true)}
        onAddSampleProject={addSampleProject}
        sampleProjectExists={hasJsonPlaceholderSample(projects)}
        sampleProjectBusy={sampleProjectBusy}
        onSwitchEnv={switchEnv}
        onManageEnv={() => setShowEnvDialog(true)}
        onGlobalVars={() => setShowGlobalDialog(true)}
        onNewEndpoint={openNewEditor}
        onRunAll={() => runAll()}
        runAllDisabled={run.status === 'running'}
        onOpenMcp={() => appView.openMcp()}
        onOpenHistory={() => appView.openHistory()}
        activeView={appView.view}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          currentProject={currentProject}
          onProjectSettings={() => setShowProjectSettings(true)}
          onImport={() => setShowImportDialog(true)}
          onExport={exportProject}
          onOpenMcp={() => appView.openMcp()}
          onOpenSettings={() => setShowSettings(true)}
        />

        <div className={`flex-1 overflow-auto ${showEditor ? 'p-1 pb-4' : 'p-4 space-y-4'}`}>
          {showEditor ? (
            <EndpointEditor
              testId={editingId}
              config={config}
              currentProjectName={currentProject?.name}
              currentEnvName={currentEnv?.name}
              onClose={closeEditor}
              onSave={handleEditorSave}
            />
          ) : (
            <>
              <ExecutionControls
                settings={settings}
                onChange={onSettingsChange}
                status={run.status}
                selectedName={selectedName}
                hasSelection={!!selectedTestId}
                endpointCount={effectiveTests.length}
                overrideEnabled={overrideEnabled}
                onToggleOverride={onToggleOverride}
                onRun={runSelected}
                onRunAll={runAll}
                onStop={run.stop}
                selectedTestId={selectedTestId}
              />

              <EndpointTable
                tests={effectiveTests}
                items={projectItems}
                selectedId={selectedTestId}
                runningTestId={run.runningTestId}
                runStatus={run.status}
                onSelect={selectEndpoint}
                onNew={openNewEditor}
                onNewFolder={createFolder}
                onEdit={openEdit}
                onDuplicate={duplicateEndpoint}
                onDelete={deleteEndpoint}
                onRunRow={runRow}
                onRunFolder={runFolder}
                onRunScenario={runFolderAsScenario}
                onRunAll={() => runAll()}
                onNewInFolder={(fid) => openNewEditor(fid)}
                onRenameFolder={renameFolder}
                onDuplicateFolder={duplicateFolderAction}
                onDeleteFolder={deleteFolder}
                onReorder={saveItems}
              />

              <LiveMonitor
                logs={run.logs}
                responses={run.responses}
                stats={run.stats}
                status={run.status}
                maxRequests={run.runQueue ? run.totalMaxRequests : run.maxRequests}
                runQueue={run.runQueue}
                runningName={effectiveTests.find((t) => t.id === run.runningTestId)?.name || (config.tests as any[]).find((t) => t.id === run.runningTestId)?.name}
                onStop={run.stop}
                onClear={run.clear}
                onViewHistory={run.lastHistoryId ? () => appView.openHistory(run.lastHistoryId) : undefined}
              />
            </>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <ProjectDialog open={showProjectDialog} onOpenChange={setShowProjectDialog} onCreate={createProject} />
      <ImportDialog open={showImportDialog} onOpenChange={setShowImportDialog} onImport={doImport} fetchTemplate={api.projectTemplate} />
      <EnvironmentsDialog open={showEnvDialog} onOpenChange={setShowEnvDialog} project={currentProject} activeEnvId={currentProject?.current_environment_id} onSave={saveEnvironments} />
      <GlobalVarsDialog open={showGlobalDialog} onOpenChange={setShowGlobalDialog} initial={globalVariables} onSave={saveGlobal} />
      <ProjectSettingsDialog open={showProjectSettings} onOpenChange={setShowProjectSettings} project={currentProject} onSave={saveProjectSettings} onDelete={deleteProject} />
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} onOpenMcp={() => appView.openMcp()} />
      <CommandPalette open={showPalette} onOpenChange={setShowPalette} commands={paletteCommands} />
      <ScenarioResultsDialog result={scenarioResult} onClose={() => setScenarioResult(null)} />
      {confirmationDialog}
    </div>
  )
}

export default App
