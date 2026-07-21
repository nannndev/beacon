import { useEffect, useState } from 'react'
import { ArrowLeft, Plug, RefreshCw, Copy, Check, Search, Sparkles } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card } from '../components/ui/card'
import { toast } from '../components/ui/toast'
import { isDesktop } from '../lib/platform'
import {
  getMcpStatus, getMcpServerPath, getMcpSkillPath,
  registerClaudeDesktop, unregisterClaudeDesktop,
  registerClaudeCode, unregisterClaudeCode,
  MANUAL_MCP_CLIENTS, mcpConfigSnippet,
  type McpStatus, type ClientState,
} from '../lib/mcp'
import { MCP_TOOL_GROUPS, MCP_TOOL_COUNT } from '../lib/mcpTools'

interface Props {
  onBack: () => void
}

const STATE_LABEL: Record<ClientState, string> = {
  registered: 'Registered',
  not_registered: 'Not registered',
  config_not_found: 'Config not found',
  cli_missing: 'CLI not installed',
}

export function McpPage({ onBack }: Props) {
  const desktop = isDesktop()
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [binaryPath, setBinaryPath] = useState('')
  const [skillPath, setSkillPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  async function refresh() {
    if (!desktop) return
    setError(null)
    setLoading(true)
    try {
      const [s, p, sk] = await Promise.all([getMcpStatus(), getMcpServerPath(), getMcpSkillPath()])
      setStatus(s)
      setBinaryPath(p)
      setSkillPath(sk)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const q = query.trim().toLowerCase()
  const filteredGroups = MCP_TOOL_GROUPS
    .map((g) => ({ ...g, tools: g.tools.filter((t) => !q || t.name.includes(q) || t.desc.toLowerCase().includes(q)) }))
    .filter((g) => g.tools.length > 0)

  return (
    <div className="flex h-full min-h-0 flex-col text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="history-action"><ArrowLeft className="h-3.5 w-3.5" /> Workspace</button>
          <div className="h-6 border-l border-border" />
          <Plug className="h-5 w-5 text-cyan-500" />
          <div>
            <h1 className="text-sm font-bold">MCP Server</h1>
            <p className="text-[10px] text-muted-foreground">Connect any AI agent to this workspace</p>
          </div>
        </div>
        {desktop && (
          <button onClick={refresh} className="history-action"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 p-6">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-xs text-red-500">{error}</div>
          )}

          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            The Beacon MCP server is a standard <span className="font-medium text-foreground">stdio</span> server — it works with
            {' '}<span className="font-medium text-foreground">any</span> MCP client. One-click connect for Claude, or drop the
            config into any other client below. Your agent then drives Beacon with the {MCP_TOOL_COUNT} tools further down.
          </p>

          {!desktop && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              One-click registration and the server path are available in the <span className="font-medium text-foreground">Beacon desktop app</span>.
              You can still browse the agent capabilities below.
            </div>
          )}

          {/* Connect + one-click */}
          {desktop && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="space-y-3 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  Server binary
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">stdio</span>
                  <Badge variant="outline" className="ml-auto text-[10px]">Universal</Badge>
                </div>
                <CopyField value={binaryPath} placeholder="Resolving…" />
                <p className="text-[11px] text-muted-foreground">This one path works with every MCP client.</p>
                <div className="pt-1 text-xs font-medium">Agent skill (Claude Code)</div>
                <CopyField value={skillPath} placeholder="Resolving…" />
                <p className="text-[11px] text-muted-foreground">Copy to <code className="rounded bg-muted px-1">~/.claude/skills/beacon/SKILL.md</code>.</p>
              </Card>

              <Card className="space-y-2.5 p-4">
                <div className="text-sm font-semibold">One-click for Claude</div>
                <ClientRow name="Claude Desktop" state={status?.claude_desktop} busy={busy || loading} loading={loading}
                  onRegister={() => act(registerClaudeDesktop)} onUnregister={() => act(unregisterClaudeDesktop)} />
                <ClientRow name="Claude Code" state={status?.claude_code} busy={busy || loading} loading={loading}
                  onRegister={() => act(registerClaudeCode)} onUnregister={() => act(unregisterClaudeCode)} />
              </Card>
            </div>
          )}

          {/* Per-client manual config */}
          <div>
            <div className="mb-2 text-sm font-semibold">Manual setup</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MANUAL_MCP_CLIENTS.map((c) => (
                <ClientConfigCard key={c.name} name={c.name} configPath={c.configPath} snippet={mcpConfigSnippet(binaryPath, c.rootKey)} />
              ))}
            </div>
          </div>

          {/* Capabilities */}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-500" />
              <span className="text-sm font-semibold">What your agent can do</span>
              <Badge variant="secondary" className="text-[10px]">{MCP_TOOL_COUNT} tools</Badge>
              <div className="relative ml-auto">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter tools…"
                  className="h-8 w-48 rounded-lg border border-border bg-background pl-8 pr-2 text-xs outline-none focus:border-cyan-500/50"
                />
              </div>
            </div>
            <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
              {filteredGroups.map((g) => (
                <div key={g.label}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>
                  <div className="space-y-1.5">
                    {g.tools.map((t) => {
                      const Icon = t.icon
                      return (
                        <div key={t.name} className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-card/50 p-2.5">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500/80" />
                          <div className="min-w-0">
                            <code className="text-xs font-semibold">{t.name}</code>
                            <p className="text-[11px] leading-snug text-muted-foreground">{t.desc}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {filteredGroups.length === 0 && (
                <p className="text-xs text-muted-foreground">No tools match “{query}”.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = async (text: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Failed to copy')
    }
  }
  return { copied, copy }
}

function CopyField({ value, placeholder }: { value: string; placeholder: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className="flex gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px]">{value || placeholder}</code>
      <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => copy(value)} disabled={!value}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  )
}

function ClientConfigCard({ name, configPath, snippet }: { name: string; configPath: string; snippet: string }) {
  const { copied, copy } = useCopy()
  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{name}</span>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[11px]" onClick={() => copy(snippet)}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy
        </Button>
      </div>
      <code className="truncate rounded bg-muted/60 px-2 py-1 font-mono text-[10px] text-muted-foreground" title={configPath}>{configPath}</code>
      <pre className="overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[10px] leading-relaxed">{snippet}</pre>
    </Card>
  )
}

function ClientRow({
  name, state, busy, loading, onRegister, onUnregister,
}: {
  name: string
  state?: ClientState
  busy: boolean
  loading?: boolean
  onRegister: () => void
  onUnregister: () => void
}) {
  const registered = state === 'registered'
  const disabled = busy || (name !== 'Claude Code' && state === 'cli_missing')
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{name}</span>
        <Badge variant={registered ? 'default' : 'secondary'} className={registered ? 'border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : ''}>
          {loading ? 'Checking…' : state ? STATE_LABEL[state] : '…'}
        </Badge>
      </div>
      <Button size="sm" variant={registered ? 'outline' : 'default'} disabled={disabled} onClick={registered ? onUnregister : onRegister}>
        {registered ? 'Unregister' : 'Register'}
      </Button>
    </div>
  )
}
