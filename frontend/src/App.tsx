import { useState, useEffect } from 'react'
import { TestConfig, Project, Endpoint, RunConfig } from './types'
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
import { useRun } from './hooks/useRun'
import { api } from './lib/api'
import { toast } from './components/ui/toast'

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
  const [config, setConfig] = useState<TestConfig>({ base_url: '', variables: {}, tests: [] })
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProjectId, setCurrentProjectId] = useState('')
  const [globalVariables, setGlobalVariables] = useState<Record<string, string>>({})

  const [showEditor, setShowEditor] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [showProjectDialog, setShowProjectDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem('sidebar_collapsed') === 'true')
  const [showEnvDialog, setShowEnvDialog] = useState(false)
  const [showGlobalDialog, setShowGlobalDialog] = useState(false)
  const [showProjectSettings, setShowProjectSettings] = useState(false)

  // Execution settings: a global default (persisted) + an active view that may
  // be a per-endpoint override.
  const [globalSettings, setGlobalSettings] = useState<ExecSettings>(loadGlobalSettings)
  const [settings, setSettings] = useState<ExecSettings>(globalSettings)
  const [overrideEnabled, setOverrideEnabled] = useState(false)
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null)

  const run = useRun()

  const currentProject = projects.find((p) => p.id === currentProjectId)
  const currentEnv = currentProject?.environments?.find((e) => e.id === currentProject?.current_environment_id)
  const selectedName = config.tests.find((t) => t.id === selectedTestId)?.name

  useEffect(() => { fetchAll() }, [])

  // ---- Data loading -----------------------------------------------------
  const fetchAll = async () => {
    try {
      const data = await api.listProjects()
      setProjects(data.projects || [])
      setCurrentProjectId(data.current_project_id || '')
      setGlobalVariables(data.global_variables || {})
    } catch {
      setProjects([{ id: 'default', name: 'Default Project', environments: [], current_environment_id: '' } as any])
      setCurrentProjectId('default')
    }
    try { setConfig(await api.getConfig()) } catch {}
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

  const renameProject = async (name: string) => {
    if (!currentProjectId || !name) return
    try {
      await api.renameProject(currentProjectId, name)
      toast.success('Project renamed')
      setShowProjectSettings(false)
      await fetchAll()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to rename project')
    }
  }

  const deleteProject = async () => {
    if (!currentProject) return
    if (!window.confirm(`Delete project "${currentProject.name}" and all its endpoints?`)) return
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
  const openNewEditor = () => { setEditingId(null); setShowEditor(true) }
  const openEdit = (id: string) => { setEditingId(id); setShowEditor(true) }
  const closeEditor = () => { setShowEditor(false); fetchAll() }

  const duplicateEndpoint = async (id: string) => {
    try { await api.duplicateTest(id); toast.success('Endpoint duplicated'); await fetchAll() }
    catch (e: any) { toast.error(e?.message || 'Failed to duplicate') }
  }

  const deleteEndpoint = async (id: string, name: string) => {
    if (!window.confirm(`Delete endpoint "${name}"? This cannot be undone.`)) return
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
    const ep = config.tests.find((t) => t.id === id)
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

  const runSelected = async () => {
    if (!selectedTestId) { toast.error('Select an endpoint first'); return }
    const ep = config.tests.find((t) => t.id === selectedTestId)
    if (!ep) return
    const cfg = settingsToConfig(settings)
    await persistOverride(ep, cfg)
    run.start(ep.id, ep.name, cfg)
  }

  const runRow = (id: string) => {
    const ep = config.tests.find((t) => t.id === id)
    if (!ep) return
    selectEndpoint(id)
    const cfg = ep.run_config ? ep.run_config : settingsToConfig(globalSettings)
    run.start(ep.id, ep.name, cfg)
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar
        projects={projects}
        currentProjectId={currentProjectId}
        currentProject={currentProject}
        config={config}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => { localStorage.setItem('sidebar_collapsed', String(!c)); return !c })}
        onSwitchProject={switchProject}
        onNewProject={() => setShowProjectDialog(true)}
        onSwitchEnv={switchEnv}
        onManageEnv={() => setShowEnvDialog(true)}
        onGlobalVars={() => setShowGlobalDialog(true)}
        onNewEndpoint={openNewEditor}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          currentProject={currentProject}
          onProjectSettings={() => setShowProjectSettings(true)}
          onImport={() => setShowImportDialog(true)}
          onExport={exportProject}
        />

        <div className={`flex-1 overflow-auto ${showEditor ? 'p-1 pb-4' : 'p-4 space-y-4'}`}>
          {showEditor ? (
            <EndpointEditor
              testId={editingId}
              config={config}
              currentProjectName={currentProject?.name}
              currentEnvName={currentEnv?.name}
              onClose={closeEditor}
              onSave={fetchAll}
            />
          ) : (
            <>
              <ExecutionControls
                settings={settings}
                onChange={onSettingsChange}
                status={run.status}
                selectedName={selectedName}
                hasSelection={!!selectedTestId}
                overrideEnabled={overrideEnabled}
                onToggleOverride={onToggleOverride}
                onRun={runSelected}
                onStop={run.stop}
              />

              <EndpointTable
                tests={config.tests as Endpoint[]}
                selectedId={selectedTestId}
                runningTestId={run.runningTestId}
                runStatus={run.status}
                onSelect={selectEndpoint}
                onNew={openNewEditor}
                onEdit={openEdit}
                onDuplicate={duplicateEndpoint}
                onDelete={deleteEndpoint}
                onRunRow={runRow}
              />

              <LiveMonitor
                logs={run.logs}
                responses={run.responses}
                stats={run.stats}
                status={run.status}
                maxRequests={run.maxRequests}
                runningName={config.tests.find((t) => t.id === run.runningTestId)?.name}
                onStop={run.stop}
                onClear={run.clear}
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
      <ProjectSettingsDialog open={showProjectSettings} onOpenChange={setShowProjectSettings} project={currentProject} onRename={renameProject} onDelete={deleteProject} />
    </div>
  )
}

export default App
