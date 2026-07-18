// Centralized backend calls. All paths are proxied to the FastAPI backend by Vite.
// For desktop builds (Tauri production), we use a full backend URL.
import { TestConfig, Endpoint, RunConfig } from '../types'
import { isDesktop } from './platform'

const BACKEND_BASE = (import.meta as any).env?.VITE_BACKEND_URL || ''

// Resolve the backend base URL exactly once and cache it. In the desktop app
// the backend runs on an OS-assigned free port that only the Rust layer knows,
// so we ask it via the `backend_port` command. On the web this resolves to the
// configured VITE_BACKEND_URL, or '' in dev (Vite proxies the relative paths).
let basePromise: Promise<string> | null = null

async function resolveBase(): Promise<string> {
  if (BACKEND_BASE) return BACKEND_BASE
  if (isDesktop()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const port = await invoke<number>('backend_port')
      return `http://127.0.0.1:${port}`
    } catch {
      return 'http://127.0.0.1:8000'
    }
  }
  // Hosted web build without an explicit backend URL: same-origin default.
  if (import.meta.env.PROD) return 'http://127.0.0.1:8000'
  return '' // dev: relative paths hit the Vite proxy
}

function getBase(): Promise<string> {
  if (!basePromise) basePromise = resolveBase()
  return basePromise
}

/** WebSocket URL for the live run stream, mirroring the resolved backend base. */
export async function getWsUrl(): Promise<string> {
  const base = await getBase()
  if (base) return base.replace(/^http/, 'ws') + '/ws'
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

async function req<T = any>(url: string, init?: RequestInit): Promise<T> {
  const base = await getBase()
  const res = await fetch(`${base}${url}`, init)
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  // 204 / empty
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

export interface AssertionResult {
  type: string
  op: string
  expected?: unknown
  actual?: unknown
  ok: boolean
}

export interface SendResponse {
  ok: boolean
  error?: string
  status?: number
  reason?: string
  time_ms: number
  size_bytes?: number
  truncated?: boolean
  content_type?: string
  headers?: Record<string, string>
  body?: string
  json?: unknown
  target?: string
  extracted?: string[]
  attempts?: number
  assertions?: AssertionResult[]
  passed?: boolean | null
}

export interface ScenarioStep {
  test_id?: string
  name?: string
  ok: boolean
  success?: boolean
  status?: number
  time_ms?: number
  passed?: boolean | null
  extracted?: string[]
  attempts?: number
  error?: string
}

export interface ScenarioResult {
  steps: ScenarioStep[]
  passed: boolean
  completed: number
  total: number
}

export interface ProjectsResponse {
  current_project_id: string
  projects: any[]
  global_variables: Record<string, string>
}

export interface ImportProjectResponse {
  id: string
  name: string
  imported: {
    tests: number
    environments: number
  }
  config: TestConfig
}

export const api = {
  // Config
  getConfig: () => req<TestConfig>('/config'),

  // Projects
  listProjects: () => req<ProjectsResponse>('/projects'),
  createProject: (name: string, base_url?: string) =>
    req<{ id: string; name: string }>('/projects', jsonInit('POST', { name, base_url })),
  switchProject: (id: string) => req(`/projects/${id}/switch`, jsonInit('POST')),
  renameProject: (id: string, name: string) => req(`/projects/${id}`, jsonInit('PUT', { name })),
  updateProjectItems: (id: string, items: any[]) => req(`/projects/${id}`, jsonInit('PUT', { items })),
  updateEnvironments: (id: string, environments: any[]) =>
    req(`/projects/${id}`, jsonInit('PUT', { environments })),
  deleteProject: (id: string) => req(`/projects/${id}`, jsonInit('DELETE')),
  projectTemplate: () => req<Record<string, unknown>>('/projects/template'),
  exportProject: (id: string, includeSecrets = false) =>
    req<Record<string, unknown>>(`/projects/${id}/export?include_secrets=${includeSecrets ? 'true' : 'false'}`),
  importProject: (payload: unknown) =>
    req<ImportProjectResponse>('/projects/import', jsonInit('POST', payload)),

  // Environments
  createEnvironment: (projectId: string, env: { name: string; base_url: string; variables?: Record<string, string> }) =>
    req(`/projects/${projectId}/environments`, jsonInit('POST', env)),
  switchEnvironment: (projectId: string, envId: string) =>
    req(`/projects/${projectId}/environments/${envId}/switch`, jsonInit('POST')),

  // Global variables
  saveGlobal: (variables: Record<string, string>) => req('/global', jsonInit('PUT', { variables })),

  // Endpoints
  createTest: (test: Partial<Endpoint>) => req<Endpoint>('/tests', jsonInit('POST', test)),
  // Single synchronous send — returns the full response for inspection.
  sendOnce: (testId: string, opts?: { retries?: number; retry_delay?: number }) =>
    req<SendResponse>('/send', jsonInit('POST', { test_id: testId, ...opts })),
  // Run endpoints in order as one flow (chaining); variables carry between steps.
  runScenario: (testIds: string[], opts?: { continue_on_error?: boolean; retries?: number; retry_delay?: number }) =>
    req<ScenarioResult>('/scenario', jsonInit('POST', { test_ids: testIds, ...opts })),
  updateTest: (id: string, test: Partial<Endpoint>) => req<Endpoint>(`/tests/${id}`, jsonInit('PUT', test)),
  deleteTest: (id: string) => req(`/tests/${id}`, jsonInit('DELETE')),
  duplicateTest: (id: string) => req<Endpoint>(`/tests/${id}/duplicate`, jsonInit('POST')),

  // Runs
  // payload can be a plain RunConfig (load mode default) or any mode-specific dict
  startRun: (payload: Record<string, unknown>) =>
    req<{ run_id: string }>('/run', jsonInit('POST', payload)),
  stopRun: (runId: string) => req(`/stop/${runId}`, jsonInit('POST')),
  getStatus: (runId: string) => req(`/status/${runId}`),
}
