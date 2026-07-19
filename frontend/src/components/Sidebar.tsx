import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Plus, Settings, Globe, PanelLeftClose, PanelLeftOpen, FileStack, ListVideo, Activity, Database, Layers3, Sparkles, Plug, History } from 'lucide-react'
import { Project, TestConfig } from '../types'
import { BrandMark } from './BrandMark'

interface Props {
  projects: Project[]
  currentProjectId: string
  currentProject?: Project
  config: TestConfig
  collapsed: boolean
  onToggleCollapse: () => void
  onSwitchProject: (id: string) => void
  onNewProject: () => void
  onAddSampleProject: () => void
  sampleProjectExists: boolean
  sampleProjectBusy: boolean
  onSwitchEnv: (envId: string) => void
  onManageEnv: () => void
  onGlobalVars: () => void
  onNewEndpoint: () => void
  onRunAll?: () => void
  runAllDisabled?: boolean
  onOpenMcp?: () => void
  onOpenHistory: () => void
  activeView?: 'workspace' | 'history'
}

export function Sidebar({
  projects, currentProjectId, currentProject, config, collapsed, onToggleCollapse,
  onSwitchProject, onNewProject, onAddSampleProject, sampleProjectExists, sampleProjectBusy,
  onSwitchEnv, onManageEnv, onGlobalVars, onNewEndpoint, onRunAll, runAllDisabled,
  onOpenMcp, onOpenHistory, activeView = 'workspace',
}: Props) {
  const envs = currentProject?.environments || []
  const activeEnv = envs.find((env) => env.id === currentProject?.current_environment_id)

  // ---- Collapsed rail --------------------------------------------------
  if (collapsed) {
    return (
      <aside className="w-16 bg-card border-r border-border flex flex-col items-center py-3 gap-2 animate-sidebar-in">
        <Button size="icon" variant="ghost" className="h-8 w-8" title="Expand sidebar" onClick={onToggleCollapse}>
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <BrandMark size="sm" className="my-1" />

        <div className="w-8 border-t border-border my-1" />

        <Button size="icon" variant="ghost" className="h-8 w-8" title="New project" onClick={onNewProject}>
          <Plus className="h-4 w-4" />
        </Button>
        <Button size="icon" variant={activeView === 'history' ? 'secondary' : 'ghost'} className="h-8 w-8" title="Run history" onClick={onOpenHistory}>
          <History className="h-4 w-4" />
        </Button>

        <div className="flex-1 w-full overflow-auto flex flex-col items-center gap-1 px-1">
          {projects.map((p) => {
            const active = p.id === currentProjectId
            return (
              <button
                key={p.id}
                onClick={() => onSwitchProject(p.id)}
                title={p.name}
                className={`relative h-9 w-9 rounded-lg text-xs font-semibold uppercase transition-all flex items-center justify-center active:scale-95 ${
                  active ? 'bg-primary text-primary-foreground shadow-sm animate-nav-pop' : 'hover:bg-muted text-muted-foreground'
                }`}
              >
                {active && <span className="absolute -left-1.5 h-5 w-1 rounded-full bg-cyan-400" />}
                {p.name.trim().charAt(0) || '?'}
              </button>
            )
          })}
        </div>

        <div className="w-8 border-t border-border my-1" />
        <Button size="icon" variant="ghost" className="h-8 w-8" title="Manage environments" onClick={onManageEnv}>
          <Settings className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" title="Global variables" onClick={onGlobalVars}>
          <Globe className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="default" className="h-8 w-8" title="New endpoint" onClick={onNewEndpoint}>
          <FileStack className="h-4 w-4" />
        </Button>

        {onOpenMcp && (
          <Button size="icon" variant="ghost" className="h-8 w-8" title="MCP Server (any AI client)" onClick={onOpenMcp}>
            <Plug className="h-4 w-4" />
          </Button>
        )}
      </aside>
    )
  }

  // ---- Full sidebar ----------------------------------------------------
  return (
    <aside className="w-72 bg-card border-r border-border flex flex-col animate-sidebar-in">
      {/* Brand */}
      <div className="p-4 pb-3 bg-gradient-to-b from-muted/55 to-transparent">
        <div className="flex items-center gap-2">
          <a href="#" className="flex items-center gap-2 hover:opacity-90 transition-opacity flex-1" title="Go to home page">
            <BrandMark size="md" />
            <div className="min-w-0">
              <h1 className="text-base font-extrabold tracking-tight leading-none">Beacon</h1>
              <p className="text-[10px] text-muted-foreground mt-1">Clarity for every request</p>
            </div>
          </a>
          <Button size="icon" variant="ghost" className="h-7 w-7 -mr-1 shrink-0" title="Collapse sidebar" onClick={onToggleCollapse}>
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border/80 bg-background/70 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Layers3 className="h-3 w-3" /> Projects
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums">{projects.length}</div>
          </div>
          <div className="rounded-lg border border-border/80 bg-background/70 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Activity className="h-3 w-3" /> Endpoints
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums">{config.tests.length}</div>
          </div>
        </div>
      </div>

      {/* Projects */}
      <div className="px-4 flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Projects</div>
        <Button size="icon" variant="ghost" className="h-6 w-6" title="New project" onClick={onNewProject}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="px-3 flex-1 overflow-auto space-y-1.5 min-h-[60px]">
        {projects.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">No projects yet.</div>
        )}
        {projects.map((p) => {
          const active = p.id === currentProjectId
          const endpointText = active
            ? `${config.tests.length} endpoint${config.tests.length === 1 ? '' : 's'}`
            : 'Project workspace'
          return (
            <button
              key={p.id}
              onClick={() => onSwitchProject(p.id)}
              className={`group relative w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all flex items-center gap-3 active:scale-[0.99] ${
                active ? 'bg-primary text-primary-foreground font-semibold shadow-sm animate-nav-pop' : 'hover:bg-muted text-foreground'
              }`}
            >
              {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-cyan-400" />}
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold uppercase ${
                active ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted text-muted-foreground group-hover:text-foreground'
              }`}>
                {p.name.trim().charAt(0) || '?'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate leading-tight">{p.name}</span>
                <span className={`mt-0.5 block truncate text-[10px] ${active ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                  {endpointText}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="px-3 pb-3 pt-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 text-xs"
          onClick={onAddSampleProject}
          disabled={sampleProjectExists || sampleProjectBusy}
        >
          <Sparkles className="h-3.5 w-3.5 text-cyan-500" />
          {sampleProjectBusy
            ? 'Adding Sample…'
            : sampleProjectExists
              ? 'Sample Project Added'
              : 'Add Sample Project'}
        </Button>
        <Button
          variant={activeView === 'history' ? 'secondary' : 'ghost'}
          size="sm"
          className="mt-2 w-full justify-start gap-2 text-xs"
          onClick={onOpenHistory}
        >
          <History className="h-3.5 w-3.5" /> Run History
        </Button>
      </div>

      {/* Config (moved out of the header) */}
      <div className="border-t border-border p-4 space-y-3 bg-muted/20">
        <div className="rounded-xl border border-border bg-background/80 p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              <Database className="h-3.5 w-3.5" /> Environment
            </div>
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-soft-pulse" /> active
            </span>
          </div>
          <div className="flex gap-1.5">
            <Select
              value={currentProject?.current_environment_id || ''}
              onValueChange={(val) => { if (val) onSwitchEnv(val) }}
            >
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder="No environment" />
              </SelectTrigger>
              <SelectContent>
                {envs.map((env) => (
                  <SelectItem key={env.id} value={env.id}>{env.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" title="Manage environments" onClick={onManageEnv}>
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="mt-2 text-[10px] font-medium text-foreground truncate" title={activeEnv?.name}>
            {activeEnv?.name || 'No environment selected'}
          </div>
          <div className="mt-1.5 text-[10px] text-muted-foreground font-mono truncate" title={config.base_url}>
            {config.base_url || 'base url not set'}
          </div>
        </div>

        <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5 justify-start bg-background/80" onClick={onGlobalVars}>
          <Globe className="h-3.5 w-3.5" /> Global Variables
        </Button>

        <Button onClick={onNewEndpoint} className="w-full h-9 gap-2 shadow-sm hover:-translate-y-0.5" size="sm">
          <Sparkles className="h-3.5 w-3.5" /> New Endpoint
        </Button>
        {onRunAll && (
          <Button
            variant="outline"
            onClick={onRunAll}
            disabled={runAllDisabled || config.tests.length === 0}
            className="w-full h-8 text-xs gap-1.5 bg-background/80"
          >
            <ListVideo className="h-3.5 w-3.5" /> Run All Endpoints
          </Button>
        )}
        <div className="text-[10px] text-center text-muted-foreground">Ready for authorized API testing</div>

        {onOpenMcp && (
          <button
            onClick={onOpenMcp}
            className="mt-3 w-full flex items-center gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-left text-xs hover:bg-muted transition"
          >
            <Plug className="h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <div className="font-medium">MCP Server</div>
              <div className="text-[10px] text-muted-foreground">Connect Claude, Cursor &amp; more</div>
            </div>
          </button>
        )}
      </div>
    </aside>
  )
}
