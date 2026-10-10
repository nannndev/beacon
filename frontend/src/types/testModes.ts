// ---------------------------------------------------------------------------
// Test mode types — one type per backend run mode
// ---------------------------------------------------------------------------

import {
  Activity, BarChart3, Gauge, Hourglass, PlugZap, Shuffle, Target, TrendingUp,
  Workflow, Zap, type LucideIcon,
} from 'lucide-react'

export type TestMode =
  | 'load'
  | 'ramp'
  | 'spike'
  | 'soak'
  | 'rate_probe'
  | 'capacity'
  | 'fuzz'
  | 'benchmark'
  | 'scenario'
  | 'websocket'

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

export interface CapacityParams {
  capacity_start_rps: number
  capacity_step_rps: number
  capacity_step_requests: number
  capacity_max_rps: number
  capacity_p95_limit_ms: number
  capacity_error_limit_pct: number
  capacity_success_min_pct: number
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
  continue_on_error: boolean
  virtual_users: number
  iterations: number
  ramp_up_s: number
  think_time_ms: number
  retries: number
  retry_delay_ms: number
  stop_failure_pct: number
}

export interface WebSocketParams {
  concurrency: number
  max_requests: number
  delay_ms: number
}

export type ModeParams =
  | { mode: 'load';       params: LoadParams }
  | { mode: 'ramp';       params: RampParams }
  | { mode: 'spike';      params: SpikeParams }
  | { mode: 'soak';       params: SoakParams }
  | { mode: 'rate_probe'; params: RateProbeParams }
  | { mode: 'capacity';   params: CapacityParams }
  | { mode: 'fuzz';       params: FuzzParams }
  | { mode: 'benchmark';  params: BenchmarkParams }
  | { mode: 'scenario';   params: ScenarioParams }
  | { mode: 'websocket';  params: WebSocketParams }

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
  capacity: {
    capacity_start_rps: 5,
    capacity_step_rps: 5,
    capacity_step_requests: 30,
    capacity_max_rps: 200,
    capacity_p95_limit_ms: 500,
    capacity_error_limit_pct: 1,
    capacity_success_min_pct: 99,
  } as CapacityParams,
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
    virtual_users: 1,
    iterations: 1,
    ramp_up_s: 0,
    think_time_ms: 250,
    retries: 0,
    retry_delay_ms: 500,
    stop_failure_pct: 100,
  } as ScenarioParams,
  websocket: {
    concurrency: 4,
    max_requests: 200,
    delay_ms: 200,
  } as WebSocketParams,
}

// ---- Metadata for UI rendering -------------------------------------------

export interface ModeInfo {
  id: TestMode
  label: string
  icon: LucideIcon        // lucide glyph for cards and pills
  tagline: string
  description: string
  /** One short line summarising how the mode behaves, shown under the form. */
  summary: string
  color: string           // tailwind token for accent
  danger?: boolean        // show warning badge
}

export const MODE_INFO: ModeInfo[] = [
  {
    id: 'load',
    label: 'Load',
    icon: Zap,
    tagline: 'Fixed concurrency',
    description: 'Hammer the API with a steady number of workers and requests. The classic load test.',
    summary: 'A fixed pool of workers fires requests at a steady rate until the request budget runs out.',
    color: 'emerald',
  },
  {
    id: 'ramp',
    label: 'Ramp',
    icon: TrendingUp,
    tagline: 'Gradual scale-up',
    description: 'Start slow and double workers every few seconds. Find the saturation point.',
    summary: 'Worker count doubles each step until it reaches the max, revealing where throughput stops scaling.',
    color: 'blue',
  },
  {
    id: 'spike',
    label: 'Spike',
    icon: Activity,
    tagline: 'Sudden burst',
    description: 'Normal → burst → normal. Tests whether the API recovers after a traffic spike.',
    summary: 'Runs a baseline, slams a short burst of peak workers, then drops back to measure recovery.',
    color: 'orange',
    danger: true,
  },
  {
    id: 'soak',
    label: 'Soak',
    icon: Hourglass,
    tagline: 'Low & slow endurance',
    description: 'Run at a low rate for a long time. Detects memory leaks and gradual degradation.',
    summary: 'Holds a steady low rate for the full duration to surface leaks and slow degradation over time.',
    color: 'violet',
  },
  {
    id: 'rate_probe',
    label: 'Rate Probe',
    icon: Target,
    tagline: 'Auto-find 429 threshold',
    description: 'Escalate RPS step by step until the API throws 429. Reports the exact threshold.',
    summary: 'Raises the request rate step by step and stops at the first 429, reporting the limit it found.',
    color: 'amber',
  },
  {
    id: 'capacity',
    label: 'Capacity',
    icon: Gauge,
    tagline: 'Find safe RPS',
    description: 'Increase traffic until latency, errors, or success rate breaks your SLO. Reports safe capacity and the breaking point.',
    summary: 'Climbs the rate until an SLO breaks; the last healthy step is reported as safe capacity.',
    color: 'teal',
  },
  {
    id: 'fuzz',
    label: 'Fuzz',
    icon: Shuffle,
    tagline: 'Payload mutation',
    description: 'Inject random, malformed, or malicious values into payload fields. Security testing.',
    summary: 'Replaces the chosen payload fields with mutated values each request to probe input handling.',
    color: 'rose',
    danger: true,
  },
  {
    id: 'benchmark',
    label: 'Benchmark',
    icon: BarChart3,
    tagline: 'Latency percentiles',
    description: 'Sequential single-thread run optimised for accurate p50/p95/p99 latency measurement.',
    summary: 'Fires one request at a time after a warm-up, for clean p50/p95/p99 latency numbers.',
    color: 'cyan',
  },
  {
    id: 'scenario',
    label: 'Scenario',
    icon: Workflow,
    tagline: 'Virtual user journeys',
    description: 'Run chained endpoints with isolated users, iterations, ramp-up, think time, retries, and per-step performance.',
    summary: 'Virtual users run the endpoint or project journey in parallel, each with isolated variables and tokens.',
    color: 'indigo',
  },
  {
    id: 'websocket',
    label: 'WebSocket',
    icon: PlugZap,
    tagline: 'Message throughput',
    description: 'Open concurrent WebSocket connections and measure message exchange latency and throughput.',
    summary: 'Opens concurrent WebSocket connections and exchanges messages to measure latency and throughput.',
    color: 'blue',
  },
]
