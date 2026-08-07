import type {
  BenchmarkParams,
  CapacityParams,
  FuzzParams,
  LoadParams,
  ModeParams,
  RampParams,
  RateProbeParams,
  SoakParams,
  SpikeParams,
  TestMode,
  WebSocketParams,
} from '../types/testModes'

/** Translate UI-oriented mode fields into the REST contract consumed by /run. */
export function buildRunPayload(
  testId: string,
  mode: TestMode,
  params: ModeParams['params'],
): Record<string, unknown> {
  const common = { test_id: testId, mode }
  switch (mode) {
    case 'load': {
      const p = params as LoadParams
      return { ...common, concurrency: p.concurrency, max_requests: p.max_requests, delay: p.delay_ms / 1000, use_min_delay: p.no_delay }
    }
    case 'ramp': {
      const p = params as RampParams
      return { ...common, ramp_start: p.ramp_start, ramp_end: p.ramp_end, ramp_step_duration: p.ramp_step_duration, max_requests: p.max_requests, delay: p.delay_ms / 1000 }
    }
    case 'spike': {
      const p = params as SpikeParams
      return {
        ...common,
        baseline_workers: p.spike_baseline_workers,
        peak_workers: p.spike_peak_workers,
        baseline_requests: p.spike_baseline_requests,
        peak_requests: p.spike_peak_requests,
        recovery_requests: p.spike_recovery_requests,
        delay: p.delay_ms / 1000,
      }
    }
    case 'soak': {
      const p = params as SoakParams
      return { ...common, duration_s: p.soak_duration_s, rps: p.soak_rps, concurrency: p.soak_concurrency }
    }
    case 'rate_probe': {
      const p = params as RateProbeParams
      return { ...common, start_rps: p.probe_start_rps, step_rps: p.probe_step_rps, step_requests: p.probe_step_requests, max_rps: p.probe_max_rps }
    }
    case 'capacity': {
      const p = params as CapacityParams
      return {
        ...common,
        start_rps: p.capacity_start_rps,
        step_rps: p.capacity_step_rps,
        step_requests: p.capacity_step_requests,
        max_rps: p.capacity_max_rps,
        p95_limit_ms: p.capacity_p95_limit_ms,
        error_limit_pct: p.capacity_error_limit_pct,
        success_min_pct: p.capacity_success_min_pct,
      }
    }
    case 'fuzz': {
      const p = params as FuzzParams
      return {
        ...common,
        fuzz_fields: Object.fromEntries(p.fuzz_fields.map((field) => [field, ''])),
        fuzz_types: p.fuzz_types,
        max_requests: p.max_requests,
        concurrency: p.concurrency,
        delay: p.delay_ms / 1000,
      }
    }
    case 'benchmark': {
      const p = params as BenchmarkParams
      return { ...common, n_samples: p.benchmark_requests, warmup: p.benchmark_warmup }
    }
    case 'scenario':
      return common
    case 'websocket': {
      const p = params as WebSocketParams
      return { ...common, concurrency: p.concurrency, max_requests: p.max_requests, delay: p.delay_ms / 1000 }
    }
  }
}
