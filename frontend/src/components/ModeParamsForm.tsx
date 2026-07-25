import { useState, type ReactNode } from 'react'
import { CircleHelp } from 'lucide-react'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  TestMode, ModeParams,
  LoadParams, RampParams, SpikeParams, SoakParams,
  RateProbeParams, CapacityParams, FuzzParams, BenchmarkParams, ScenarioParams,
  FuzzType, MODE_DEFAULTS,
} from '../types/testModes'

// ---- Shared primitive input -----------------------------------------------

function N({
  label, value, onChange, disabled, min, step, unit, help,
}: {
  label: string; value: number; onChange: (n: number) => void
  disabled?: boolean; min?: number; step?: number; unit?: string; help?: string
}) {
  return (
    <div className="min-w-0 w-full">
      <Label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>{label}{unit ? <span className="normal-case ml-0.5 opacity-70">({unit})</span> : ''}</span>
        {help ? <CircleHelp className="h-3 w-3 cursor-help normal-case opacity-70" aria-label={`${label}: ${help}`} title={help} /> : null}
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

function Toggle({ label, checked, onChange, fieldLabel }: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  fieldLabel?: string
}) {
  if (fieldLabel) {
    return (
      <div className="min-w-0 w-full">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{fieldLabel}</Label>
        <label className="flex items-center gap-2 h-8 mt-0.5 px-2 rounded-md border border-input bg-background text-xs cursor-pointer select-none hover:bg-muted/40 transition-colors">
          <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input accent-primary" />
          {label}
        </label>
      </div>
    )
  }
  return (
    <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none h-8 px-1">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-input accent-primary" />
      {label}
    </label>
  )
}

const GRID_COLUMNS = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
} as const

function ParameterGrid({ columns, children }: { columns: keyof typeof GRID_COLUMNS; children: ReactNode }) {
  return <div className={`grid grid-cols-2 gap-2 ${GRID_COLUMNS[columns]}`}>{children}</div>
}

// ---- Per-mode forms -------------------------------------------------------

function LoadForm({ p, set }: { p: LoadParams; set: (v: LoadParams) => void }) {
  const setRate = (rate: number) => {
    const r = Math.max(0, rate)
    set({ ...p, delay_ms: r > 0 ? Math.round(1000 / r) : 0 })
  }
  return (
    <ParameterGrid columns={5}>
      <N label="Workers"  value={p.concurrency}   onChange={(n) => set({ ...p, concurrency: Math.max(1, n) })} min={1} />
      <N label="Max Req"  value={p.max_requests}   onChange={(n) => set({ ...p, max_requests: Math.max(1, n) })} min={1} />
      <N label="Rate /s"  value={p.delay_ms > 0 ? Math.round(1000 / p.delay_ms) : 0} onChange={setRate} disabled={p.no_delay} />
      <N label="Delay"    value={p.delay_ms}        onChange={(n) => set({ ...p, delay_ms: Math.max(0, n) })} unit="ms" disabled={p.no_delay} />
      <Toggle fieldLabel="Delivery" label="No delay" checked={p.no_delay} onChange={(v) => set({ ...p, no_delay: v })} />
    </ParameterGrid>
  )
}

function RampForm({ p, set }: { p: RampParams; set: (v: RampParams) => void }) {
  return (
    <ParameterGrid columns={4}>
      <N label="Start Workers"  value={p.ramp_start}          onChange={(n) => set({ ...p, ramp_start: Math.max(1, n) })} min={1} />
      <N label="Max Workers"    value={p.ramp_end}            onChange={(n) => set({ ...p, ramp_end: Math.max(1, n) })} min={1} />
      <N label="Step Duration"  value={p.ramp_step_duration}  onChange={(n) => set({ ...p, ramp_step_duration: Math.max(1, n) })} unit="s" min={1} />
      <N label="Max Requests"   value={p.max_requests}        onChange={(n) => set({ ...p, max_requests: Math.max(1, n) })} min={1} />
    </ParameterGrid>
  )
}

function SpikeForm({ p, set }: { p: SpikeParams; set: (v: SpikeParams) => void }) {
  return (
    <div className="space-y-2">
      <ParameterGrid columns={3}>
        <N label="Baseline Workers" value={p.spike_baseline_workers} onChange={(n) => set({ ...p, spike_baseline_workers: Math.max(1, n) })} min={1} />
        <N label="Peak Workers"     value={p.spike_peak_workers}     onChange={(n) => set({ ...p, spike_peak_workers: Math.max(1, n) })} min={1} />
        <N label="Delay"            value={p.delay_ms}               onChange={(n) => set({ ...p, delay_ms: Math.max(0, n) })} unit="ms" />
        <N label="Baseline Reqs" value={p.spike_baseline_requests}  onChange={(n) => set({ ...p, spike_baseline_requests: Math.max(1, n) })} min={1} />
        <N label="Peak Reqs"     value={p.spike_peak_requests}      onChange={(n) => set({ ...p, spike_peak_requests: Math.max(1, n) })} min={1} />
        <N label="Recovery Reqs" value={p.spike_recovery_requests}  onChange={(n) => set({ ...p, spike_recovery_requests: Math.max(1, n) })} min={1} />
      </ParameterGrid>
      <div className="text-[10px] text-muted-foreground px-1">
        Phase 1 (baseline) → Phase 2 (spike) → Phase 3 (recovery). Total: {p.spike_baseline_requests + p.spike_peak_requests + p.spike_recovery_requests} requests.
      </div>
    </div>
  )
}

function SoakForm({ p, set }: { p: SoakParams; set: (v: SoakParams) => void }) {
  return (
    <ParameterGrid columns={3}>
      <N label="Duration" value={p.soak_duration_s}  onChange={(n) => set({ ...p, soak_duration_s: Math.max(10, n) })} unit="s" min={10} />
      <N label="Req/s"    value={p.soak_rps}         onChange={(n) => set({ ...p, soak_rps: Math.max(0.1, n) })} step={0.5} min={0.1} />
      <N label="Workers"  value={p.soak_concurrency} onChange={(n) => set({ ...p, soak_concurrency: Math.max(1, n) })} min={1} />
    </ParameterGrid>
  )
}

function RateProbeForm({ p, set }: { p: RateProbeParams; set: (v: RateProbeParams) => void }) {
  return (
    <ParameterGrid columns={4}>
      <N label="Start Req/s" value={p.probe_start_rps}    onChange={(n) => set({ ...p, probe_start_rps: Math.max(0.1, n) })} step={0.5} min={0.1} />
      <N label="Step Req/s"  value={p.probe_step_rps}     onChange={(n) => set({ ...p, probe_step_rps: Math.max(0.5, n) })} step={0.5} min={0.5} />
      <N label="Reqs/step"   value={p.probe_step_requests} onChange={(n) => set({ ...p, probe_step_requests: Math.max(5, n) })} min={5} />
      <N label="Max Req/s"   value={p.probe_max_rps}      onChange={(n) => set({ ...p, probe_max_rps: Math.max(1, n) })} min={1} />
    </ParameterGrid>
  )
}

function CapacityForm({ p, set }: { p: CapacityParams; set: (v: CapacityParams) => void }) {
  return (
    <div className="space-y-2">
      <ParameterGrid columns={4}>
        <N label="Start Req/s" value={p.capacity_start_rps} onChange={(n) => set({ ...p, capacity_start_rps: Math.max(0.1, n) })} step={0.5} min={0.1} />
        <N label="Step Req/s" value={p.capacity_step_rps} onChange={(n) => set({ ...p, capacity_step_rps: Math.max(0.5, n) })} step={0.5} min={0.5} />
        <N label="Reqs / step" value={p.capacity_step_requests} onChange={(n) => set({ ...p, capacity_step_requests: Math.max(10, n) })} min={10} />
        <N label="Max Req/s" value={p.capacity_max_rps} onChange={(n) => set({ ...p, capacity_max_rps: Math.max(1, n) })} min={1} />
      </ParameterGrid>
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-teal-500/15 bg-teal-500/5 p-2">
        <N label="P95 limit" value={p.capacity_p95_limit_ms} onChange={(n) => set({ ...p, capacity_p95_limit_ms: Math.max(1, n) })} unit="ms" min={1} />
        <N label="Max errors" value={p.capacity_error_limit_pct} onChange={(n) => set({ ...p, capacity_error_limit_pct: Math.max(0, n) })} unit="%" step={0.1} />
        <N label="Min success" value={p.capacity_success_min_pct} onChange={(n) => set({ ...p, capacity_success_min_pct: Math.min(100, Math.max(0, n)) })} unit="%" step={0.1} />
      </div>
      <p className="px-1 text-[10px] text-muted-foreground">Stops at the first SLO breach. The previous healthy step becomes the safe capacity.</p>
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
      <ParameterGrid columns={3}>
        <N label="Max Reqs" value={p.max_requests}  onChange={(n) => set({ ...p, max_requests: Math.max(1, n) })} min={1} />
        <N label="Workers"  value={p.concurrency}   onChange={(n) => set({ ...p, concurrency: Math.max(1, n) })} min={1} />
        <N label="Delay"    value={p.delay_ms}       onChange={(n) => set({ ...p, delay_ms: Math.max(0, n) })} unit="ms" />
      </ParameterGrid>

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
    <ParameterGrid columns={2}>
      <N label="Samples" value={p.benchmark_requests} onChange={(n) => set({ ...p, benchmark_requests: Math.max(10, n) })} min={10} />
      <N label="Warmup"  value={p.benchmark_warmup}   onChange={(n) => set({ ...p, benchmark_warmup: Math.max(0, n) })} min={0} />
    </ParameterGrid>
  )
}

function ScenarioForm({ p, set, endpointCount }: { p: ScenarioParams; set: (v: ScenarioParams) => void; endpointCount: number }) {
  const presets: Array<{ name: string; hint: string; values: ScenarioParams }> = [
    {
      name: 'Quick check',
      hint: '1 user · run the journey once',
      values: { ...MODE_DEFAULTS.scenario } as ScenarioParams,
    },
    {
      name: 'Normal traffic',
      hint: '10 users · gradual, realistic traffic',
      values: { virtual_users: 10, iterations: 3, ramp_up_s: 5, think_time_ms: 500, retries: 1, retry_delay_ms: 500, stop_failure_pct: 20, continue_on_error: false },
    },
    {
      name: 'Peak traffic',
      hint: '50 users · controlled stress',
      values: { virtual_users: 50, iterations: 5, ramp_up_s: 15, think_time_ms: 250, retries: 0, retry_delay_ms: 500, stop_failure_pct: 10, continue_on_error: false },
    },
  ]
  const plannedJourneys = p.virtual_users * p.iterations
  const activePreset = presets.find(({ values }) => Object.entries(values).every(([key, value]) => p[key as keyof ScenarioParams] === value))?.name

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/[0.04] p-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-300">Start with a preset</div>
            <div className="text-[10px] text-muted-foreground">Pick a traffic pattern, then fine-tune the values below.</div>
          </div>
          {!activePreset && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Custom</span>}
        </div>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {presets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => set({ ...preset.values })}
              className={`rounded-md border px-2.5 py-2 text-left transition-colors ${activePreset === preset.name ? 'border-indigo-400/60 bg-indigo-500/15' : 'border-border bg-background/60 hover:border-indigo-400/30 hover:bg-indigo-500/[0.06]'}`}
            >
              <span className="block text-xs font-medium text-foreground">{preset.name}</span>
              <span className="block text-[10px] text-muted-foreground">{preset.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <ParameterGrid columns={4}>
        <N label="Virtual users" help="Simulated users that run in parallel. These are workers, not real browser windows." value={p.virtual_users} onChange={(n) => set({ ...p, virtual_users: Math.max(1, n) })} min={1} />
        <N label="Iterations / user" help="How many times each virtual user repeats the selected endpoint or full journey." value={p.iterations} onChange={(n) => set({ ...p, iterations: Math.max(1, n) })} min={1} />
        <N label="Ramp-up" help="Time used to gradually activate all virtual users instead of starting them at once." value={p.ramp_up_s} onChange={(n) => set({ ...p, ramp_up_s: Math.max(0, n) })} unit="s" />
        <N label="Think time" help="Pause between endpoints in a multi-step journey. It has no effect on a single-endpoint run." value={p.think_time_ms} onChange={(n) => set({ ...p, think_time_ms: Math.max(0, n) })} unit="ms" />
      </ParameterGrid>
      <ParameterGrid columns={4}>
        <N label="Retries / step" help="Extra attempts when an endpoint fails. Zero means do not retry." value={p.retries} onChange={(n) => set({ ...p, retries: Math.max(0, n) })} />
        <N label="Retry delay" help="Pause before trying a failed endpoint again. Used only when retries is above zero." value={p.retry_delay_ms} onChange={(n) => set({ ...p, retry_delay_ms: Math.max(0, n) })} unit="ms" />
        <N label="Stop above failures" help="Automatically stop when the percentage of failed journeys exceeds this value." value={p.stop_failure_pct} onChange={(n) => set({ ...p, stop_failure_pct: Math.min(100, Math.max(0, n)) })} unit="%" step={1} />
        <Toggle fieldLabel="Failure behavior" label="Continue failed flow" checked={p.continue_on_error} onChange={(v) => set({ ...p, continue_on_error: v })} />
      </ParameterGrid>
      <div className="grid gap-1 text-[10px] text-muted-foreground sm:grid-cols-3">
        <span><strong className="text-foreground">Users</strong> run in parallel</span>
        <span><strong className="text-foreground">Iterations</strong> repeat the full journey</span>
        <span><strong className="text-foreground">Think time</strong> pauses between steps</span>
      </div>
      <div className={`rounded-md border px-2.5 py-2 text-[10px] ${plannedJourneys > 10_000 ? 'border-red-500/35 bg-red-500/10 text-red-200' : plannedJourneys > 1_000 ? 'border-amber-500/35 bg-amber-500/10 text-amber-200' : 'border-border bg-muted/30 text-muted-foreground'}`}>
        <strong className="text-foreground">{plannedJourneys.toLocaleString()} planned journeys</strong> · each virtual user gets isolated variables and tokens.
        <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
          <span className="rounded border border-border/70 bg-background/50 px-2 py-1"><strong className="text-foreground">Selected endpoint</strong> · {plannedJourneys.toLocaleString()} requests</span>
          <span className="rounded border border-border/70 bg-background/50 px-2 py-1"><strong className="text-foreground">Project journey</strong> · up to {(plannedJourneys * endpointCount).toLocaleString()} requests across {endpointCount} endpoints</span>
        </div>
        {plannedJourneys > 10_000 && <span className="block mt-0.5">Heavy traffic: lower the values unless this target is authorized and designed for this load.</span>}
        {plannedJourneys > 1_000 && plannedJourneys <= 10_000 && <span className="block mt-0.5">High traffic: verify the target and expected capacity before running.</span>}
      </div>
    </div>
  )
}

// ---- Public component -------------------------------------------------------

interface Props {
  mode: TestMode
  params: ModeParams['params']
  onChange: (p: ModeParams['params']) => void
  endpointCount?: number
}

export function ModeParamsForm({ mode, params, onChange, endpointCount = 0 }: Props) {
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
    case 'capacity':
      return <CapacityForm p={params as CapacityParams} set={onChange} />
    case 'fuzz':
      return <FuzzForm p={params as FuzzParams} set={onChange} />
    case 'benchmark':
      return <BenchmarkForm p={params as BenchmarkParams} set={onChange} />
    case 'scenario':
      return <ScenarioForm p={params as ScenarioParams} set={onChange} endpointCount={endpointCount} />
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
      case 'capacity': {
        const p = params as CapacityParams
        const steps = Math.ceil((p.capacity_max_rps - p.capacity_start_rps) / p.capacity_step_rps) + 1
        return `up to ~${steps * p.capacity_step_requests} req`
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
        return `${(params as ScenarioParams).virtual_users * (params as ScenarioParams).iterations} journeys`
      default:
        return '?'
    }
  } catch {
    return '?'
  }
}
