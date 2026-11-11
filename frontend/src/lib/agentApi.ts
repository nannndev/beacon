import { getBase } from './api'
import type {
  AgentApprovalMode,
  AgentContextPayload,
  AgentCustomSkill,
  AgentErrorInfo,
  AgentMessage,
  AgentModelsCatalog,
  AgentPendingCall,
  AgentPreferences,
  AgentSession,
  AgentToolTier,
} from '../types'

const PREFS_STORAGE_KEY = 'beacon.agent.preferences.v1'
const SESSIONS_STORAGE_KEY = 'beacon.agent.sessions.v1'

export interface AgentGuideOption {
  id: string
  label: string
  description: string
}

export const AGENT_GUIDES: AgentGuideOption[] = [
  {
    id: 'verify-live-first',
    label: 'Verify live before editing/load',
    description: 'Inspect state or probe with a single request before mutating endpoints or running concurrent load.',
  },
  {
    id: 'capture-examples',
    label: 'Capture baseline & assertions',
    description: 'Suggest or save example_response baselines and smart assertions when endpoints succeed live.',
  },
  {
    id: 'explain-actions',
    label: 'Explain before executing',
    description: 'Briefly state what each tool action checks or modifies before invoking it.',
  },
  {
    id: 'summary-table',
    label: 'Summary markdown tables',
    description: 'Conclude audits, scenarios, or multi-endpoint runs with a concise markdown summary table.',
  },
]

export const DEFAULT_AGENT_PREFERENCES: AgentPreferences = {
  language: 'auto',
  style: 'balanced',
  guides: ['verify-live-first', 'capture-examples'],
  skills: [],
  custom: '',
  projectNotes: {},
  maxSteps: 10,
  scope: 'global',
}

export function loadAgentPreferences(): AgentPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_AGENT_PREFERENCES }
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_AGENT_PREFERENCES,
      ...parsed,
      guides: Array.isArray(parsed.guides) ? parsed.guides : DEFAULT_AGENT_PREFERENCES.guides,
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      projectNotes:
        parsed.projectNotes && typeof parsed.projectNotes === 'object' ? parsed.projectNotes : {},
      maxSteps: Number.isFinite(Number(parsed.maxSteps))
        ? Math.max(0, Math.min(500, Math.floor(Number(parsed.maxSteps))))
        : 10,
      scope: parsed.scope === 'workspace' ? 'workspace' : 'global',
    }
  } catch {
    return { ...DEFAULT_AGENT_PREFERENCES }
  }
}

export function saveAgentPreferences(prefs: AgentPreferences): void {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // ignore quota errors
  }
}

export function loadAgentSessions(): AgentSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveAgentSessions(sessions: AgentSession[]): void {
  try {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions.slice(0, 25)))
  } catch {
    // ignore quota errors
  }
}

export function createEmptySession(
  model = 'auto',
  approvalMode: AgentApprovalMode = 'agent',
): AgentSession {
  return {
    id: `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title: 'New Agent Chat',
    updatedAt: Date.now(),
    model,
    approvalMode,
    messages: [],
  }
}

/** Parse YAML frontmatter from a SKILL.md document. */
export function parseSkillMarkdown(raw: string, filename?: string): Omit<AgentCustomSkill, 'id' | 'enabled'> {
  const trimmed = raw.replace(/\r\n/g, '\n').trim()
  const fallbackName = (filename || 'Custom Skill').replace(/\.(md|txt)$/i, '').replace(/[_-]+/g, ' ')
  const fmMatch = trimmed.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!fmMatch) {
    return { name: fallbackName, content: trimmed }
  }
  const metaBlock = fmMatch[1]
  const body = fmMatch[2].trim()
  const meta: Record<string, string> = {}
  for (const line of metaBlock.split('\n')) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
    if (val) meta[key] = val
  }
  return {
    name: meta.name || fallbackName,
    description: meta.description || undefined,
    triggers: meta.triggers || meta.keywords || undefined,
    content: body || trimmed,
  }
}

export async function fetchAgentModels(): Promise<AgentModelsCatalog> {
  const base = await getBase()
  const res = await fetch(`${base}/agent/models`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchAgentContext() {
  const base = await getBase()
  const res = await fetch(`${base}/agent/context`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Build OpenAI-compatible wire messages from UI session history. */
export function buildWireMessages(messages: AgentMessage[]): Array<Record<string, any>> {
  const wire: Array<Record<string, any>> = []
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.content.trim()) wire.push({ role: 'user', content: m.content })
      continue
    }
    if (m.rawAssistantMessage) {
      wire.push(m.rawAssistantMessage)
      if (m.toolFollowups?.length) {
        for (const f of m.toolFollowups) wire.push(f)
      }
      continue
    }
    if (m.content.trim()) {
      wire.push({ role: 'assistant', content: m.content })
    }
  }
  return wire
}

export type AgentStreamCallbacks = {
  onModel?: (model: string) => void
  onDelta?: (delta: string) => void
  onToolStart?: (ev: {
    call_id: string
    name: string
    tier?: AgentToolTier
    summary: string
    arguments?: Record<string, any>
  }) => void
  onToolResult?: (ev: {
    call_id: string
    name: string
    ok: boolean
    summary: string
    result?: Record<string, any>
    mutated?: boolean
  }) => void
  onWorkspaceChanged?: (action: string) => void
  onApprovalRequired?: (ev: {
    assistant_message: NonNullable<AgentMessage['rawAssistantMessage']>
    calls: AgentPendingCall[]
  }) => void
  onError?: (err: AgentErrorInfo) => void
}

export async function streamAgentChat(
  params: {
    messages: Array<Record<string, any>>
    context?: AgentContextPayload
    model?: string
    approvalMode?: AgentApprovalMode
    approvedCallIds?: string[]
    maxSteps?: number
    signal?: AbortSignal
  },
  callbacks: AgentStreamCallbacks,
): Promise<void> {
  const base = await getBase()
  const res = await fetch(`${base}/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: params.signal,
    body: JSON.stringify({
      messages: params.messages,
      context: params.context,
      model: params.model && params.model !== 'auto' ? params.model : undefined,
      approval_mode: params.approvalMode || 'agent',
      approved_call_ids: params.approvedCallIds,
      max_steps: params.maxSteps ?? 10,
    }),
  })

  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`
    try {
      const errJson = await res.json()
      detail = errJson?.detail || errJson?.error?.message || detail
    } catch {
      // ignore parse failure
    }
    callbacks.onError?.({
      title: 'Failed to reach Beacon AI Agent',
      items: [{ provider: 'gateway', reason: detail }],
    })
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      for (const rawLine of frame.split('\n')) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let ev: any
        try {
          ev = JSON.parse(payload)
        } catch {
          continue
        }
        switch (ev.type) {
          case 'model':
            if (ev.model) callbacks.onModel?.(ev.model)
            break
          case 'delta':
            if (typeof ev.delta === 'string') callbacks.onDelta?.(ev.delta)
            break
          case 'tool_start':
            callbacks.onToolStart?.(ev)
            break
          case 'tool_result':
            callbacks.onToolResult?.(ev)
            break
          case 'workspace_changed':
            callbacks.onWorkspaceChanged?.(ev.action || 'updated')
            break
          case 'approval_required':
            callbacks.onApprovalRequired?.(ev)
            break
          case 'error':
            if (ev.error) callbacks.onError?.(ev.error)
            break
        }
      }
    }
  }
}

