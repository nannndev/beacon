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
    revision: number
    connection_state?: 'connected' | 'read_only' | 'host_offline'
    sync_error?: string | null
  }
}

export interface SharingStatus {
  project_id: string
  sharing_enabled: boolean
  revision: number | null
  owner_device_id?: string
  source_schema_version?: number
  created_at?: string
  updated_at?: string
  host?: {
    hosting: boolean
    project_id?: string | null
    project_name?: string | null
    host_device_name?: string
    address?: string | null
    pairing_code?: string | null
    pairing_expires_at?: number | null
    connected_members?: Array<{ device_id: string; device_name: string; created_at: number; role: 'viewer' | 'editor' }>
    pending_requests?: Array<{
      request_id: string
      device_id: string
      device_name: string
      created_at: number
      status: 'pending'
    }>
    transport?: string | null
  }
  member?: {
    role: 'viewer' | 'editor'
    host_address: string
    connection_state: 'connected' | 'read_only' | 'host_offline'
    sync_error?: string | null
  }
}

export interface ProjectRevision {
  id: string
  project_id: string
  revision: number
  base_revision: number
  mutation_id: string
  actor_device_id: string
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
