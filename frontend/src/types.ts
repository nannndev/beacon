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

/** Per-endpoint transport settings. Only non-default values are stored. */
export interface RequestOptions {
  /** Seconds before the request is abandoned (default 10 s for runs, 30 s for Send). */
  timeout_s?: number
  /** Stored only as `false`; redirects are followed by default. */
  follow_redirects?: boolean
  /** Stored only as `false`; certificates are verified by default. */
  verify_ssl?: boolean
  /** Proxy URL for HTTP(S); may contain `{{variables}}`. */
  proxy?: string
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
  pre_request_script?: string
  graphql_query?: string
  graphql_variables?: string
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
  request_options?: RequestOptions
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
  /** Scheduled check interval in minutes; 0 = off. */
  monitor_minutes?: number
}

export interface MonitorResult {
  checked_at: string
  passed: boolean
  summary: { total: number; passed: number; failed: number } | null
  failures: { name: string; error: string | null }[]
  error?: string
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

export interface GatewayProvider {
  id: string
  alias: string
  name: string
  family: 'openai' | 'anthropic'
  default_base_url: string
  needs_key: boolean
  connected: boolean
  base_url: string | null
  api_key: string | null
  models: string[]
  seed_models?: string[]
  verified_at: number | null
  latency_ms: number | null
  cooling: boolean
}

export interface GatewayKey {
  id: string
  name: string
  key_prefix: string
  enabled: boolean
  allowed_providers: string[] | null
  rate_limit_per_min: number | null
  created_at: number
  last_used_at: number | null
  total_requests: number
  total_input_tokens: number
  total_output_tokens: number
}

export interface GatewayUsage {
  id: string
  ts: number
  key_name: string
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  duration_ms: number
  status: 'success' | 'error'
  status_code: number
  error: string | null
  streaming: boolean
}

export interface GatewayStats {
  requests: number
  input_tokens: number
  output_tokens: number
  errors: number
  active_keys: number
  connected_providers: number
}

export type OAuthProviderId =
  | 'claude'
  | 'codex'
  | 'copilot'
  | 'gemini-cli'
  | 'kimi'
  | 'kilocode'
  | 'muse'
  | 'nous'

export interface OAuthProviderMeta {
  id: OAuthProviderId
  alias: string
  name: string
  plan: string
  flow: 'redirect' | 'device'
  family: string
}

export interface OAuthAccount {
  id: string
  provider: OAuthProviderId
  label: string | null
  email: string | null
  plan?: string | null
  is_free?: boolean
  connected_at: number
  refreshed_at: number | null
  expires_at: number | null
  last_error: string | null
}

export interface OAuthQuotaWindow {
  label: string
  used_pct: number
  resets_at: string | null
}

export interface OAuthProviderUsageStats {
  today_requests?: number
  today_tokens?: number
  total_requests?: number
  total_tokens?: number
}

export interface OAuthAccountUsage {
  provider: OAuthProviderId
  account_id: string
  email: string | null
  last_error: string | null
  windows: OAuthQuotaWindow[]
  plan?: string | null
  limit_reached?: boolean
  error?: string
  fetched_at?: number
  gateway_stats: OAuthProviderUsageStats
}

export interface GatewaySettings {
  routing_strategy: 'ordered' | 'round_robin'
  gemini_oauth_client_id: string
  gemini_oauth_client_secret_masked: string | null
  gemini_oauth_configured: boolean
}

export interface OAuthAccountsState {
  accounts: OAuthAccount[]
  models: Record<string, string[]>
  aliases: Record<string, string>
  providers: OAuthProviderMeta[]
  settings: GatewaySettings
}

export interface OAuthLoginStart {
  kind: 'redirect' | 'device'
  session_id: string
  auth_url?: string
  redirect_uri?: string
  auto_callback?: boolean
  user_code?: string
  verification_uri?: string
  interval?: number
  expires_in?: number
}

// ── Beacon AI Agent ──────────────────────────────────────────────────────────

export type AgentApprovalMode = 'safe' | 'agent' | 'full'

export type AgentToolTier = 'read' | 'probe' | 'write' | 'heavy'

export interface AgentToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface AgentPendingCall {
  id: string
  name: string
  tier: AgentToolTier
  summary: string
  arguments: Record<string, any>
}

export interface AgentToolExecution {
  call_id: string
  name: string
  tier?: AgentToolTier
  summary: string
  arguments?: Record<string, any>
  status: 'running' | 'done' | 'error' | 'skipped'
  ok?: boolean
  mutated?: boolean
  result?: Record<string, any>
}

export interface AgentErrorInfo {
  title: string
  items?: Array<{ provider: string; reason: string; detail?: string }>
  hint?: string
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  kind?: 'compact'
  content: string
  model?: string
  step?: number
  createdAt: number
  toolExecutions?: AgentToolExecution[]
  rawAssistantMessage?: {
    role: 'assistant'
    content: string
    tool_calls?: AgentToolCall[]
  }
  toolFollowups?: Array<{
    role: 'tool'
    tool_call_id: string
    content: string
  }>
  pendingApproval?: {
    calls: AgentPendingCall[]
    resolved?: 'approved' | 'skipped'
  }
  error?: AgentErrorInfo
}

export interface AgentCustomSkill {
  id: string
  name: string
  description?: string
  triggers?: string
  content: string
  enabled: boolean
}

export interface AgentPreferences {
  language: 'auto' | 'id' | 'en'
  style: 'concise' | 'balanced' | 'detailed'
  guides: string[]
  skills: AgentCustomSkill[]
  custom: string
  projectNotes: Record<string, string>
  maxSteps: number
}

export interface AgentModelsCatalog {
  has_any: boolean
  default_model: string | null
  combos: Array<{ id: string; label: string; targets: string[] }>
  subscriptions: Array<{ provider: string; alias: string; models: string[] }>
  apikeys: Array<{ provider: string; alias: string; models: string[] }>
}

export interface AgentContextPayload {
  view: string
  projectId: string | null
  projectName: string | null
  baseUrl?: string | null
  environmentName?: string | null
  selectedEndpointId?: string | null
  selectedEndpointName?: string | null
  selectedEndpointMethod?: string | null
  selectedEndpointUrl?: string | null
  selectedHistoryRunId?: string | null
  lastSendResult?: {
    status_code?: number
    elapsed_ms?: number
    ok?: boolean
    error?: string
    body_preview?: string
    assertions_passed?: number
    assertions_failed?: number
  } | null
  preferences?: Partial<AgentPreferences>
}

export interface AgentSession {
  id: string
  title: string
  updatedAt: number
  projectId?: string | null
  projectName?: string | null
  model: string
  approvalMode: AgentApprovalMode
  messages: AgentMessage[]
}

export type AgentBubbleAction =
  | 'approve'
  | 'approveAll'
  | 'skip'
  | 'stop'
  | 'retry'
  | 'dismiss'

export interface AgentLiveStatus {
  state: 'idle' | 'thinking' | 'executing' | 'approval' | 'limit' | 'done' | 'error'
  mode: AgentApprovalMode
  projectName?: string
  command?: string
  preview?: string
  step?: number
  maxSteps?: number
  pendingCount?: number
  isRisky?: boolean
}
