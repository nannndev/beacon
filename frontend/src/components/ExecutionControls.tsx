import { useState } from 'react'
import { Card, CardContent } from './ui/card'
import { Button } from './ui/button'
import { Play, Square, ListVideo } from 'lucide-react'
import { RunConfig } from '../types'
import { RunStatus } from './LiveMonitor'
import { ModeSelector } from './ModeSelector'
import { ModeParamsForm, estimateModeDuration, buildRunPayload } from './ModeParamsForm'
import {
  TestMode, ModeParams, MODE_DEFAULTS,
  LoadParams,
} from '../types/testModes'

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
  onRunAll: () => void
  onStop: () => void
  selectedTestId?: string | null
}

// ---- Component -----------------------------------------------------------

export function ExecutionControls({
  settings, onChange, status, selectedName, hasSelection, endpointCount,
  overrideEnabled, onToggleOverride, onRun, onRunAll, onStop, selectedTestId,
}: Props) {
  const running = status === 'running'

  // Mode state — persisted in component for the session
  const [mode, setMode] = useState<TestMode>('load')
  const [modeParams, setModeParams] = useState<ModeParams['params']>(
    () => MODE_DEFAULTS[mode]
  )

  const handleModeChange = (m: TestMode) => {
    setMode(m)
    setModeParams(MODE_DEFAULTS[m])
  }

  const handleParamsChange = (p: ModeParams['params']) => {
    setModeParams(p)
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
    if (!selectedTestId) return
    if (mode === 'scenario') {
      // Scenario mode → use existing scenario flow (handled in App.tsx via onRun with special flag)
      onRun({ __scenario: true })
      return
    }
    const payload = buildRunPayload(selectedTestId, mode, syncedParams)
    onRun(payload)
  }

  return (
    <Card>
      <CardContent className="p-3 space-y-2.5">

        {/* Mode selector */}
        <ModeSelector selected={mode} onChange={handleModeChange} />

        {/* Mode parameter form */}
        <div className="pt-1 border-t border-border/60">
          <ModeParamsForm
            mode={mode}
            params={syncedParams}
            onChange={handleParamsChange}
          />
        </div>

        {/* Footer row: target label + override + est + actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
            <div>
              <div className="text-[10px] text-muted-foreground">
                {hasSelection
                  ? <><span>Target: </span><span className="text-foreground font-medium">{selectedName}</span></>
                  : 'Select an endpoint'}
                {overrideEnabled && <span className="text-amber-500"> · override</span>}
              </div>
            </div>

            {hasSelection && (
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
            <Button
              onClick={onRunAll}
              disabled={endpointCount === 0 || running}
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              title="Run every endpoint in order (uses each endpoint's override if set)"
            >
              <ListVideo className="h-3.5 w-3.5" /> Run All
            </Button>
            <Button
              onClick={handleRun}
              disabled={!hasSelection || running}
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-600/90 text-white"
            >
              <Play className="h-3.5 w-3.5" /> Run
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
