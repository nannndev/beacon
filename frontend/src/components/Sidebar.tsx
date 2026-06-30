import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Plus, Settings, Globe, PanelLeftClose, PanelLeftOpen, FileStack } from 'lucide-react'
import { Project, TestConfig } from '../types'

interface Props {
  projects: Project[]
  currentProjectId: string
  currentProject?: Project
  config: TestConfig
  collapsed: boolean
  onToggleCollapse: () => void
  onSwitchProject: (id: string) => void
  onNewProject: () => void
  onSwitchEnv: (envId: string) => void
  onManageEnv: () => void
  onGlobalVars: () => void
  onNewEndpoint: () => void
}

export function Sidebar({
  projects, currentProjectId, currentProject, config, collapsed, onToggleCollapse,
  onSwitchProject, onNewProject, onSwitchEnv, onManageEnv, onGlobalVars, onNewEndpoint,
}: Props) {
  const envs = currentProject?.environments || []

  // ---- Collapsed rail --------------------------------------------------
  if (collapsed) {
    return (
      <div className="w-14 bg-card border-r border-border flex flex-col items-center py-3 gap-2">
        <Button size="icon" variant="ghost" className="h-8 w-8" title="Expand sidebar" onClick={onToggleCollapse}>
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <div className="h-7 w-7 rounded bg-primary shrink-0" title="Security Tools" />

        <div className="w-8 border-t border-border my-1" />

        <Button size="icon" variant="ghost" className="h-8 w-8" title="New project" onClick={onNewProject}>
          <Plus className="h-4 w-4" />
        </Button>

        <div className="flex-1 w-full overflow-auto flex flex-col items-center gap-1 px-1">
          {projects.map((p) => {
            const active = p.id === currentProjectId
            return (
              <button
                key={p.id}
                onClick={() => onSwitchProject(p.id)}
                title={p.name}
                className={`h-8 w-8 rounded-md text-xs font-semibold uppercase transition-colors flex items-center justify-center ${
                  active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
                }`}
              >
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
      </div>
    )
  }

  // ---- Full sidebar ----------------------------------------------------
  return (
    <div className="w-64 bg-card border-r border-border flex flex-col">
      {/* Brand */}
      <div className="p-4 pb-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded bg-primary" />
          <h1 className="text-lg font-semibold tracking-tight flex-1">Security Tools</h1>
          <Button size="icon" variant="ghost" className="h-7 w-7 -mr-1" title="Collapse sidebar" onClick={onToggleCollapse}>
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 pl-9">API Testing</p>
      </div>

      {/* Projects */}
      <div className="px-4 flex items-center justify-between mb-1">
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Projects</div>
        <Button size="icon" variant="ghost" className="h-6 w-6" title="New project" onClick={onNewProject}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="px-2 flex-1 overflow-auto space-y-0.5 min-h-[60px]">
        {projects.length === 0 && (
          <div className="text-xs text-muted-foreground px-2 py-3">No projects yet.</div>
        )}
        {projects.map((p) => {
          const active = p.id === currentProjectId
          return (
            <button
              key={p.id}
              onClick={() => onSwitchProject(p.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
                active ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted text-foreground'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${active ? 'bg-primary-foreground' : 'bg-muted-foreground'}`} />
              <span className="truncate">{p.name}</span>
            </button>
          )
        })}
      </div>

      {/* Config (moved out of the header) */}
      <div className="border-t border-border p-4 space-y-3">
        <div>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Environment</div>
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
          <div className="mt-1.5 text-[10px] text-muted-foreground font-mono truncate" title={config.base_url}>
            {config.base_url || 'base url not set'}
          </div>
        </div>

        <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5 justify-start" onClick={onGlobalVars}>
          <Globe className="h-3.5 w-3.5" /> Global Variables
        </Button>

        <Button onClick={onNewEndpoint} className="w-full" size="sm">+ New Endpoint</Button>
        <div className="text-[10px] text-center text-muted-foreground">{config.tests.length} endpoints</div>
      </div>
    </div>
  )
}
