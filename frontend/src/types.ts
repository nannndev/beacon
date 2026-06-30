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
  extractors?: Record<string, string>
  run_config?: RunConfig | null
}

export interface TestConfig {
  base_url: string
  variables: Record<string, string>
  tests: Endpoint[]
}

export interface Environment {
  id: string
  name: string
  base_url: string
  variables: Record<string, string>
}

export interface Project {
  id: string
  name: string
  environments: Environment[]
  current_environment_id?: string
  tests: any[]  // reuse Endpoint[]
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
  error?: string
}