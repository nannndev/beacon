// ---------------------------------------------------------------------------
// Test mode types — one type per backend run mode
// ---------------------------------------------------------------------------

export type TestMode =
  | 'load'
  | 'ramp'
  | 'spike'
  | 'soak'
  | 'rate_probe'
  | 'fuzz'
  | 'benchmark'
  | 'scenario'

// ---- Per-mode parameter shapes --------------------------------------------

export interface LoadParams {
  concurrency: number
  max_requests: number
  delay_ms: number
  no_delay: boolean
}

export interface RampParams {
  ramp_start: number         // initial worker count
  ramp_end: number           // max worker count
  ramp_step_duration: number // seconds per step
  max_requests: number
  delay_ms: number
}

export interface SpikeParams {
  spike_baseline_workers: number
  spike_peak_workers: number
  spike_baseline_requests: number
  spike_peak_requests: number
  spike_recovery_requests: number
  delay_ms: number
}

export interface SoakParams {
  soak_duration_s: number    // total seconds
  soak_rps: number           // requests per second
  soak_concurrency: number
}

export interface RateProbeParams {
  probe_start_rps: number
  probe_step_rps: number
  probe_step_requests: number
  probe_max_rps: number
}

export type FuzzType = 'string' | 'number' | 'email' | 'sql' | 'xss' | 'empty' | 'long'

export interface FuzzParams {
  fuzz_fields: string[]                   // field names to fuzz
  fuzz_types: Record<string, FuzzType>    // field -> fuzz type
  max_requests: number
  concurrency: number
  delay_ms: number
}

export interface BenchmarkParams {
  benchmark_requests: number
  benchmark_warmup: number
}

export interface ScenarioParams {
  // test_ids are filled in from the selected endpoints
  continue_on_error: boolean
}

export type ModeParams =
  | { mode: 'load';       params: LoadParams }
  | { mode: 'ramp';       params: RampParams }
  | { mode: 'spike';      params: SpikeParams }
  | { mode: 'soak';       params: SoakParams }
  | { mode: 'rate_probe'; params: RateProbeParams }
  | { mode: 'fuzz';       params: FuzzParams }
  | { mode: 'benchmark';  params: BenchmarkParams }
  | { mode: 'scenario';   params: ScenarioParams }

// ---- Defaults -------------------------------------------------------------

export const MODE_DEFAULTS: Record<TestMode, ModeParams['params']> = {
  load: {
    concurrency: 4,
    max_requests: 200,
    delay_ms: 200,
    no_delay: false,
  } as LoadParams,
  ramp: {
    ramp_start: 1,
    ramp_end: 16,
    ramp_step_duration: 5,
    max_requests: 500,
    delay_ms: 0,
  } as RampParams,
  spike: {
    spike_baseline_workers: 2,
    spike_peak_workers: 32,
    spike_baseline_requests: 50,
    spike_peak_requests: 200,
    spike_recovery_requests: 50,
    delay_ms: 100,
  } as SpikeParams,
  soak: {
    soak_duration_s: 120,
    soak_rps: 2,
    soak_concurrency: 2,
  } as SoakParams,
  rate_probe: {
    probe_start_rps: 1,
    probe_step_rps: 2,
    probe_step_requests: 20,
    probe_max_rps: 100,
  } as RateProbeParams,
  fuzz: {
    fuzz_fields: [],
    fuzz_types: {},
    max_requests: 100,
    concurrency: 1,
    delay_ms: 100,
  } as FuzzParams,
  benchmark: {
    benchmark_requests: 100,
    benchmark_warmup: 10,
  } as BenchmarkParams,
  scenario: {
    continue_on_error: false,
  } as ScenarioParams,
}

// ---- Metadata for UI rendering -------------------------------------------

export interface ModeInfo {
  id: TestMode
  label: string
  emoji: string
  tagline: string
  description: string
  color: string           // tailwind token for accent
  danger?: boolean        // show warning badge
}

export const MODE_INFO: ModeInfo[] = [
  {
    id: 'load',
    label: 'Load',
    emoji: '⚡',
    tagline: 'Fixed concurrency',
    description: 'Hammer the API with a steady number of workers and requests. The classic load test.',
    color: 'emerald',
  },
  {
    id: 'ramp',
    label: 'Ramp',
    emoji: '📈',
    tagline: 'Gradual scale-up',
    description: 'Start slow and double workers every few seconds. Find the saturation point.',
    color: 'blue',
  },
  {
    id: 'spike',
    label: 'Spike',
    emoji: '💥',
    tagline: 'Sudden burst',
    description: 'Normal → burst → normal. Tests whether the API recovers after a traffic spike.',
    color: 'orange',
    danger: true,
  },
  {
    id: 'soak',
    label: 'Soak',
    emoji: '🛁',
    tagline: 'Low & slow endurance',
    description: 'Run at a low rate for a long time. Detects memory leaks and gradual degradation.',
    color: 'violet',
  },
  {
    id: 'rate_probe',
    label: 'Rate Probe',
    emoji: '🎯',
    tagline: 'Auto-find 429 threshold',
    description: 'Escalate RPS step by step until the API throws 429. Reports the exact threshold.',
    color: 'amber',
  },
  {
    id: 'fuzz',
    label: 'Fuzz',
    emoji: '🔀',
    tagline: 'Payload mutation',
    description: 'Inject random, malformed, or malicious values into payload fields. Security testing.',
    color: 'rose',
    danger: true,
  },
  {
    id: 'benchmark',
    label: 'Benchmark',
    emoji: '📊',
    tagline: 'Latency percentiles',
    description: 'Sequential single-thread run optimised for accurate p50/p95/p99 latency measurement.',
    color: 'cyan',
  },
  {
    id: 'scenario',
    label: 'Scenario',
    emoji: '🔗',
    tagline: 'Chained endpoints',
    description: 'Run endpoints in order as one flow. Variables extracted from each step carry forward.',
    color: 'indigo',
  },
]
