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
