import { Button } from './ui/button'
import { ThemeToggle } from './ThemeToggle'
import {
  Settings,
  Download,
  Upload,
  Activity,
  Plug,
  SlidersHorizontal,
  Loader2,
  Radio,
  AlertTriangle,
  Database,
  Eye,
  Search,
  BrainCircuit,
} from 'lucide-react'
import { Project, SharingStatus } from '../types'
import { BrandMark } from './BrandMark'

interface Props {
  currentProject?: Project
  baseUrl?: string
  sharingStatus?: SharingStatus | null
  onProjectSettings: () => void
  onManageEnv?: () => void
  onImport: () => void
  onExport: () => void
  onPreviewApis?: () => void
  onOpenPalette?: () => void
  onOpenAgent?: () => void
  exporting?: boolean
  onOpenMcp: () => void
  onOpenSettings: () => void
}

export function Header({
  currentProject,
  baseUrl,
  sharingStatus,
  onProjectSettings,
  onManageEnv,
  onImport,
  onExport,
  onPreviewApis,
  onOpenPalette,
  onOpenAgent,
  exporting = false,
  onOpenMcp,
  onOpenSettings,
}: Props) {
  const connectionProblem = ['host_offline', 'access_expired', 'identity_changed', 'conflict'].includes(
    sharingStatus?.member?.connection_state || '',
  )
  const activeEnv = currentProject?.environments?.find(
    (e) => e.id === currentProject?.current_environment_id,
  )
  const varCount = Object.keys(activeEnv?.variables || {}).filter(Boolean).length

  return (
    <div className="border-b border-border px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 bg-background/95 backdrop-blur">
      <div className="flex items-center gap-3 min-w-0">
        <BrandMark size="sm" className="hidden sm:block" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-base sm:text-lg leading-tight truncate">
              {currentProject?.name || 'Beacon workspace'}
            </h2>
            <span className="hidden md:inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              <Activity className="h-3 w-3 animate-soft-pulse" /> Ready
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            {onManageEnv && currentProject ? (
              <button
                type="button"
                onClick={onManageEnv}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-cyan-500/40 hover:text-foreground"
                title="Manage environments & variables"
              >
                <Database className="h-3 w-3 text-emerald-500" />
                <span className="font-medium text-foreground">{activeEnv?.name || 'No Env'}</span>
                {(baseUrl || activeEnv?.base_url) && (
                  <span className="hidden lg:inline font-mono text-[10px] text-muted-foreground truncate max-w-[200px]">
                    · {baseUrl || activeEnv?.base_url}
                  </span>
                )}
                {varCount > 0 && (
                  <span className="rounded bg-cyan-500/10 px-1 font-mono text-[9px] text-cyan-600 dark:text-cyan-400">
                    {varCount} {varCount === 1 ? 'var' : 'vars'}
                  </span>
                )}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">
                {currentProject?.name || 'No project selected'} / illuminate every API call
              </p>
            )}
            {sharingStatus?.sharing_enabled ? (
              <button
                type="button"
                onClick={onProjectSettings}
                className={
                  connectionProblem
                    ? 'inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-red-600 transition-colors hover:bg-red-500/15 dark:text-red-400'
                    : 'inline-flex items-center gap-1 rounded border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-blue-600 transition-colors hover:bg-blue-500/15 dark:text-blue-400'
                }
                title="This project source is shared locally"
              >
                {connectionProblem ? <AlertTriangle className="h-2.5 w-2.5" /> : <Radio className="h-2.5 w-2.5" />}
                {sharingStatus.member?.connection_state === 'conflict'
                  ? 'Sync conflict'
                  : sharingStatus.member?.connection_state === 'access_expired'
                  ? 'Rejoin required'
                  : sharingStatus.member?.connection_state === 'host_offline'
                  ? 'Host offline'
                  : sharingStatus.member?.connection_state === 'identity_changed'
                  ? 'Identity changed'
                  : `Shared r${sharingStatus.revision}`}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {onOpenPalette && (
          <Button
            variant="outline"
            size="sm"
            className="hidden xl:inline-flex h-8 gap-2 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={onOpenPalette}
            title="Open Command Palette (⌘K)"
          >
            <Search className="h-3.5 w-3.5 opacity-70" />
            <span>Commands</span>
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
          </Button>
        )}

        <div className="flex items-center rounded-lg border border-border/70 bg-card/50 p-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 font-medium"
            onClick={onImport}
            title="Import a project from a file or Git repository"
          >
            <Upload className="h-3.5 w-3.5 opacity-70" />
            <span className="hidden sm:inline">Import</span>
          </Button>
          {onPreviewApis && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 font-medium text-cyan-600 dark:text-cyan-400"
              disabled={!currentProject}
              onClick={onPreviewApis}
              title="Preview & export interactive HTML API documentation"
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden md:inline">API Preview</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 font-medium"
            disabled={!currentProject || exporting}
            onClick={onExport}
            title="Export project as HTML, Beacon JSON, OpenAPI 3.0, Postman, or Markdown"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 opacity-70" />
            )}
            <span className="hidden sm:inline">{exporting ? 'Preparing…' : 'Export'}</span>
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          className={`h-8 max-w-[200px] gap-1.5 font-medium ${
            currentProject ? 'ring-1 ring-cyan-500/20' : ''
          }`}
          disabled={!currentProject}
          onClick={onProjectSettings}
          title="Project settings"
        >
          <span className="truncate">{currentProject?.name || 'No project'}</span>
          <Settings className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
        {onOpenAgent && (
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 border border-primary/30 bg-primary/10 font-medium text-primary hover:bg-primary/20"
            onClick={onOpenAgent}
            title="Beacon AI Agent (⌘J)"
          >
            <BrainCircuit className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Beacon AI</span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 font-medium"
          onClick={onOpenMcp}
          title="MCP Server — connect any AI agent (Claude, Cursor, etc.)"
        >
          <Plug className="h-3.5 w-3.5 opacity-70" />
          <span className="hidden sm:inline">MCP</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          <SlidersHorizontal className="h-4 w-4 opacity-70" />
        </Button>
        <ThemeToggle />
      </div>
    </div>
  )
}
