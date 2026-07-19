export type HistoryStatus = 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted'
export type HistorySource = 'endpoint' | 'folder' | 'run_all' | 'scenario'

export interface HistoryMetrics {
  attempts: number
  success: number
  rate_limited: number
  errors: number
  average_rps: number
  peak_rps: number
  min_latency_ms: number | null
  average_latency_ms: number | null
  p50_ms: number | null
  p95_ms: number | null
  p99_ms: number | null
  max_latency_ms: number | null
}

export interface HistorySummary extends Partial<HistoryMetrics> {
  id: string
  project_id: string
  project_name: string
  source_type: HistorySource
  target_id: string | null
  target_name: string
  mode: string
  status: HistoryStatus
  label: string | null
  is_pinned: boolean
  started_at: string
  completed_at: string | null
  duration_ms: number | null
}

export interface HistoryStep extends HistoryMetrics {
  sequence: number
  endpoint_id: string
  endpoint_name: string
  method: string
  url_template: string
  status: HistoryStatus | 'pending'
}

export interface HistorySample {
  sequence: number
  elapsed_ms: number
  attempts: number
  success: number
  rate_limited: number
  errors: number
  instantaneous_rps: number
  latency_ms: number | null
}

export interface HistoryEvent {
  sequence: number
  elapsed_ms: number
  outcome: 'success' | 'rate_limited' | 'error'
  status_code: number | null
  latency_ms: number | null
  error_category: string | null
  message: string | null
}

export interface HistoryDetail extends HistorySummary {
  config_snapshot: Record<string, string | number | boolean | null>
  metrics: HistoryMetrics
  steps: HistoryStep[]
  samples: HistorySample[]
  events: HistoryEvent[]
}

export interface HistoryFilters {
  project_id?: string
  mode?: string
  status?: HistoryStatus
  source_type?: HistorySource
  pinned?: boolean
  date_from?: string
  date_to?: string
  search?: string
  cursor?: string
  limit?: number
}

export interface MetricDelta {
  value: number | null
  change: number | null
  percent_change: number | null
  improved: boolean | null
}

export interface HistoryCompareResult {
  baseline: HistoryDetail
  candidate: HistoryDetail
  same_mode: boolean
  deltas: Record<string, MetricDelta>
  config_changes: Record<string, { baseline: unknown; candidate: unknown }>
  series: Array<Record<string, number | null>>
}

export interface HistoryListResponse {
  items: HistorySummary[]
  next_cursor: string | null
}

export interface HistoryHealth {
  available: boolean
  error_code: string | null
  backup_available: boolean
}
