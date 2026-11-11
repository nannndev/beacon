import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Command,
  Copy,
  Download,
  FolderKanban,
  History,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Paperclip,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { toast } from './ui/toast'
import type {
  AgentApprovalMode,
  AgentBubbleAction,
  AgentContextPayload,
  AgentErrorInfo,
  AgentLiveStatus,
  AgentMessage,
  AgentModelsCatalog,
  AgentPendingCall,
  AgentPreferences,
  AgentSession,
} from '../types'
import {
  buildWireMessages,
  createEmptySession,
  DEFAULT_AGENT_PREFERENCES,
  fetchAgentModels,
  loadAgentPreferences,
  loadAgentSessions,
  saveAgentPreferences,
  saveAgentSessions,
  streamAgentChat,
} from '../lib/agentApi'
import { AgentModelPicker, parseModelItem } from './agent/AgentModelPicker'
import { AgentSettings } from './agent/AgentSettings'
import { AgentCharacter } from './agent/AgentCharacter'

interface AgentDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: AgentContextPayload
  onWorkspaceChanged: () => void | Promise<void>
  onOpenGateway?: () => void
  onStatusChange?: (status: AgentLiveStatus) => void
  onActionReady?: (handler: ((action: AgentBubbleAction) => void) | null) => void
  origin?: { x: number; y: number }
}

interface SlashCommandItem {
  cmd: string
  title: string
  desc: string
  prompt?: string
  action?: 'clear' | 'compact'
}

const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    cmd: '/compact',
    title: 'Compact Context',
    desc: 'Summarize older turns and tool outputs to save tokens & speed up replies',
    action: 'compact',
  },
  {
    cmd: '/audit',
    title: 'Full Project Audit',
    desc: 'Inspect endpoints, unresolved {{variables}}, missing assertions, and auth setup',
    prompt: 'Audit the active project: check base URL, active environment variables, unresolved {{tokens}}, missing assertions, and auth/extractor wiring, then give a concise prioritized summary table.',
  },
  {
    cmd: '/curl',
    title: 'Import / Convert cURL',
    desc: 'Turn a cURL snippet into a reusable Beacon endpoint with variables & assertions',
    prompt: 'Ask me for the cURL command (or inspect my current endpoint) and import it cleanly using {{variables}} and smart assertions.',
  },
  {
    cmd: '/assert',
    title: 'Probe & Capture Baseline',
    desc: 'Send live request to focused endpoint and save response baseline + assertions',
    prompt: 'Send a live request to my currently focused endpoint (or ask which one if none is focused), inspect the status/latency/body, and save its response baseline and smart assertions.',
  },
  {
    cmd: '/load',
    title: 'Load & Rate-Limit Check',
    desc: 'Verify endpoint live first, then propose or run a safe load / 429 rate_limit test',
    prompt: 'Identify the right target in the active project, probe it once first to verify 2xx health, and recommend or execute a safe rate_limit / fixed load test summarizing throughput and p95/p99 latency.',
  },
  {
    cmd: '/chain',
    title: 'Design Token Extractor Chain',
    desc: 'Wire login -> token extractor -> downstream endpoints and verify scenario',
    prompt: 'Inspect my project endpoints to design a login -> extractor -> protected endpoint scenario chain, configure any missing extractors, and verify the flow.',
  },
  {
    cmd: '/clear',
    title: 'New Conversation',
    desc: 'Start a fresh Agent conversation',
    action: 'clear',
  },
]

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1 px-1" aria-label="typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 animate-pulse"
          style={{ animationDelay: `${i * 160}ms`, animationDuration: '1.2s' }}
        />
      ))}
    </div>
  )
}

function ChipSelect({
  icon,
  label,
  value,
  onChange,
  options,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; hint?: string }[]
}) {
  const current = options.find((o) => o.value === value) || options[0]
  return (
    <label
      title={`${label}: ${current?.label}${current?.hint ? ` (${current.hint})` : ''}`}
      className="relative h-7 px-2 rounded-lg text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1 min-w-0 max-w-[140px] cursor-pointer transition-colors"
    >
      {icon}
      <span className="truncate">{current?.label}</span>
      <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.hint ? `${o.label} (${o.hint})` : o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function ErrorCard({
  error,
  onOpenGateway,
}: {
  error: AgentErrorInfo
  onOpenGateway?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div role="alert" className="mt-1 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3 text-[12px] space-y-2">
      <div className="flex items-center gap-2 font-semibold text-red-600 dark:text-red-400">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error.title}
      </div>
      {error.items && error.items.length > 0 && (
        <ul className="space-y-1">
          {error.items.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] text-foreground">{it.provider}</span>
              <span className="text-[11px] text-muted-foreground">{it.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {error.hint && <p className="text-[11px] text-muted-foreground">{error.hint}</p>}
      <div className="flex items-center gap-3 text-[11px]">
        {onOpenGateway && (
          <button
            type="button"
            onClick={onOpenGateway}
            className="font-medium text-foreground underline underline-offset-2 cursor-pointer"
          >
            Open AI Gateway
          </button>
        )}
        {error.items?.some((it) => it.detail) && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {open ? 'Hide details' : 'Show details'}
          </button>
        )}
      </div>
      {open && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background border border-border p-2 text-[10px] text-muted-foreground">
          {error.items
            ?.filter((it) => it.detail)
            .map((it) => `${it.provider}: ${it.detail}`)
            .join('\n\n')}
        </pre>
      )}
    </div>
  )
}

/** Rich lightweight markdown matching 7Server: headings, tables, blockquotes, lists, code fences. */
function RichMarkdown({ text }: { text: string }) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const segments = useMemo(() => {
    const out: Array<{ kind: 'text' | 'code'; lang?: string; body: string }> = []
    const re = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ kind: 'text', body: text.slice(last, m.index) })
      out.push({ kind: 'code', lang: m[1] || 'text', body: m[2].replace(/\n$/, '') })
      last = m.index + m[0].length
    }
    if (last < text.length) out.push({ kind: 'text', body: text.slice(last) })
    return out
  }, [text])

  const inline = (line: string, keyPrefix: string) =>
    line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((t, idx) =>
      t.startsWith('**') && t.endsWith('**') && t.length > 4 ? (
        <strong key={`${keyPrefix}-${idx}`} className="font-semibold text-foreground">
          {t.slice(2, -2)}
        </strong>
      ) : t.startsWith('`') && t.endsWith('`') && t.length > 2 ? (
        <code key={`${keyPrefix}-${idx}`} className="px-1 py-px rounded bg-muted font-mono text-[11.5px] text-foreground">
          {t.slice(1, -1)}
        </code>
      ) : (
        <React.Fragment key={`${keyPrefix}-${idx}`}>{t}</React.Fragment>
      ),
    )

  return (
    <div className="space-y-2 text-[13px] leading-relaxed break-words">
      {segments.map((seg, segIdx) => {
        if (seg.kind === 'code') {
          return (
            <div key={segIdx} className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 my-2">
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 text-[11px] font-mono text-zinc-400">
                <span>{seg.lang}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(seg.body)
                    setCopiedIdx(segIdx)
                    setTimeout(() => setCopiedIdx(null), 1500)
                  }}
                  className="px-1.5 py-0.5 rounded hover:bg-zinc-800 text-zinc-300 inline-flex items-center gap-1"
                >
                  {copiedIdx === segIdx ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span className="text-[10px]">{copiedIdx === segIdx ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <pre className="p-3 overflow-x-auto max-h-64 font-mono text-[11px] text-zinc-200 leading-normal">
                <code>{seg.body}</code>
              </pre>
            </div>
          )
        }

        const lines = seg.body.replace(/^\n+|\n+$/g, '').split('\n')
        const blocks: React.ReactNode[] = []
        let i = 0
        while (i < lines.length) {
          const l = lines[i]
          if (
            l.trim().startsWith('|') &&
            i + 1 < lines.length &&
            /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])
          ) {
            const parseRow = (row: string) =>
              row
                .trim()
                .replace(/^\||\|$/g, '')
                .split('|')
                .map((c) => c.trim())
            const headers = parseRow(l)
            i += 2
            const rows: string[][] = []
            while (i < lines.length && lines[i].trim().startsWith('|')) {
              rows.push(parseRow(lines[i]))
              i++
            }
            blocks.push(
              <div key={`tbl-${segIdx}-${i}`} className="my-2 overflow-x-auto rounded-xl border border-border bg-background/70">
                <table className="w-full text-left border-collapse text-[11.5px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      {headers.map((h, hi) => (
                        <th key={hi} className="px-2.5 py-1.5 font-semibold text-foreground">
                          {inline(h, `th-${segIdx}-${i}-${hi}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {rows.map((r, ri) => (
                      <tr key={ri} className="hover:bg-muted/20">
                        {headers.map((_, ci) => (
                          <td key={ci} className="px-2.5 py-1.5 text-foreground/90">
                            {inline(r[ci] || '', `td-${segIdx}-${i}-${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>,
            )
            continue
          }

          const t = l.trim()
          if (!t) {
            blocks.push(<div key={`sp-${segIdx}-${i}`} className="h-1" />)
          } else if (t.startsWith('### ')) {
            blocks.push(
              <h4 key={`h3-${segIdx}-${i}`} className="pt-1 text-xs font-semibold uppercase tracking-wide text-foreground">
                {inline(t.slice(4), `${segIdx}-${i}`)}
              </h4>,
            )
          } else if (t.startsWith('## ') || t.startsWith('# ')) {
            blocks.push(
              <h3 key={`h2-${segIdx}-${i}`} className="pt-1 text-sm font-semibold text-foreground">
                {inline(t.replace(/^#+\s*/, ''), `${segIdx}-${i}`)}
              </h3>,
            )
          } else if (t.startsWith('> ')) {
            blocks.push(
              <blockquote key={`bq-${segIdx}-${i}`} className="border-l-2 border-emerald-500/50 pl-2.5 text-muted-foreground italic">
                {inline(t.slice(2), `${segIdx}-${i}`)}
              </blockquote>,
            )
          } else if (/^[-*•]\s+/.test(t)) {
            blocks.push(
              <div key={`ul-${segIdx}-${i}`} className="flex gap-2 pl-1">
                <span className="text-emerald-500">•</span>
                <div className="min-w-0 flex-1">{inline(t.replace(/^[-*•]\s+/, ''), `${segIdx}-${i}`)}</div>
              </div>,
            )
          } else if (/^\d+\.\s+/.test(t)) {
            const match = t.match(/^(\d+\.)\s+(.*)$/)
            blocks.push(
              <div key={`ol-${segIdx}-${i}`} className="flex gap-2 pl-1">
                <span className="font-mono text-xs text-muted-foreground">{match?.[1]}</span>
                <div className="min-w-0 flex-1">{inline(match?.[2] || t, `${segIdx}-${i}`)}</div>
              </div>,
            )
          } else {
            blocks.push(<p key={`p-${segIdx}-${i}`}>{inline(l, `${segIdx}-${i}`)}</p>)
          }
          i++
        }
        return (
          <div key={segIdx} className="space-y-1">
            {blocks}
          </div>
        )
      })}
    </div>
  )
}

interface AttachedSnapshot {
  id: string
  icon: string
  label: string
  payload: string
}

export const AgentDrawer: React.FC<AgentDrawerProps> = ({
  open,
  onOpenChange,
  context,
  onWorkspaceChanged,
  onOpenGateway,
  onStatusChange,
  onActionReady,
  origin,
}) => {
  // Smooth panel mount/shown animation
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      const raf = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setShown(true))
      })
      return () => window.cancelAnimationFrame(raf)
    }
    setShown(false)
    const tm = window.setTimeout(() => setMounted(false), 320)
    return () => window.clearTimeout(tm)
  }, [open])

  const [sessions, setSessions] = useState<AgentSession[]>(() => {
    const loaded = loadAgentSessions()
    return loaded.length ? loaded : [createEmptySession('auto', 'agent')]
  })
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const loaded = loadAgentSessions()
    return loaded[0]?.id || sessions[0]?.id || ''
  })
  const [prefs, setPrefs] = useState<AgentPreferences>(() => loadAgentPreferences())
  const [modelsCatalog, setModelsCatalog] = useState<AgentModelsCatalog | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)

  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [wide, setWide] = useState(false)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [activeStep, setActiveStep] = useState(0)
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [attachedSnapshots, setAttachedSnapshots] = useState<AttachedSnapshot[]>([])

  const abortRef = useRef<AbortController | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const doneResetRef = useRef<number>(0)
  const [recentOutcome, setRecentOutcome] = useState<'none' | 'done'>('none')

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId],
  )
  const messages = activeSession?.messages || []
  const runMode: AgentApprovalMode = activeSession?.approvalMode || 'agent'
  const customized = useMemo(
    () => JSON.stringify(prefs) !== JSON.stringify(DEFAULT_AGENT_PREFERENCES),
    [prefs],
  )

  useEffect(() => {
    saveAgentSessions(sessions)
  }, [sessions])

  useEffect(() => {
    saveAgentPreferences(prefs)
  }, [prefs])

  // Close context attachment popover on outside click
  useEffect(() => {
    if (!showContextMenu) return
    const onDown = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setShowContextMenu(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showContextMenu])

  // Refresh connected Gateway models whenever drawer opens
  useEffect(() => {
    if (!open) return
    let alive = true
    setModelsLoading(true)
    fetchAgentModels()
      .then((cat) => {
        if (alive) setModelsCatalog(cat)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setModelsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open])

  const isAtBottomRef = useRef(true)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = messagesContainerRef.current
    if (!el) return
    isAtBottomRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom < 50
    isAtBottomRef.current = atBottom
    setShowScrollBottom(!atBottom && distanceFromBottom > 90)
  }

  // Smoothly keep pinned to bottom as text deltas or tools stream in
  useEffect(() => {
    if (!open || showSettings) return
    if (!isAtBottomRef.current) return
    const el = messagesContainerRef.current
    if (!el) return
    const raf = window.requestAnimationFrame(() => {
      if (messagesContainerRef.current && isAtBottomRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
      }
    })
    return () => window.cancelAnimationFrame(raf)
  }, [open, showSettings, messages, streaming])

  // Flat model options & combos map for 7Server AgentModelPicker
  const { modelOptions, combosMap } = useMemo(() => {
    const opts: string[] = []
    const combos: Record<string, string[]> = {}
    if (modelsCatalog) {
      for (const c of modelsCatalog.combos || []) {
        opts.push(c.id)
        combos[c.label] = c.targets
      }
      for (const s of modelsCatalog.subscriptions || []) {
        for (const m of s.models || []) {
          opts.push(m.startsWith(`${s.alias}/`) ? m : `${s.alias}/${m}`)
        }
      }
      for (const a of modelsCatalog.apikeys || []) {
        for (const m of a.models || []) {
          opts.push(m.startsWith(`${a.alias}/`) ? m : `${a.alias}/${m}`)
        }
      }
    }
    return { modelOptions: opts, combosMap: combos }
  }, [modelsCatalog])

  const filteredChats = useMemo(() => {
    const q = historySearch.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.kind !== 'compact' && m.content.toLowerCase().includes(q)),
    )
  }, [sessions, historySearch])

  // Slash commands matching current input
  const matchingSlashCommands = useMemo(() => {
    const trimmed = input.trimStart()
    if (!trimmed.startsWith('/') || trimmed.includes('\n')) return []
    const firstWord = trimmed.split(/\s+/)[0].toLowerCase()
    if (trimmed.includes(' ')) return []
    return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(firstWord))
  }, [input])

  useEffect(() => {
    setSlashIndex(0)
  }, [matchingSlashCommands.length])

  const updateSession = useCallback(
    (sessionId: string, updater: (prev: AgentSession) => AgentSession) => {
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updater(s) : s)))
    },
    [],
  )

  const handleNewChat = useCallback(() => {
    if (streaming) return
    const next = createEmptySession(activeSession?.model || 'auto', activeSession?.approvalMode || 'agent')
    next.projectId = context.projectId
    next.projectName = context.projectName
    setSessions((prev) => [next, ...prev.filter((s) => s.messages.length > 0 || s.id !== next.id)])
    setActiveSessionId(next.id)
    setShowHistory(false)
    setShowSettings(false)
    setRecentOutcome('none')
  }, [streaming, activeSession?.model, activeSession?.approvalMode, context.projectId, context.projectName])

  const deleteChat = (id: string) => {
    if (streaming) return
    setSessions((prev) => {
      const rest = prev.filter((s) => s.id !== id)
      if (!rest.length) {
        const fresh = createEmptySession()
        setActiveSessionId(fresh.id)
        return [fresh]
      }
      if (id === activeSessionId) setActiveSessionId(rest[0].id)
      return rest
    })
  }

  const handleCompactChat = useCallback(() => {
    if (!activeSession || activeSession.messages.length < 4 || streaming) return
    const summaryLines = activeSession.messages
      .filter((m) => m.kind !== 'compact' && m.content.trim())
      .slice(0, -2)
      .map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content.trim().slice(0, 180)}`)
    const tail = activeSession.messages.slice(-2)
    const compactMsg: AgentMessage = {
      id: uid('cmp'),
      role: 'assistant',
      kind: 'compact',
      createdAt: Date.now(),
      content: summaryLines.join('\n') || 'Earlier context compacted.',
    }
    updateSession(activeSession.id, (s) => ({
      ...s,
      updatedAt: Date.now(),
      messages: [compactMsg, ...tail],
    }))
    toast.success('Context compacted')
  }, [activeSession, streaming, updateSession])

  const handleExportMarkdown = () => {
    if (!messages.length) return
    const md = messages
      .map((m) => `## ${m.role === 'user' ? 'User' : `Beacon AI${m.model ? ` (${m.model})` : ''}`}\n\n${m.content}`)
      .join('\n\n---\n\n')
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(activeSession?.title || 'beacon-agent').replace(/[^a-z0-9-_]+/gi, '_')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const executeAgentTurn = useCallback(
    async (params: {
      sessionId: string
      wireMessages: Array<Record<string, any>>
      assistantMsgId: string
      model: string
      approvalMode: AgentApprovalMode
      approvedCallIds?: string[]
    }) => {
      const controller = new AbortController()
      abortRef.current = controller
      setStreaming(true)
      setActiveStep(1)
      setRecentOutcome('none')
      window.clearTimeout(doneResetRef.current)

      let hadError = false
      let hitApproval = false

      const patchAssistant = (updater: (msg: AgentMessage) => AgentMessage) => {
        updateSession(params.sessionId, (s) => ({
          ...s,
          updatedAt: Date.now(),
          messages: s.messages.map((m) => (m.id === params.assistantMsgId ? updater(m) : m)),
        }))
      }

      try {
        await streamAgentChat(
          {
            messages: params.wireMessages,
            context: { ...context, preferences: prefs },
            model: params.model,
            approvalMode: params.approvalMode,
            approvedCallIds: params.approvedCallIds,
            maxSteps: prefs.maxSteps,
            signal: controller.signal,
          },
          {
            onModel: (resolvedModel) => {
              patchAssistant((m) => ({ ...m, model: resolvedModel }))
            },
            onDelta: (delta) => {
              patchAssistant((m) => ({ ...m, content: (m.content || '') + delta }))
            },
            onToolStart: (ev) => {
              setActiveStep((st) => st + 1)
              patchAssistant((m) => {
                const list = [...(m.toolExecutions || [])]
                const idx = list.findIndex((t) => t.call_id === ev.call_id)
                const item = {
                  call_id: ev.call_id,
                  name: ev.name,
                  tier: ev.tier,
                  summary: ev.summary,
                  arguments: ev.arguments,
                  status: 'running' as const,
                }
                if (idx >= 0) list[idx] = { ...list[idx], ...item }
                else list.push(item)
                return { ...m, toolExecutions: list }
              })
            },
            onToolResult: (ev) => {
              patchAssistant((m) => {
                const list = [...(m.toolExecutions || [])]
                const idx = list.findIndex((t) => t.call_id === ev.call_id)
                const nextItem = {
                  call_id: ev.call_id,
                  name: ev.name,
                  summary: ev.summary,
                  ok: ev.ok,
                  mutated: ev.mutated,
                  result: ev.result,
                  status: ev.ok ? ('done' as const) : ('error' as const),
                }
                if (idx >= 0) list[idx] = { ...list[idx], ...nextItem }
                else list.push(nextItem)
                return { ...m, toolExecutions: list }
              })
            },
            onWorkspaceChanged: () => {
              void onWorkspaceChanged()
            },
            onApprovalRequired: (ev) => {
              hitApproval = true
              patchAssistant((m) => ({
                ...m,
                rawAssistantMessage: ev.assistant_message,
                pendingApproval: { calls: ev.calls },
              }))
            },
            onError: (err) => {
              hadError = true
              patchAssistant((m) => ({ ...m, error: err }))
            },
          },
        )
        if (!hadError && !hitApproval) {
          setRecentOutcome('done')
          doneResetRef.current = window.setTimeout(() => setRecentOutcome('none'), 6000)
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          patchAssistant((m) => ({
            ...m,
            error: {
              title: 'Agent stream disconnected',
              items: [{ provider: 'client', reason: String(err?.message || err) }],
            },
          }))
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setStreaming(false)
      }
    },
    [context, prefs, updateSession, onWorkspaceChanged],
  )

  const handleSend = useCallback(
    async (overrideText?: string) => {
      const baseText = (overrideText ?? input).trim()
      if ((!baseText && attachedSnapshots.length === 0) || streaming || !activeSession) return
      if (!overrideText) setInput('')

      const snapshotBlock = attachedSnapshots.length
        ? `\n\n[Attached Live Beacon Snapshots]\n${attachedSnapshots
            .map((s) => `### ${s.label}\n${s.payload}`)
            .join('\n\n')}`
        : ''
      if (!overrideText) setAttachedSnapshots([])

      const text = `${baseText || 'Analyze the attached Beacon context.'}${snapshotBlock}`

      const userMsg: AgentMessage = {
        id: uid('msg'),
        role: 'user',
        content: text,
        createdAt: Date.now(),
      }
      const assistantMsgId = uid('msg')
      const assistantMsg: AgentMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        toolExecutions: [],
      }

      const nextMessages = [...activeSession.messages, userMsg, assistantMsg]
      const wireMessages = buildWireMessages([...activeSession.messages, userMsg])
      const isFirst = activeSession.messages.length === 0

      updateSession(activeSession.id, (s) => ({
        ...s,
        title: isFirst ? baseText.slice(0, 48) + (baseText.length > 48 ? '…' : '') : s.title,
        projectId: context.projectId,
        projectName: context.projectName,
        updatedAt: Date.now(),
        messages: nextMessages,
      }))

      await executeAgentTurn({
        sessionId: activeSession.id,
        wireMessages,
        assistantMsgId,
        model: activeSession.model,
        approvalMode: activeSession.approvalMode,
      })
    },
    [input, attachedSnapshots, streaming, activeSession, context.projectId, context.projectName, updateSession, executeAgentTurn],
  )

  const handleApprovalDecision = useCallback(
    async (msg: AgentMessage, calls: AgentPendingCall[], approve: boolean) => {
      if (streaming || !activeSession || !msg.rawAssistantMessage) return
      const idx = activeSession.messages.findIndex((m) => m.id === msg.id)
      if (idx < 0) return

      const followups = approve
        ? undefined
        : calls.map((c) => ({
            role: 'tool' as const,
            tool_call_id: c.id,
            content: JSON.stringify({ skipped: true, reason: 'User skipped this action' }),
          }))

      const updatedMsg: AgentMessage = {
        ...msg,
        pendingApproval: { calls, resolved: approve ? 'approved' : 'skipped' },
        toolFollowups: followups,
      }
      const resumeAssistantId = uid('msg')
      const resumeAssistant: AgentMessage = {
        id: resumeAssistantId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        toolExecutions: [],
      }

      const prefixMessages = activeSession.messages.slice(0, idx).concat(updatedMsg)
      const wireMessages = buildWireMessages(prefixMessages)

      updateSession(activeSession.id, (s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: [...prefixMessages, resumeAssistant],
      }))

      await executeAgentTurn({
        sessionId: activeSession.id,
        wireMessages,
        assistantMsgId: resumeAssistantId,
        model: activeSession.model,
        approvalMode: activeSession.approvalMode,
        approvedCallIds: approve ? calls.map((c) => c.id) : undefined,
      })
    },
    [streaming, activeSession, updateSession, executeAgentTurn],
  )

  const handleRetryMessage = useCallback(
    async (assistantId: string) => {
      if (streaming || !activeSession) return
      const idx = activeSession.messages.findIndex((m) => m.id === assistantId)
      if (idx <= 0) return
      const prefix = activeSession.messages.slice(0, idx)
      const wireMessages = buildWireMessages(prefix)
      const freshId = uid('msg')
      const freshMsg: AgentMessage = {
        id: freshId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        toolExecutions: [],
      }
      updateSession(activeSession.id, (s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: [...prefix, freshMsg],
      }))
      await executeAgentTurn({
        sessionId: activeSession.id,
        wireMessages,
        assistantMsgId: freshId,
        model: activeSession.model,
        approvalMode: activeSession.approvalMode,
      })
    },
    [streaming, activeSession, updateSession, executeAgentTurn],
  )

  const executeSlashItem = (item: SlashCommandItem) => {
    setInput('')
    if (item.action === 'clear') {
      handleNewChat()
      return
    }
    if (item.action === 'compact') {
      handleCompactChat()
      return
    }
    if (item.prompt) void handleSend(item.prompt)
  }

  const attachSnapshot = (kind: 'project' | 'endpoint' | 'response') => {
    setShowContextMenu(false)
    if (kind === 'project') {
      const payload = `Project: ${context.projectName || 'None'} (id=${context.projectId || 'none'})\nEnvironment: ${context.environmentName || 'Default'}\nBase URL: ${context.baseUrl || '(unset)'}\nView: ${context.view}`
      setAttachedSnapshots((prev) => [
        ...prev.filter((x) => x.id !== 'project'),
        { id: 'project', icon: '📁', label: 'Project & Env', payload },
      ])
    } else if (kind === 'endpoint' && context.selectedEndpointId) {
      const payload = `Focused Endpoint: ${context.selectedEndpointMethod || 'GET'} ${context.selectedEndpointUrl || ''} (name="${context.selectedEndpointName}", id=${context.selectedEndpointId})`
      setAttachedSnapshots((prev) => [
        ...prev.filter((x) => x.id !== 'endpoint'),
        { id: 'endpoint', icon: '🎯', label: context.selectedEndpointName || 'Endpoint', payload },
      ])
    } else if (kind === 'response' && context.lastSendResult) {
      const r = context.lastSendResult
      const payload = `Last Send Result: HTTP ${r.status_code ?? 'error'} (${r.elapsed_ms ?? 0}ms, ok=${r.ok})\nAssertions: ${r.assertions_passed ?? 0} passed, ${r.assertions_failed ?? 0} failed\nError: ${r.error || 'none'}\nBody Preview:\n${r.body_preview || '(empty)'}`
      setAttachedSnapshots((prev) => [
        ...prev.filter((x) => x.id !== 'response'),
        { id: 'response', icon: '📡', label: `HTTP ${r.status_code ?? 'ERR'}`, payload },
      ])
    }
  }

  // Sync live mascot mood & bubble actions back to App -> AgentTrigger
  const pendingMsg = useMemo(
    () => [...messages].reverse().find((m) => m.pendingApproval && !m.pendingApproval.resolved),
    [messages],
  )

  useEffect(() => {
    if (!onStatusChange) return
    const last = messages[messages.length - 1]
    const runningTool = last?.toolExecutions?.find((t) => t.status === 'running')

    let live: AgentLiveStatus = {
      state: 'idle',
      mode: runMode,
      projectName: context.projectName || undefined,
      maxSteps: prefs.maxSteps,
    }

    if (pendingMsg?.pendingApproval) {
      const calls = pendingMsg.pendingApproval.calls
      live = {
        ...live,
        state: 'approval',
        pendingCount: calls.length,
        command: calls[0]?.summary,
        isRisky: calls.some((c) => c.tier === 'heavy'),
      }
    } else if (streaming && runningTool) {
      live = {
        ...live,
        state: 'executing',
        step: activeStep,
        command: runningTool.summary || runningTool.name,
      }
    } else if (streaming) {
      live = {
        ...live,
        state: 'thinking',
        step: activeStep,
        preview: last?.content ? last.content.slice(-110) : undefined,
      }
    } else if (last?.error) {
      live = {
        ...live,
        state: 'error',
        preview: last.error.title,
      }
    } else if (recentOutcome === 'done' && last?.role === 'assistant' && last.content) {
      live = {
        ...live,
        state: 'done',
        preview: last.content.replace(/\s+/g, ' ').slice(0, 120),
      }
    }

    onStatusChange(live)
  }, [messages, pendingMsg, streaming, activeStep, recentOutcome, runMode, context.projectName, prefs.maxSteps, onStatusChange])

  useEffect(() => {
    if (!onActionReady) return
    onActionReady((action) => {
      if (action === 'stop') {
        abortRef.current?.abort()
      } else if (action === 'approve' || action === 'approveAll') {
        if (pendingMsg?.pendingApproval) {
          void handleApprovalDecision(pendingMsg, pendingMsg.pendingApproval.calls, true)
        }
      } else if (action === 'skip') {
        if (pendingMsg?.pendingApproval) {
          void handleApprovalDecision(pendingMsg, pendingMsg.pendingApproval.calls, false)
        }
      } else if (action === 'retry') {
        const last = messages[messages.length - 1]
        if (last?.role === 'assistant') void handleRetryMessage(last.id)
      } else if (action === 'dismiss') {
        setRecentOutcome('none')
      }
    })
    return () => onActionReady(null)
  }, [onActionReady, pendingMsg, messages, handleApprovalDecision, handleRetryMessage])

  const quickPrompts = useMemo(() => {
    const out: Array<{ icon: string; label: string; prompt: string }> = []
    if (context.selectedEndpointId && context.selectedEndpointName) {
      if (context.lastSendResult && (!context.lastSendResult.ok || (context.lastSendResult.status_code ?? 0) >= 400)) {
        out.push({
          icon: '🛠️',
          label: `Debug ${context.selectedEndpointMethod || ''} ${context.selectedEndpointName}`,
          prompt: `Inspect "${context.selectedEndpointName}" (${context.selectedEndpointMethod} ${context.selectedEndpointUrl || ''}), test why the last request returned ${context.lastSendResult.status_code ?? 'error'}, and fix it if needed.`,
        })
      } else {
        out.push({
          icon: '🎯',
          label: `Probe & assert ${context.selectedEndpointName}`,
          prompt: `Send a live request to "${context.selectedEndpointName}" and save its response baseline + smart assertions.`,
        })
      }
    }
    out.push(
      {
        icon: '🔍',
        label: 'Audit active project & variables',
        prompt: `Audit project "${context.projectName || 'current'}" (${context.environmentName || 'default'}): check base URL, unresolved {{variables}}, missing assertions, and recommend improvements.`,
      },
      {
        icon: '📥',
        label: 'Import cURL / create endpoints',
        prompt: 'Help me create or organize endpoints for this project cleanly with {{variables}} and assertions.',
      },
      {
        icon: '⚡',
        label: 'Safe load & rate-limit test',
        prompt: 'Verify the right target endpoint with a single probe first, then run or propose a safe rate_limit or fixed load test.',
      },
      {
        icon: '🔗',
        label: 'Wire login -> token extractor chain',
        prompt: 'Inspect auth/protected endpoints, set up extractors so tokens refresh automatically, and test the chain.',
      },
    )
    return out.slice(0, 5)
  }, [context])

  if (!mounted) return null

  const drawerNode = (
    <>
      <div
        onClick={() => onOpenChange(false)}
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 sm:hidden ${
          shown ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden
      />

      <aside
        aria-label="Beacon AI Copilot"
        className={`fixed top-0 right-0 z-50 h-full w-full ${
          wide ? 'sm:w-[min(860px,92vw)]' : 'sm:w-[490px]'
        } bg-card border-l border-border shadow-2xl flex flex-col copilot-drawer ${shown ? 'is-open' : ''}`}
      >
        {/* Header matching 7Server */}
        <div className="h-13 px-3.5 py-2.5 border-b border-border flex items-center justify-between gap-2 shrink-0 bg-background/60 backdrop-blur-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg btn-metal flex items-center justify-center shrink-0 shadow-sm">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                <span>Beacon AI</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {modelsCatalog?.has_any
                  ? activeSession?.model && activeSession.model !== 'auto'
                    ? activeSession.model
                    : `Auto (${modelsCatalog.default_model || 'Gateway ready'})`
                  : modelsLoading
                    ? 'Checking Gateway models…'
                    : 'No AI Gateway provider connected'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-0.5">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleExportMarkdown}
                title="Export chat as Markdown (.md)"
                className="h-7 w-7 text-muted-foreground"
              >
                <Download className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setWide((v) => !v)}
              title={wide ? 'Narrow drawer' : 'Widen drawer'}
              className="h-7 w-7 text-muted-foreground hidden sm:inline-flex"
            >
              {wide ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setShowSettings((v) => !v)
                setShowHistory(false)
              }}
              title="Agent Skills & Preferences"
              aria-expanded={showSettings}
              className={`relative h-7 w-7 ${showSettings ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              <Settings2 className="w-3.5 h-3.5" />
              {customized && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-500" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNewChat}
              disabled={streaming}
              title="New chat"
              className="h-7 w-7 text-muted-foreground"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setShowHistory((v) => !v)
                setShowSettings(false)
              }}
              title="Chat history"
              aria-expanded={showHistory}
              className={`h-7 w-7 ${showHistory ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              <History className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              title="Minimize to character (⌘J)"
              className="h-7 w-7 text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Active Context & Step Bar */}
        <div className="px-3.5 py-1.5 border-b border-border/60 bg-background/40 flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {context.projectName ? (
              <span className="flex items-center gap-1 truncate text-foreground font-medium">
                <FolderKanban className="w-3 h-3 text-emerald-500 shrink-0" />
                <span className="truncate">{context.projectName}</span>
                {context.environmentName ? (
                  <span className="font-mono text-[10px] text-muted-foreground">({context.environmentName})</span>
                ) : null}
              </span>
            ) : (
              <span>No project active</span>
            )}
            <span className="px-1.5 py-0.2 rounded bg-muted font-mono text-[9.5px] uppercase shrink-0">
              {context.view}
            </span>
            {context.selectedEndpointName && (
              <span className="px-1.5 py-0.2 rounded bg-muted font-mono text-[9.5px] truncate max-w-[140px]">
                {context.selectedEndpointMethod} {context.selectedEndpointName}
              </span>
            )}
          </div>
          {streaming && activeStep > 1 && (
            <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono text-[9.5px] flex items-center gap-1 shrink-0">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              Step {activeStep}/{prefs.maxSteps}
            </span>
          )}
        </div>

        {/* History Dropdown with Search */}
        {showHistory && (
          <div
            style={{ animation: 'agent-expand-in 200ms ease-out' }}
            className="max-h-80 flex flex-col border-b border-border bg-background shrink-0"
          >
            {sessions.length > 2 && (
              <div className="p-2 border-b border-border/60 flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground ml-1 shrink-0" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search conversation history…"
                  className="w-full bg-transparent text-xs text-foreground placeholder-muted-foreground outline-none"
                />
                {historySearch && (
                  <button type="button" onClick={() => setHistorySearch('')} className="text-muted-foreground">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
            <div className="overflow-y-auto divide-y divide-border/40">
              {filteredChats.length === 0 ? (
                <div className="px-4 py-3 text-[11px] text-muted-foreground">No matching chats.</div>
              ) : (
                filteredChats.map((c) => (
                  <div
                    key={c.id}
                    className={`group flex items-center gap-2 px-3.5 py-2 text-xs hover:bg-muted/50 ${
                      c.id === activeSession?.id ? 'bg-foreground/[0.06]' : ''
                    }`}
                  >
                    <button
                      onClick={() => {
                        if (streaming) return
                        setActiveSessionId(c.id)
                        setShowHistory(false)
                      }}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="truncate text-foreground font-medium">{c.title}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                        {c.projectName && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium text-[9.5px]">
                            <FolderKanban className="w-2.5 h-2.5" />
                            {c.projectName}
                          </span>
                        )}
                        <span>
                          {new Date(c.updatedAt).toLocaleTimeString()} · {c.messages.length} msgs
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={() => deleteChat(c.id)}
                      title="Delete chat"
                      className="p-1 rounded text-muted-foreground hover:text-red-500 opacity-60 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {showSettings ? (
          <AgentSettings
            value={prefs}
            projectId={context.projectId}
            projectName={context.projectName}
            onClose={() => setShowSettings(false)}
            onSave={(p) => {
              setPrefs(p)
              saveAgentPreferences(p)
              setShowSettings(false)
              toast.success('Agent preferences saved')
            }}
          />
        ) : (
          <>
            {/* Message Stream */}
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="flex-1 overflow-y-auto p-3.5 space-y-3.5 relative"
            >
              {!modelsLoading && modelsCatalog && !modelsCatalog.has_any && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                  <div className="font-semibold text-amber-500">Connect an AI Provider First</div>
                  <p className="mt-1 text-muted-foreground">
                    Connect Claude, ChatGPT Codex, Copilot, Gemini CLI, Kimi, or an API key in AI Gateway to activate
                    Beacon AI.
                  </p>
                  {onOpenGateway && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2.5 h-7 gap-1.5 text-xs"
                      onClick={() => {
                        onOpenChange(false)
                        onOpenGateway()
                      }}
                    >
                      <Zap className="h-3.5 w-3.5" /> Open AI Gateway
                    </Button>
                  )}
                </div>
              )}

              {messages.length === 0 ? (
                <div className="h-full flex flex-col justify-center items-center text-center px-3 space-y-4">
                  <div className="flex flex-col items-center">
                    <AgentCharacter
                      mood={runMode === 'full' ? 'idle' : 'hovered'}
                      mode={runMode}
                    />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-semibold text-sm text-foreground">Beacon AI Copilot</h3>
                    <p className="text-xs text-muted-foreground max-w-xs">
                      Autonomous API workbench engineer — inspect projects, probe endpoints, import cURLs, build
                      assertions, chain flows, and test rate limits.
                    </p>
                  </div>

                  <div className="w-full space-y-1.5 text-left pt-1">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Quick Actions
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">Type / for commands</span>
                    </div>
                    {quickPrompts.map((action, i) => (
                      <button
                        key={i}
                        type="button"
                        disabled={streaming}
                        onClick={() => void handleSend(action.prompt)}
                        className="w-full p-2.5 rounded-xl border border-border bg-card hover:border-emerald-500/40 hover:bg-emerald-500/[0.03] text-left text-xs transition-all duration-200 flex items-center justify-between group cursor-pointer active:scale-[0.99]"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-sm transition-transform duration-200 group-hover:scale-110">{action.icon}</span>
                          <span className="font-medium text-foreground truncate">{action.label}</span>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-emerald-500 transition-all duration-200 group-hover:translate-x-1 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg) =>
                  msg.kind === 'compact' ? (
                    <details
                      key={msg.id}
                      className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground transition-all duration-200"
                    >
                      <summary className="cursor-pointer select-none flex items-center justify-between gap-2 font-medium text-foreground list-none">
                        <span className="flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Context Compacted</span>
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">click to inspect</span>
                      </summary>
                      <pre className="mt-2 pt-2 border-t border-border/60 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted-foreground">
                        {msg.content}
                      </pre>
                    </details>
                  ) : (
                    <div
                      key={msg.id}
                      className={`copilot-msg group/msg flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="w-6 h-6 rounded-lg btn-metal flex items-center justify-center shrink-0 text-xs font-bold mt-0.5 shadow-sm">
                          <Bot className="w-3.5 h-3.5" />
                        </div>
                      )}
                      <div className={`max-w-[88%] space-y-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        {/* Tool Execution Pills */}
                        {msg.role === 'assistant' && msg.toolExecutions && msg.toolExecutions.length > 0 && (
                          <div className="space-y-1.5">
                            {msg.toolExecutions.map((tool) => {
                              const isOpen = !!expandedTools[tool.call_id]
                              return (
                                <div
                                  key={tool.call_id}
                                  className={`overflow-hidden rounded-xl border transition-all duration-200 text-[11px] ${
                                    tool.status === 'running'
                                      ? 'border-emerald-500/40 bg-emerald-500/[0.04] shadow-sm shadow-emerald-500/10'
                                      : 'border-border bg-background/70'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedTools((prev) => ({
                                        ...prev,
                                        [tool.call_id]: !prev[tool.call_id],
                                      }))
                                    }
                                    className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                                  >
                                    {tool.status === 'running' ? (
                                      <Loader2 className="w-3 h-3 shrink-0 animate-spin text-emerald-500" />
                                    ) : tool.ok ? (
                                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                    ) : (
                                      <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                                    )}
                                    <Wrench className="w-3 h-3 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                                      {tool.summary || tool.name}
                                    </span>
                                    {tool.mutated && (
                                      <Badge variant="outline" className="h-4 px-1 text-[9px] border-emerald-500/30 text-emerald-500 animate-in fade-in duration-200">
                                        saved
                                      </Badge>
                                    )}
                                    <ChevronRight
                                      className={`w-3 h-3 shrink-0 text-muted-foreground transition-transform duration-200 ${
                                        isOpen ? 'rotate-90' : 'rotate-0'
                                      }`}
                                    />
                                  </button>
                                  <div
                                    className={`grid transition-[grid-template-rows,opacity] duration-240 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                                      isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                                    }`}
                                  >
                                    <div className="overflow-hidden">
                                      <div className="space-y-1.5 border-t border-border bg-zinc-950 p-2.5 font-mono text-[10px] text-zinc-200">
                                        {tool.arguments && (
                                          <div>
                                            <div className="text-zinc-400">args ({tool.name}):</div>
                                            <pre className="max-h-32 overflow-auto">
                                              {JSON.stringify(tool.arguments, null, 2)}
                                            </pre>
                                          </div>
                                        )}
                                        {tool.result && (
                                          <div>
                                            <div className="text-zinc-400">result:</div>
                                            <pre className="max-h-44 overflow-auto">
                                              {JSON.stringify(tool.result, null, 2)}
                                            </pre>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* Message Bubble */}
                        {(msg.role === 'user' || msg.content || (!msg.error && !msg.pendingApproval && streaming && !msg.toolExecutions?.length)) && (
                          <div
                            className={`rounded-2xl px-3.5 py-2.5 transition-all duration-200 ${
                              msg.role === 'user'
                                ? 'btn-metal rounded-tr-sm shadow-sm'
                                : 'bg-muted/50 border border-border text-foreground rounded-tl-sm'
                            }`}
                          >
                            {msg.role === 'user' ? (
                              <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{msg.content}</div>
                            ) : msg.content ? (
                              <div className="relative">
                                <RichMarkdown text={msg.content} />
                                {streaming && messages[messages.length - 1]?.id === msg.id && (
                                  <span className="inline-block w-1.5 h-3.5 ml-1 bg-emerald-500 rounded-sm animate-pulse align-middle" />
                                )}
                              </div>
                            ) : (
                              <TypingDots />
                            )}
                          </div>
                        )}

                        {/* Error Card */}
                        {msg.error && <ErrorCard error={msg.error} onOpenGateway={onOpenGateway} />}

                        {/* Approval Card */}
                        {msg.pendingApproval && (
                          <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-3 text-xs space-y-2">
                            <div className="flex items-center gap-1.5 font-semibold text-amber-500">
                              {msg.pendingApproval.resolved === 'approved' ? (
                                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                              ) : (
                                <ShieldAlert className="w-4 h-4" />
                              )}
                              <span>
                                {msg.pendingApproval.resolved === 'approved'
                                  ? 'Approved & Executed'
                                  : msg.pendingApproval.resolved === 'skipped'
                                    ? 'Skipped by User'
                                    : 'Approval Required'}
                              </span>
                            </div>
                            <div className="space-y-1.5">
                              {msg.pendingApproval.calls.map((c) => (
                                <div key={c.id} className="rounded-lg border border-border/70 bg-background/80 p-2">
                                  <div className="flex items-center justify-between gap-2 font-medium">
                                    <span>{c.summary}</span>
                                    <Badge variant="outline" className="h-4 px-1 font-mono text-[9.5px] uppercase">
                                      {c.tier}
                                    </Badge>
                                  </div>
                                  <pre className="mt-1 max-h-24 overflow-auto font-mono text-[10px] text-muted-foreground">
                                    {JSON.stringify(c.arguments, null, 2)}
                                  </pre>
                                </div>
                              ))}
                            </div>
                            {!msg.pendingApproval.resolved && (
                              <div className="flex items-center justify-end gap-1.5 pt-1">
                                <button
                                  type="button"
                                  disabled={streaming}
                                  onClick={() => void handleApprovalDecision(msg, msg.pendingApproval!.calls, false)}
                                  className="px-2.5 py-1 rounded-lg text-[11px] border border-border bg-background hover:bg-muted text-foreground inline-flex items-center gap-1"
                                >
                                  <SkipForward className="w-3 h-3" /> Skip
                                </button>
                                <button
                                  type="button"
                                  disabled={streaming}
                                  onClick={() => void handleApprovalDecision(msg, msg.pendingApproval!.calls, true)}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium btn-metal inline-flex items-center gap-1"
                                >
                                  <Play className="w-3 h-3" /> Approve &amp; Run
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Assistant Message Footer: Model Badge + Copy + Regenerate */}
                        {msg.role === 'assistant' && (msg.content || msg.error) && !streaming && (
                          <div className="flex items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {msg.model && (() => {
                                const parsed = parseModelItem(msg.model, combosMap)
                                return (
                                  <span
                                    title={`Answered by ${msg.model}`}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted/70 border border-border/60 font-mono text-[9.5px] text-foreground/80 truncate max-w-[200px]"
                                  >
                                    <span className="opacity-60">{parsed.prefix}/</span>
                                    <span className="truncate">{parsed.cleanName}</span>
                                  </span>
                                )
                              })()}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity">
                              {msg.content && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(msg.content)
                                    setCopiedMsgId(msg.id)
                                    setTimeout(() => setCopiedMsgId(null), 1500)
                                  }}
                                  title="Copy reply"
                                  className="px-1.5 py-0.5 rounded hover:bg-muted hover:text-foreground flex items-center gap-1"
                                >
                                  {copiedMsgId === msg.id ? (
                                    <Check className="w-2.5 h-2.5 text-emerald-500" />
                                  ) : (
                                    <Copy className="w-2.5 h-2.5" />
                                  )}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleRetryMessage(msg.id)}
                                title="Regenerate reply"
                                className="px-1.5 py-0.5 rounded hover:bg-muted hover:text-foreground flex items-center gap-1"
                              >
                                <RotateCcw className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ),
                )
              )}
            </div>

            {/* Jump to Bottom */}
            {showScrollBottom && (
              <button
                type="button"
                onClick={() => scrollToBottom('smooth')}
                className="absolute bottom-24 right-5 z-20 px-2.5 py-1.5 rounded-full bg-card/95 border border-border shadow-xl backdrop-blur-md text-xs font-medium text-foreground hover:bg-muted flex items-center gap-1.5 transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer animate-in fade-in-0 zoom-in-95 duration-150"
                title="Scroll to bottom"
              >
                <ArrowDown className="w-3.5 h-3.5 text-emerald-500 animate-bounce" />
                <span className="text-[11px] font-mono">↓</span>
              </button>
            )}

            {/* 7Server Bottom Composer */}
            <div className="p-3 shrink-0 relative">
              {matchingSlashCommands.length > 0 && (
                <div
                  style={{ animation: 'agent-pop-in 120ms ease-out' }}
                  className="mb-2 rounded-xl border border-border bg-card shadow-xl overflow-hidden"
                >
                  <div className="px-2.5 py-1 border-b border-border bg-background/70 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1 font-medium">
                      <Command className="w-3 h-3" /> Quick Slash Commands
                    </span>
                    <span className="font-mono">↑↓ ↵</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto p-1 space-y-0.5">
                    {matchingSlashCommands.map((item, idx) => (
                      <button
                        key={item.cmd}
                        type="button"
                        onClick={() => executeSlashItem(item)}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between gap-2 text-xs transition-colors ${
                          idx === slashIndex ? 'bg-foreground/[0.08] text-foreground' : 'hover:bg-muted/50 text-foreground'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="font-mono text-[11px] font-semibold text-emerald-500">{item.cmd}</code>
                            <span className="font-medium truncate">{item.title}</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">{item.desc}</div>
                        </div>
                        <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <form
                data-picker-bounds
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleSend()
                }}
                className="rounded-2xl border border-border bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-foreground/15 transition-shadow"
              >
                {attachedSnapshots.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                    {attachedSnapshots.map((ctx) => (
                      <span
                        key={ctx.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[10.5px] text-emerald-500 font-medium"
                      >
                        <span>{ctx.icon}</span>
                        <span>{ctx.label}</span>
                        <button
                          type="button"
                          onClick={() => setAttachedSnapshots((prev) => prev.filter((x) => x.id !== ctx.id))}
                          className="ml-0.5 hover:text-foreground"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (matchingSlashCommands.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setSlashIndex((i) => (i + 1) % matchingSlashCommands.length)
                        return
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setSlashIndex((i) => (i - 1 + matchingSlashCommands.length) % matchingSlashCommands.length)
                        return
                      }
                      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                        e.preventDefault()
                        executeSlashItem(matchingSlashCommands[slashIndex] || matchingSlashCommands[0])
                        return
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void handleSend()
                    }
                  }}
                  placeholder={`Ask Beacon AI about ${context.projectName || 'your API'} (or / for commands)`}
                  className="block w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13px] text-foreground placeholder-muted-foreground outline-none max-h-40"
                />

                <div className="flex items-center gap-1 px-1.5 pb-1.5 flex-wrap">
                  <AgentModelPicker
                    value={activeSession?.model || 'auto'}
                    onChange={(nextModel) => {
                      if (!activeSession) return
                      updateSession(activeSession.id, (s) => ({ ...s, model: nextModel }))
                    }}
                    options={modelOptions}
                    combos={combosMap}
                    defaultLabel={modelsCatalog?.default_model}
                    disabled={streaming}
                    onManageProviders={
                      onOpenGateway
                        ? () => {
                            onOpenChange(false)
                            onOpenGateway()
                          }
                        : undefined
                    }
                  />

                  {messages.length >= 6 && !streaming && (
                    <button
                      type="button"
                      onClick={handleCompactChat}
                      title="Summarize older turns & tool outputs (/compact)"
                      className="h-7 px-2 rounded-lg text-[11px] flex items-center gap-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <Layers className="w-3 h-3 text-emerald-500" />
                      <span className="hidden sm:inline">Compact</span>
                    </button>
                  )}

                  {/* Context Snapshot Quick-Injector */}
                  <div ref={contextMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setShowContextMenu((v) => !v)}
                      title="Attach live Beacon context snapshot"
                      className={`h-7 px-2 rounded-lg text-[11px] flex items-center gap-1 transition-colors ${
                        attachedSnapshots.length > 0 || showContextMenu
                          ? 'text-emerald-500 bg-emerald-500/10'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      <Paperclip className="w-3 h-3" />
                      <span className="hidden sm:inline">Context</span>
                    </button>
                    {showContextMenu && (
                      <div
                        style={{ animation: 'agent-pop-in 120ms ease-out' }}
                        className="absolute bottom-full left-0 mb-2 w-52 rounded-xl border border-border bg-card shadow-2xl p-1.5 z-50"
                      >
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Attach Live Snapshot
                        </div>
                        <button
                          type="button"
                          onClick={() => attachSnapshot('project')}
                          className="w-full px-2 py-1.5 rounded-lg text-left text-xs hover:bg-muted/60 flex items-center gap-2"
                        >
                          <span>📁</span>
                          <span>Project &amp; Active Env</span>
                        </button>
                        <button
                          type="button"
                          disabled={!context.selectedEndpointId}
                          onClick={() => attachSnapshot('endpoint')}
                          className="w-full px-2 py-1.5 rounded-lg text-left text-xs hover:bg-muted/60 disabled:opacity-40 flex items-center gap-2"
                        >
                          <span>🎯</span>
                          <span className="truncate">
                            {context.selectedEndpointName || 'Focused Endpoint'}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={!context.lastSendResult}
                          onClick={() => attachSnapshot('response')}
                          className="w-full px-2 py-1.5 rounded-lg text-left text-xs hover:bg-muted/60 disabled:opacity-40 flex items-center gap-2"
                        >
                          <span>📡</span>
                          <span>Last Send Response</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <ChipSelect
                    icon={<Zap className={`w-3 h-3 ${runMode === 'full' ? 'text-amber-500' : ''}`} />}
                    label="Execution Mode"
                    value={runMode}
                    onChange={(v) => {
                      if (!activeSession) return
                      updateSession(activeSession.id, (s) => ({
                        ...s,
                        approvalMode: v as AgentApprovalMode,
                      }))
                    }}
                    options={[
                      { value: 'safe', label: 'Safe', hint: 'Confirm probes, writes & heavy' },
                      { value: 'agent', label: 'Agent', hint: 'Auto edits, confirm heavy' },
                      { value: 'full', label: 'Auto', hint: 'Autonomous overdrive' },
                    ]}
                  />

                  <div className="flex-1" />

                  {streaming ? (
                    <Button
                      type="button"
                      size="icon"
                      onClick={() => abortRef.current?.abort()}
                      title="Stop generation"
                      className="h-8 w-8 rounded-xl bg-red-600 hover:bg-red-700 text-white shrink-0"
                    >
                      <Square className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!input.trim() && attachedSnapshots.length === 0}
                      title="Send (Enter)"
                      className="h-8 w-8 rounded-xl btn-metal disabled:opacity-30 shrink-0 transition-transform active:scale-95"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </form>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1.5 pt-1.5">
                <span className="flex items-center gap-1.5 truncate">
                  {streaming && <Loader2 className="w-3 h-3 animate-spin text-foreground" />}
                  {streaming ? 'Working on your request…' : 'Enter to send · Shift+Enter newline'}
                </span>
                <kbd className="font-mono bg-muted px-1 rounded border border-border">⌘J</kbd>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  )

  return typeof document !== 'undefined' ? createPortal(drawerNode, document.body) : drawerNode
}
