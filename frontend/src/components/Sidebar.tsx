import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Plus, Settings, Globe, PanelLeftClose, PanelLeftOpen, FileStack, ListVideo, Activity, Database, Layers3, Sparkles, Plug, History } from 'lucide-react'
import { Project, TestConfig } from '../types'
import { BrandMark } from './BrandMark'
import { useAppVersion } from '../hooks/useAppVersion'
import { cn } from '@/lib/utils'

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
  const version = useAppVersion()

  // One persistent <aside> whose WIDTH animates between rail and full — so
  // collapse/expand glides instead of snapping between two separate trees.
  return (
    <aside
      className={cn(
        'sidebar-surface relative flex shrink-0 flex-col overflow-hidden border-r border-border animate-sidebar-in',
        'transition-[width] duration-300 ease-[cubic-bezier(0.22,0.85,0.25,1)] motion-reduce:transition-none',
        collapsed ? 'w-14' : 'w-64',
      )}
    >
      {collapsed ? (
        <div className="flex h-full w-14 flex-col items-center gap-1.5 py-2.5">
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
        </div>
      ) : (
        <div className="flex h-full w-64 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <a href="#" className="flex min-w-0 flex-1 items-center gap-2 transition-opacity hover:opacity-90" title="Go to home page">
          <BrandMark size="sm" />
          <div className="min-w-0">
            <h1 className="text-sm font-extrabold leading-none tracking-tight">Beacon</h1>
            <p className="mt-1 truncate text-[9px] text-muted-foreground">Clarity for every request</p>
          </div>
        </a>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Collapse sidebar" onClick={onToggleCollapse}>
          <PanelLeftClose className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-4 border-b border-border px-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><Layers3 className="h-3 w-3" /><strong className="font-mono text-foreground">{projects.length}</strong> projects</span>
        <span className="flex items-center gap-1.5"><Activity className="h-3 w-3" /><strong className="font-mono text-foreground">{config.tests.length}</strong> endpoints</span>
      </div>

      <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Projects</div>
        <Button size="icon" variant="ghost" className="h-6 w-6" title="New project" onClick={onNewProject}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="min-h-[60px] flex-1 space-y-1 overflow-auto px-2">
        {projects.length === 0 && (
          <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">No projects yet.</div>
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
              className={`group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors active:scale-[0.99] ${
                active ? 'bg-cyan-500/10 text-foreground font-semibold ring-1 ring-inset ring-cyan-500/25 animate-nav-pop' : 'text-foreground hover:bg-muted'
              }`}
            >
              {active && <span className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-r-full bg-cyan-400" />}
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-[10px] font-bold uppercase ${
                active ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300' : 'bg-muted text-muted-foreground group-hover:text-foreground'
              }`}>
                {p.name.trim().charAt(0) || '?'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate leading-tight">{p.name}</span>
                <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
                  {endpointText}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-1 border-t border-border px-2 py-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 min-w-0 justify-start gap-1.5 px-2 text-[10px]"
          onClick={onAddSampleProject}
          disabled={sampleProjectExists || sampleProjectBusy}
        >
          <Sparkles className="h-3 w-3 shrink-0 text-cyan-500" />
          {sampleProjectBusy
            ? 'Adding Sample…'
            : sampleProjectExists
              ? 'Sample Added'
              : 'Add Sample'}
        </Button>
        <Button
          variant={activeView === 'history' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 justify-start gap-1.5 px-2 text-[10px]"
          onClick={onOpenHistory}
        >
          <History className="h-3 w-3" /> History
        </Button>
      </div>

      <div className="shrink-0 space-y-2 border-t border-border bg-muted/15 p-3">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Database className="h-3 w-3" /> Environment
            </div>
            <span className="flex items-center gap-1 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> active
            </span>
          </div>
          <div className="flex gap-1.5">
            <Select
              value={currentProject?.current_environment_id || ''}
              onValueChange={(val) => { if (val) onSwitchEnv(val) }}
            >
              <SelectTrigger className="h-7 flex-1 text-[11px]">
                <SelectValue placeholder="No environment" />
              </SelectTrigger>
              <SelectContent>
                {envs.map((env) => (
                  <SelectItem key={env.id} value={env.id}>{env.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" title="Manage environments" onClick={onManageEnv}>
              <Settings className="h-3 w-3" />
            </Button>
          </div>
          <div className="mt-1.5 truncate font-mono text-[9px] text-muted-foreground" title={config.base_url}>
            {config.base_url || 'base url not set'}
          </div>
        </div>

        <Button variant="ghost" size="sm" className="h-7 w-full justify-start gap-1.5 px-2 text-[10px]" onClick={onGlobalVars}>
          <Globe className="h-3 w-3" /> Global Variables
        </Button>

        <div className="grid grid-cols-2 gap-1.5">
          <Button onClick={onNewEndpoint} className="h-8 gap-1.5 px-2 text-[10px]" size="sm">
            <Plus className="h-3 w-3" /> Endpoint
          </Button>
          {onRunAll && (
            <Button
              variant="outline"
              onClick={onRunAll}
              disabled={runAllDisabled || config.tests.length === 0}
              className="h-8 gap-1.5 px-2 text-[10px]"
            >
              <ListVideo className="h-3 w-3" /> Run All
            </Button>
          )}
        </div>

        {onOpenMcp && (
          <button
            onClick={onOpenMcp}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plug className="h-3 w-3" />
            <span className="font-medium">MCP Server</span>
            <span className="ml-auto text-[9px]">AI clients</span>
          </button>
        )}
        <div className="pt-0.5 text-center text-[9px] text-muted-foreground/70">
          Beacon{version ? ` v${version}` : ''}
        </div>
      </div>
        </div>
      )}
    </aside>
  )
}
