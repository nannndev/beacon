import { useEffect, useState } from 'react'
import { Card, CardContent } from './ui/card'
import { Button } from './ui/button'
import { Play, Square, ListVideo, RotateCcw } from 'lucide-react'
import { RunConfig } from '../types'
import { RunStatus } from './LiveMonitor'
import { ModeSelector } from './ModeSelector'
import { ModeParamsForm, estimateModeDuration } from './ModeParamsForm'
import { buildRunPayload } from '../lib/modePayload'
import { TestMode, ModeParams, LoadParams, ScenarioParams } from '../types/testModes'
import {
  defaultModeParams,
  loadTestModePreferences,
  saveTestModePreferences,
} from '../lib/testModePreferences'

// ---- Legacy compat: derive a RunConfig from load params -------------------

export interface ExecSettings {
  rate: number
  delayMs: number
  maxRequests: number
  concurrency: number
  noDelay: boolean
}

export const DEFAULT_SETTINGS: ExecSettings = {
  rate: 5,
  delayMs: 200,
  maxRequests: 200,
  concurrency: 4,
  noDelay: false,
}

export function settingsToConfig(s: ExecSettings): RunConfig {
  return {
    concurrency: Math.max(1, s.concurrency),
    max_requests: Math.max(1, s.maxRequests),
    delay: s.noDelay ? 0 : Math.max(0, s.delayMs) / 1000,
    use_min_delay: s.noDelay,
  }
}

export function configToSettings(c: RunConfig): ExecSettings {
  const delayMs = Math.round((c.delay ?? 0) * 1000)
  return {
    rate: delayMs > 0 ? Math.round(1000 / delayMs) : 0,
    delayMs,
    maxRequests: c.max_requests,
    concurrency: c.concurrency,
    noDelay: c.use_min_delay,
  }
}

// ---- Props ---------------------------------------------------------------

interface Props {
  settings: ExecSettings
  onChange: (s: ExecSettings) => void
  status: RunStatus
  selectedName?: string
  hasSelection: boolean
  endpointCount: number
  overrideEnabled: boolean
  onToggleOverride: (on: boolean) => void
  onRun: (payload?: Record<string, unknown>) => void
  onRunAll: (mode: TestMode, params: ModeParams['params']) => void
  onStop: () => void
  selectedTestId?: string | null
  selectedTargetType?: 'api' | 'web'
  scenarioBusy?: boolean
}

// ---- Component -----------------------------------------------------------

export function ExecutionControls({
  settings, onChange, status, selectedName, hasSelection, endpointCount,
  overrideEnabled, onToggleOverride, onRun, onRunAll, onStop, selectedTestId, selectedTargetType = 'api', scenarioBusy = false,
}: Props) {
  const running = status === 'running' || scenarioBusy

  const [preferences, setPreferences] = useState(loadTestModePreferences)
  const mode = preferences.selectedMode
  const modeParams = preferences.paramsByMode[mode]

  useEffect(() => {
    saveTestModePreferences(preferences)
  }, [preferences])

  const handleModeChange = (m: TestMode) => {
    setPreferences((current) => ({ ...current, selectedMode: m }))
  }

  const handleParamsChange = (p: ModeParams['params']) => {
    setPreferences((current) => ({
      ...current,
      paramsByMode: { ...current.paramsByMode, [mode]: p },
    }))
    // Mirror load params back into legacy settings so other parts of UI stay in sync
    if (mode === 'load') {
      const lp = p as LoadParams
      onChange({
        rate: lp.delay_ms > 0 ? Math.round(1000 / lp.delay_ms) : 0,
        delayMs: lp.delay_ms,
        maxRequests: lp.max_requests,
        concurrency: lp.concurrency,
        noDelay: lp.no_delay,
      })
    }
  }

  const resetCurrentMode = () => handleParamsChange(defaultModeParams(mode))

  // Sync load params from legacy settings when they change externally (e.g. override toggle)
  const syncedParams: ModeParams['params'] = mode === 'load'
    ? {
        concurrency: settings.concurrency,
        max_requests: settings.maxRequests,
        delay_ms: settings.delayMs,
        no_delay: settings.noDelay,
      } as LoadParams
    : modeParams

  const estimated = estimateModeDuration(mode, syncedParams)

  const handleRun = () => {
    if (mode === 'scenario') {
      if (!selectedTestId) return
      onRun({ __scenario: true, ...syncedParams })
      return
    }
    if (!selectedTestId) return
    const payload = buildRunPayload(selectedTestId, mode, syncedParams)
    onRun(payload)
  }

  const handleRunAll = () => onRunAll(mode, syncedParams)

  return (
    <Card>
      <CardContent className="p-3 space-y-2.5">

        {/* Mode selector */}
        <ModeSelector selected={mode} onChange={handleModeChange} />

        {/* Mode parameter form */}
        <div className="pt-1 border-t border-border/60 space-y-1.5">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={resetCurrentMode}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              title="Restore the recommended defaults for this mode"
            >
              <RotateCcw className="h-3 w-3" /> Reset this mode
            </button>
          </div>
          <ModeParamsForm
            mode={mode}
            params={syncedParams}
            onChange={handleParamsChange}
            endpointCount={endpointCount}
          />
        </div>

        {/* Footer row: target label + override + est + actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
            <div>
              <div className="text-[10px] text-muted-foreground">
                {mode === 'scenario'
                  ? hasSelection
                    ? <><span>Selected: </span><span className="text-foreground font-medium">{selectedName}</span><span className={`ml-1 rounded px-1 py-0.5 font-mono text-[9px] ${selectedTargetType === 'web' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-blue-500/10 text-blue-400'}`}>{selectedTargetType.toUpperCase()}</span></>
                    : 'Select an API or Web endpoint for a single-target run'
                  : hasSelection
                  ? <><span>Target: </span><span className="text-foreground font-medium">{selectedName}</span></>
                  : 'Select an endpoint'}
                {overrideEnabled && <span className="text-amber-500"> · override</span>}
              </div>
            </div>

            {hasSelection && mode !== 'scenario' && (
              <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={overrideEnabled}
                  onChange={(e) => onToggleOverride(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-input accent-amber-500"
                />
                Override
              </label>
            )}

            {/* Estimated duration pill */}
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/60 border border-border px-2 py-1 rounded-md h-8 font-mono select-none">
              <span className="opacity-60">est.</span>
              <span className="font-semibold text-foreground">{estimated}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            {mode !== 'scenario' ? (
              <Button
                onClick={handleRunAll}
                disabled={endpointCount === 0 || running}
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                title="Run every endpoint in order (uses each endpoint's override if set)"
              >
                <ListVideo className="h-3.5 w-3.5" /> Run All
              </Button>
            ) : (
              <Button
                onClick={handleRunAll}
                disabled={endpointCount === 0 || running}
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                title="Chain every endpoint in the project in list order"
              >
                <ListVideo className="h-3.5 w-3.5" /> Run project journey
              </Button>
            )}
            <Button
              onClick={handleRun}
              disabled={!hasSelection || running}
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-600/90 text-white"
            >
              <Play className="h-3.5 w-3.5" /> {scenarioBusy ? 'Running…' : mode === 'scenario' ? 'Run selected endpoint' : 'Run'}
            </Button>
            <Button onClick={onStop} disabled={!running} size="sm" variant="destructive" className="h-8 gap-1.5">
              <Square className="h-3 w-3" /> Stop
            </Button>
          </div>
        </div>

      </CardContent>
    </Card>
  )
}
