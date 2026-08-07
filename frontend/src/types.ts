export interface RunConfig {
  concurrency: number
  max_requests: number
  delay: number // seconds
  use_min_delay: boolean
}

export interface EndpointAuth {
  type: 'none' | 'inherit' | 'bearer' | 'basic' | 'apikey' | 'custom'
  /** bearer / apikey / custom */
  token?: string
  value?: string
  /** apikey / custom header name */
  key?: string
  header?: string
  in?: 'header' | 'query'
  /** basic */
  username?: string
  password?: string
}

export interface MockResponse {
  enabled: boolean
  status: number
  headers: Record<string, string>
  body: string
}

export interface Endpoint {
  id: string
  name: string
  url: string
  method: string
  headers: Record<string, string>
  payload: Record<string, any>
  payload_type: string
  /** `web` measures an HTML document request; `api` is the default request target;
   *  `websocket` connects to a ws:// / wss:// endpoint for bidirectional testing. */
  target_type?: 'api' | 'web' | 'websocket'
  ws_message?: string
  ws_message_type?: 'text' | 'binary'
  extractors?: Record<string, string>
  /** Structured auth. `inherit` defers to the enclosing folder, then the
   *  project; Basic credentials are base64-encoded by the backend at request
   *  time so they can come from `{{variables}}`. */
  auth?: EndpointAuth | null
  run_config?: RunConfig | null
  assertions?: Array<{
    type: string
    op?: string
    value?: unknown
    value_type?: 'string' | 'number' | 'boolean' | 'null'
    name?: string
    path?: string
  }>
  mock_response?: MockResponse | null
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
  slack_webhook?: string
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
  file_sync?: {
    path: string
    schema_version: number
    last_synced_hash?: string | null
    last_synced_at?: string | null
    last_error?: string | null
    local_dirty?: boolean
  }
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

export type ProjectFileSyncState = 'unlinked' | 'clean' | 'external_changes' | 'conflict' | 'missing_folder' | 'invalid_source' | 'write_error'

export interface ProjectFileSyncStatus {
  linked: boolean
  path: string | null
  state: ProjectFileSyncState
  last_synced_at: string | null
  local_dirty?: boolean
  last_error?: string | null
  changes: Array<{ path: string; kind: 'added' | 'modified' | 'deleted' }>
  message: string
}

export interface ProjectGitStatus {
  available: boolean
  repository: boolean
  branch: string | null
  remote_url: string | null
  upstream: string | null
  ahead: number
  behind: number
  changes: Array<{ path: string; status: string }>
  message: string
}

export interface ProjectGitBranch {
  name: string
  full_name: string
  kind: 'local' | 'remote'
  current: boolean
  upstream: string | null
  local_name?: string | null
}

export interface ProjectGitBranches {
  current: string | null
  remote_url: string | null
  local: ProjectGitBranch[]
  remote: ProjectGitBranch[]
}

export interface ProjectGitBranchComparison {
  current: string | null
  target: string
  current_only_commits: number
  target_only_commits: number
  summary: { added: number; modified: number; deleted: number }
  files: Array<{
    path: string
    status: 'added' | 'modified' | 'deleted'
    additions: number
    deletions: number
  }>
}

export interface ProjectGitDiffFile {
  path: string
  status: string
  patch: string
  additions: number
  deletions: number
  truncated: boolean
}

export interface ProjectGitDiff {
  scope: 'working' | 'last_commit'
  commit: null | {
    id: string
    short_id: string
    subject: string
    author: string
    committed_at: string
  }
  files: ProjectGitDiffFile[]
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
  target_type?: 'api' | 'web' | 'websocket'
  ws_message_type?: string
  ws_received_type?: string
  error?: string
}
