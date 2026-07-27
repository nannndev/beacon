export interface RunConfig {
  concurrency: number
  max_requests: number
  delay: number // seconds
  use_min_delay: boolean
}

export interface Endpoint {
  id: string
  name: string
  url: string
  method: string
  headers: Record<string, string>
  payload: Record<string, any>
  payload_type: string
  /** `web` measures an HTML document request; `api` is the default request target. */
  target_type?: 'api' | 'web'
  extractors?: Record<string, string>
  run_config?: RunConfig | null
  assertions?: Array<{
    type: string
    op?: string
    value?: unknown
    value_type?: 'string' | 'number' | 'boolean' | 'null'
    name?: string
    path?: string
  }>
}

export interface TestConfig {
  base_url: string
  variables: Record<string, string>
  tests: Endpoint[]   // flattened requests for execution (derived from items tree)
}

export interface Environment {
  id: string
  name: string
  base_url: string
  variables: Record<string, string>
}

export type CollectionItem =
  | {
      id: string
      name: string
      type: 'folder'
      items: CollectionItem[]
    }
  | (Endpoint & {
      type: 'request'
    })

export type NotifyMode = 'off' | 'on_failure' | 'always'

export interface ProjectNotifications {
  discord_webhook?: string
  mode?: NotifyMode
}

export interface Project {
  id: string
  name: string
  template_id?: string
  environments: Environment[]
  current_environment_id?: string
  notifications?: ProjectNotifications
  items: CollectionItem[]   // tree structure like Postman (supports folders)
  // legacy flat support during migration
  tests?: Endpoint[]
  shared_origin?: {
    host_address: string
    host_device_id?: string
    role: 'viewer' | 'editor'
    app_version?: string | null
    platform?: string | null
    protocol?: number | null
    revision: number
    connection_state?: 'connected' | 'read_only' | 'host_offline' | 'access_expired' | 'identity_changed' | 'conflict'
    sync_error?: string | null
    conflict?: SharingConflict | null
  }
}

export interface SharingStatus {
  project_id: string
  sharing_enabled: boolean
  revision: number | null
  owner_device_id?: string
  trusted_devices?: Array<{
    project_id: string
    device_id: string
    device_name: string
    role: 'viewer' | 'editor'
    device_ip?: string | null
    created_at: string
    last_seen_at: string
  }>
  source_schema_version?: number
  created_at?: string
  updated_at?: string
  host?: {
    hosting: boolean
    project_id?: string | null
    project_name?: string | null
    host_device_name?: string
    host_device_id?: string
    host_device_ip?: string
    certificate_fingerprint?: string
    address?: string | null
    pairing_code?: string | null
    pairing_expires_at?: number | null
    connected_members?: Array<{ device_id: string; device_name: string; device_ip?: string; created_at: number; last_seen?: number; connection_state?: 'online' | 'offline'; role: 'viewer' | 'editor'; active_target_id?: string | null; active_target_name?: string | null; activity?: 'viewing' | 'editing' | null; app_version?: string; platform?: string; protocol?: number; capabilities?: string[] }>
    pending_requests?: Array<{
      request_id: string
      device_id: string
      device_name: string
      device_ip?: string
      created_at: number
      status: 'pending'
      app_version?: string
      platform?: string
      protocol?: number
    }>
    transport?: string | null
  }
  member?: {
    role: 'viewer' | 'editor'
    host_address: string
    connection_state: 'connected' | 'read_only' | 'host_offline' | 'access_expired' | 'identity_changed' | 'conflict'
    sync_error?: string | null
    conflict?: SharingConflict | null
    last_seen_at?: string | null
    offline_since?: string | null
    retry_count?: number
    discovered_at?: string | null
    certificate_fingerprint?: string | null
  }
}

export interface SharingConflict {
  current_revision: number
  local_source?: Record<string, unknown>
  team_source?: Record<string, unknown>
  detected_at: string
  merged_source?: Record<string, unknown>
  fields?: Array<{
    path: Array<string | number>
    label: string
    base_value: unknown
    team_value: unknown
    local_value: unknown
  }>
}

export interface ProjectRevision {
  id: string
  project_id: string
  revision: number
  base_revision: number
  mutation_id: string
  actor_device_id: string
  actor_device_name?: string | null
  actor_device_ip?: string | null
  operation: string
  target_type: string
  target_id?: string | null
  summary: string
  patch: Record<string, unknown>
  created_at: string
}

export interface AppData {
  current_project_id: string
  projects: Project[]
  global_variables: Record<string, string>
}

export interface RunStatus {
  status: string
  stats: {
    attempts: number
    success: number
    rate_limited: number
    errors: number
  }
  logs: string[]
}

export interface RunResponse {
  attempt: number
  method?: string
  url?: string
  status?: number
  time?: number
  success?: boolean
  rate_limited?: boolean
  body?: string
  size_bytes?: number
  final_url?: string
  redirects?: number
  target_type?: 'api' | 'web'
  error?: string
}
