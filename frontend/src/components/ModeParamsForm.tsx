import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  TestMode, ModeParams,
  LoadParams, RampParams, SpikeParams, SoakParams,
  RateProbeParams, FuzzParams, BenchmarkParams, ScenarioParams,
  FuzzType, MODE_DEFAULTS,
} from '../types/testModes'

// ---- Shared primitive input -----------------------------------------------

function N({
  label, value, onChange, disabled, min, step, unit, width = 'w-24',
}: {
  label: string; value: number; onChange: (n: number) => void
  disabled?: boolean; min?: number; step?: number; unit?: string; width?: string
}) {
  return (
    <div className={width}>
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}{unit ? <span className="normal-case ml-0.5 opacity-70">({unit})</span> : ''}
      </Label>
      <Input
        type="number"
        value={value}
        min={min ?? 0}
        step={step ?? 1}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-8 mt-0.5 px-2 font-mono disabled:opacity-50"
      />
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none h-8 px-1">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-input accent-primary" />
      {label}
    </label>
  )
}

// ---- Per-mode forms -------------------------------------------------------

function LoadForm({ p, set }: { p: LoadParams; set: (v: LoadParams) => void }) {
  const setRate = (rate: number) => {
    const r = Math.max(0, rate)
    set({ ...p, delay_ms: r > 0 ? Math.round(1000 / r) : 0 })
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-2">
      <N label="Workers"  value={p.concurrency}   onChange={(n) => set({ ...p, concurrency: Math.max(1, n) })} min={1} />
      <N label="Max Req"  value={p.max_requests}   onChange={(n) => set({ ...p, max_requests: Math.max(1, n) })} min={1} />
      <N label="Rate /s"  value={p.delay_ms > 0 ? Math.round(1000 / p.delay_ms) : 0} onChange={setRate} disabled={p.no_delay} />
      <N label="Delay"    value={p.delay_ms}        onChange={(n) => set({ ...p, delay_ms: Math.max(0, n) })} unit="ms" disabled={p.no_delay} />
      <Toggle label="No delay" checked={p.no_delay} onChange={(v) => set({ ...p, no_delay: v })} />
    </div>
  )
}

function RampForm({ p, set }: { p: RampParams; set: (v: RampParams) => void }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-2">
      <N label="Start Workers"  value={p.ramp_start}          onChange={(n) => set({ ...p, ramp_start: Math.max(1, n) })} min={1} />
      <N label="Max Workers"    value={p.ramp_end}            onChange={(n) => set({ ...p, ramp_end: Math.max(1, n) })} min={1} />
      <N label="Step Duration"  value={p.ramp_step_duration}  onChange={(n) => set({ ...p, ramp_step_duration: Math.max(1, n) })} unit="s" min={1} />
      <N label="Max Requests"   value={p.max_requests}        onChange={(n) => set({ ...p, max_requests: Math.max(1, n) })} min={1} />
    </div>
  )
}

function SpikeForm({ p, set }: { p: SpikeParams; set: (v: SpikeParams) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <N label="Baseline Workers" value={p.spike_baseline_workers} onChange={(n) => set({ ...p, spike_baseline_workers: Math.max(1, n) })} min={1} />
        <N label="Peak Workers"     value={p.spike_peak_workers}     onChange={(n) => set({ ...p, spike_peak_workers: Math.max(1, n) })} min={1} />
        <N label="Delay"            value={p.delay_ms}               onChange={(n) => set({ ...p, delay_ms: Math.max(0, n) })} unit="ms" />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <N label="Baseline Reqs" value={p.spike_baseline_requests}  onChange={(n) => set({ ...p, spike_baseline_requests: Math.max(1, n) })} min={1} width="w-28" />
        <N label="Peak Reqs"     value={p.spike_peak_requests}      onChange={(n) => set({ ...p, spike_peak_requests: Math.max(1, n) })} min={1} width="w-28" />
        <N label="Recovery Reqs" value={p.spike_recovery_requests}  onChange={(n) => set({ ...p, spike_recovery_requests: Math.max(1, n) })} min={1} width="w-28" />
      </div>
      <div className="text-[10px] text-muted-foreground px-1">
        Phase 1 (baseline) → Phase 2 (spike) → Phase 3 (recovery). Total: {p.spike_baseline_requests + p.spike_peak_requests + p.spike_recovery_requests} requests.
      </div>
    </div>
  )
}

function SoakForm({ p, set }: { p: SoakParams; set: (v: SoakParams) => void }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-2">
      <N label="Duration" value={p.soak_duration_s}  onChange={(n) => set({ ...p, soak_duration_s: Math.max(10, n) })} unit="s" min={10} width="w-28" />
      <N label="Req/s"    value={p.soak_rps}         onChange={(n) => set({ ...p, soak_rps: Math.max(0.1, n) })} step={0.5} min={0.1} />
      <N label="Workers"  value={p.soak_concurrency} onChange={(n) => set({ ...p, soak_concurrency: Math.max(1, n) })} min={1} />
    </div>
  )
}

function RateProbeForm({ p, set }: { p: RateProbeParams; set: (v: RateProbeParams) => void }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-2">
      <N label="Start Req/s" value={p.probe_start_rps}    onChange={(n) => set({ ...p, probe_start_rps: Math.max(0.1, n) })} step={0.5} min={0.1} />
      <N label="Step Req/s"  value={p.probe_step_rps}     onChange={(n) => set({ ...p, probe_step_rps: Math.max(0.5, n) })} step={0.5} min={0.5} />
      <N label="Reqs/step"   value={p.probe_step_requests} onChange={(n) => set({ ...p, probe_step_requests: Math.max(5, n) })} min={5} width="w-28" />
      <N label="Max Req/s"   value={p.probe_max_rps}      onChange={(n) => set({ ...p, probe_max_rps: Math.max(1, n) })} min={1} />
    </div>
  )
}

const FUZZ_TYPES: FuzzType[] = ['string', 'number', 'email', 'sql', 'xss', 'empty', 'long']

function FuzzForm({ p, set }: { p: FuzzParams; set: (v: FuzzParams) => void }) {
  const [newField, setNewField] = useState('')

  const addField = () => {
    const f = newField.trim()
    if (!f || p.fuzz_fields.includes(f)) return
    set({
      ...p,
      fuzz_fields: [...p.fuzz_fields, f],
      fuzz_types: { ...p.fuzz_types, [f]: 'string' },
    })
    setNewField('')
  }

  const removeField = (f: string) => {
    const fields = p.fuzz_fields.filter((x) => x !== f)
    const types = { ...p.fuzz_types }
    delete types[f]
    set({ ...p, fuzz_fields: fields, fuzz_types: types })
  }

  const setType = (f: string, t: FuzzType) => {
    set({ ...p, fuzz_types: { ...p.fuzz_types, [f]: t } })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <N label="Max Reqs" value={p.max_requests}  onChange={(n) => set({ ...p, max_requests: Math.max(1, n) })} min={1} />
        <N label="Workers"  value={p.concurrency}   onChange={(n) => set({ ...p, concurrency: Math.max(1, n) })} min={1} />
        <N label="Delay"    value={p.delay_ms}       onChange={(n) => set({ ...p, delay_ms: Math.max(0, n) })} unit="ms" />
      </div>

      {/* Field list */}
      {p.fuzz_fields.length > 0 && (
        <div className="space-y-1">
          {p.fuzz_fields.map((f) => (
            <div key={f} className="flex items-center gap-2 text-xs">
              <span className="font-mono bg-muted px-2 py-0.5 rounded text-[11px] min-w-[80px]">{f}</span>
              <select
                value={p.fuzz_types[f] ?? 'string'}
                onChange={(e) => setType(f, e.target.value as FuzzType)}
                className="h-6 text-xs bg-background border border-input rounded px-1"
              >
                {FUZZ_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button onClick={() => removeField(f)} className="text-muted-foreground hover:text-red-500 transition-colors text-xs">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Add field */}
      <div className="flex items-center gap-1.5">
        <Input
          placeholder="payload field name…"
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addField()}
          className="h-7 text-xs w-44"
        />
        <button
          onClick={addField}
          className="h-7 px-2 text-xs rounded-md border border-border bg-muted hover:bg-muted/70 transition-colors"
        >
          + Add field
        </button>
      </div>

      {p.fuzz_fields.length === 0 && (
        <div className="text-[10px] text-muted-foreground">Add payload field names to fuzz. All other fields use their original values.</div>
      )}
    </div>
  )
}

function BenchmarkForm({ p, set }: { p: BenchmarkParams; set: (v: BenchmarkParams) => void }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-2">
      <N label="Samples" value={p.benchmark_requests} onChange={(n) => set({ ...p, benchmark_requests: Math.max(10, n) })} min={10} width="w-28" />
      <N label="Warmup"  value={p.benchmark_warmup}   onChange={(n) => set({ ...p, benchmark_warmup: Math.max(0, n) })} min={0} />
    </div>
  )
}

function ScenarioForm({ p, set }: { p: ScenarioParams; set: (v: ScenarioParams) => void }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-2">
      <Toggle label="Continue on error" checked={p.continue_on_error} onChange={(v) => set({ ...p, continue_on_error: v })} />
      <div className="flex items-center h-8 text-[10px] text-muted-foreground">
        Runs endpoints in order as a single chained flow. Select endpoints in the sidebar.
      </div>
    </div>
  )
}

// Needed for FuzzForm useState
import { useState } from 'react'

// ---- Public component -------------------------------------------------------

interface Props {
  mode: TestMode
  params: ModeParams['params']
  onChange: (p: ModeParams['params']) => void
}

export function ModeParamsForm({ mode, params, onChange }: Props) {
  switch (mode) {
    case 'load':
      return <LoadForm p={params as LoadParams} set={onChange} />
    case 'ramp':
      return <RampForm p={params as RampParams} set={onChange} />
    case 'spike':
      return <SpikeForm p={params as SpikeParams} set={onChange} />
    case 'soak':
      return <SoakForm p={params as SoakParams} set={onChange} />
    case 'rate_probe':
      return <RateProbeForm p={params as RateProbeParams} set={onChange} />
    case 'fuzz':
      return <FuzzForm p={params as FuzzParams} set={onChange} />
    case 'benchmark':
      return <BenchmarkForm p={params as BenchmarkParams} set={onChange} />
    case 'scenario':
      return <ScenarioForm p={params as ScenarioParams} set={onChange} />
    default:
      return null
  }
}

// ---- Estimate duration text -------------------------------------------------

export function estimateModeDuration(mode: TestMode, params: ModeParams['params']): string {
  try {
    switch (mode) {
      case 'load': {
        const p = params as LoadParams
        if (p.no_delay) return '< 1s'
        const rps = p.delay_ms > 0 ? (p.concurrency * 1000) / p.delay_ms : p.concurrency * 50
        const s = Math.ceil(p.max_requests / rps)
        return s < 60 ? `~${s}s` : `~${Math.ceil(s / 60)}m`
      }
      case 'ramp': {
        const p = params as RampParams
        const steps = Math.ceil(Math.log2((p.ramp_end) / (p.ramp_start || 1))) + 1
        const s = steps * p.ramp_step_duration
        return s < 60 ? `~${s}s` : `~${Math.ceil(s / 60)}m`
      }
      case 'spike': {
        const p = params as SpikeParams
        const total = p.spike_baseline_requests + p.spike_peak_requests + p.spike_recovery_requests
        const rps = p.delay_ms > 0 ? 1000 / p.delay_ms : 50
        const s = Math.ceil(total / rps)
        return s < 60 ? `~${s}s` : `~${Math.ceil(s / 60)}m`
      }
      case 'soak': {
        const p = params as SoakParams
        const s = p.soak_duration_s
        return s < 60 ? `~${s}s` : `~${Math.ceil(s / 60)}m`
      }
      case 'rate_probe': {
        const p = params as RateProbeParams
        const steps = Math.ceil((p.probe_max_rps - p.probe_start_rps) / p.probe_step_rps) + 1
        const est = steps * p.probe_step_requests
        return `up to ~${est} req`
      }
      case 'fuzz': {
        const p = params as FuzzParams
        return `${p.max_requests} req`
      }
      case 'benchmark': {
        const p = params as BenchmarkParams
        return `${p.benchmark_warmup + p.benchmark_requests} req`
      }
      case 'scenario':
        return 'sequential'
      default:
        return '?'
    }
  } catch {
    return '?'
  }
}

// ---- Build run payload for api.startRun ------------------------------------

export function buildRunPayload(
  testId: string,
  mode: TestMode,
  params: ModeParams['params'],
): Record<string, unknown> {
  return { test_id: testId, mode, ...params }
}
