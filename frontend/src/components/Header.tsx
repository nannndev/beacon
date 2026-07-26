import { Button } from './ui/button'
import { ThemeToggle } from './ThemeToggle'
import { Settings, Download, Upload, Activity, Plug, SlidersHorizontal, Loader2, Radio } from 'lucide-react'
import { Project, SharingStatus } from '../types'
import { BrandMark } from './BrandMark'

interface Props {
  currentProject?: Project
  sharingStatus?: SharingStatus | null
  onProjectSettings: () => void
  onImport: () => void
  onExport: () => void
  exporting?: boolean
  onOpenMcp: () => void
  onOpenSettings: () => void
}

export function Header({ currentProject, sharingStatus, onProjectSettings, onImport, onExport, exporting = false, onOpenMcp, onOpenSettings }: Props) {
  return (
    <div className="border-b border-border px-6 py-3 flex items-center justify-between bg-background/95 backdrop-blur">
      <div className="flex items-center gap-3">
        <BrandMark size="sm" className="hidden sm:block" />
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-lg leading-tight">Beacon workspace</h2>
            <span className="hidden md:inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              <Activity className="h-3 w-3 animate-soft-pulse" /> Ready
            </span>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">{currentProject?.name || 'No project selected'} / illuminate every API call</p>
            {sharingStatus?.sharing_enabled ? (
              <button
                type="button"
                onClick={onProjectSettings}
                className="inline-flex items-center gap-1 rounded border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-blue-600 transition-colors hover:bg-blue-500/15 dark:text-blue-400"
                title="This project source is shared locally"
              >
                <Radio className="h-2.5 w-2.5" /> Shared r{sharingStatus.revision}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-border/70 bg-card/50 p-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 font-medium"
            onClick={onImport}
            title="Import a project from a .json file"
          >
            <Upload className="h-3.5 w-3.5 opacity-70" />
            <span className="hidden sm:inline">Import</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 font-medium"
            disabled={!currentProject || exporting}
            onClick={onExport}
            title="Export this project to a .json file"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 opacity-70" />}
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
