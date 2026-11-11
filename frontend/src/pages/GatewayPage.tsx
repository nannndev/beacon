import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  Bot,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Terminal,
  Trash2,
  Unplug,
  X,
  Zap,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { toast } from '../components/ui/toast'
import { api, getBase } from '../lib/api'
import { SubscriptionAccounts } from '../components/SubscriptionAccounts'
import { GatewayCombos } from '../components/gateway/GatewayCombos'
import { GatewayQuickstart } from '../components/gateway/GatewayQuickstart'
import { GatewayPlayground } from '../components/gateway/GatewayPlayground'
import { GatewayUsagePanel } from '../components/gateway/GatewayUsage'
import { ProviderLogo } from '../components/gateway/ProviderLogo'
import type {
  GatewayKey,
  GatewayProvider,
  GatewaySettings,
  GatewayStats,
  GatewayUsage,
} from '../types'

interface Props {
  onBack: () => void
  /** Adds a ready-to-send gateway request to the current project, so the gateway can be tested in Beacon. */
  onCreateTestRequest: (url: string, secret: string, model: string) => Promise<void>
}

export type GatewayTab = 'providers' | 'keys' | 'quickstart' | 'playground' | 'usage'

const fmt = (n: number) => n.toLocaleString()

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success('Copied to clipboard')
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Failed to copy')
    }
  }
  return (
    <div className="flex gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px]" title={value}>
        {value}
      </code>
      <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => void copy()} aria-label="Copy">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  )
}

export function GatewayPage({ onBack, onCreateTestRequest }: Props) {
  const [tab, setTab] = useState<GatewayTab>('providers')
  const [base, setBase] = useState('')
  const [providers, setProviders] = useState<GatewayProvider[]>([])
  const [keys, setKeys] = useState<GatewayKey[]>([])
  const [combos, setCombos] = useState<Record<string, string[]>>({})
  const [modelItems, setModelItems] = useState<Array<{ id: string; owned_by: string }>>([])
  const [usage, setUsage] = useState<GatewayUsage[]>([])
  const [stats, setStats] = useState<GatewayStats | null>(null)
  const [gwSettings, setGwSettings] = useState<GatewaySettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [playgroundModel, setPlaygroundModel] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [p, k, c, m, u, s, st] = await Promise.all([
        api.gatewayProviders(),
        api.gatewayKeys(),
        api.gatewayCombos(),
        api.gatewayModels(),
        api.gatewayUsage(100),
        api.gatewayStats(),
        api.gatewaySettings().catch(() => null),
      ])
      setProviders(p.providers)
      setKeys(k.keys)
      setCombos(c.combos)
      setModelItems(m.models)
      setUsage(u.usage)
      setStats(s)
      if (st?.settings) setGwSettings(st.settings)
    } catch (e: any) {
      toast.error(e?.message || 'Could not load the AI gateway')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    getBase().then((b) => setBase(b || `${window.location.protocol}//${window.location.host}`))
  }, [refresh])

  const models = useMemo(() => modelItems.map((x) => x.id), [modelItems])
  const openaiBase = `${base}/gateway/v1`
  const anthropicBase = `${base}/gateway`
  const healthUrl = `${base}/gateway/health`
  const sampleModel = models[0] || 'oa/gpt-4o'

  const connectedProvidersCount = stats?.connected_providers ?? providers.filter((p) => p.connected).length
  const activeKeysCount = stats?.active_keys ?? keys.filter((k) => k.enabled).length
  const totalTokens = (stats?.input_tokens || 0) + (stats?.output_tokens || 0)
  const routingStrategy = gwSettings?.routing_strategy || 'ordered'

  const handleRoutingChange = async (strategy: 'ordered' | 'round_robin') => {
    try {
      const res = await api.gatewayUpdateSettings({ routing_strategy: strategy })
      setGwSettings(res.settings)
      toast.success(`Routing set to ${strategy === 'round_robin' ? 'Round-Robin' : 'Ordered'}`)
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update routing strategy')
    }
  }

  const openPlaygroundWithModel = (modelId: string) => {
    setPlaygroundModel(modelId)
    setTab('playground')
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-foreground">
      {/* Persistent Header */}
      <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onBack} className="history-action shrink-0">
              <ArrowLeft className="h-3.5 w-3.5" /> Workspace
            </button>
            <div className="h-6 border-l border-border shrink-0" />
            <div className="w-8 h-8 rounded-lg btn-metal flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm font-bold">AI Gateway</h1>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                    connectedProvidersCount > 0
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      connectedProvidersCount > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                    }`}
                  />
                  {connectedProvidersCount > 0 ? `${connectedProvidersCount} active` : 'No providers'}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">
                Unified OpenAI- & Anthropic-compatible proxy with OAuth subscriptions & automatic failover
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 ml-auto">
            {stats && (
              <div className="hidden md:flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
                <div>
                  <div className="text-[9.5px] uppercase font-semibold text-muted-foreground">Providers</div>
                  <div className="font-mono font-bold text-emerald-500">{fmt(connectedProvidersCount)}</div>
                </div>
                <div className="h-5 w-px bg-border" />
                <div>
                  <div className="text-[9.5px] uppercase font-semibold text-muted-foreground">Keys</div>
                  <div className="font-mono font-bold">{fmt(activeKeysCount)}</div>
                </div>
                <div className="h-5 w-px bg-border" />
                <div>
                  <div className="text-[9.5px] uppercase font-semibold text-muted-foreground">Tokens</div>
                  <div className="font-mono font-bold">{fmt(totalTokens)}</div>
                </div>
              </div>
            )}
            <button onClick={() => void refresh()} className="history-action shrink-0">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-4 overflow-x-auto no-scrollbar">
          {(
            [
              { id: 'providers', label: 'Providers & Combos', icon: Plug, badge: connectedProvidersCount || undefined },
              { id: 'keys', label: 'Virtual Keys', icon: KeyRound, badge: keys.length || undefined },
              { id: 'quickstart', label: 'Quickstart', icon: Terminal },
              { id: 'playground', label: 'Playground', icon: Play },
              { id: 'usage', label: 'Usage & Logs', icon: Activity, badge: stats?.requests || undefined },
            ] as const
          ).map((item) => {
            const Icon = item.icon
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'border-cyan-500 text-foreground font-semibold'
                    : 'border-transparent text-muted-foreground hover:text-foreground font-medium'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${active ? 'text-cyan-500' : ''}`} />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className={`rounded-full px-1.5 py-px font-mono text-[10px] ${
                      item.id === 'providers'
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {fmt(item.badge)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </header>

      {/* Tab Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-6 space-y-5">
          {tab === 'providers' && (
            <>
              {/* Routing Callout Bar */}
              <div className="rounded-xl border border-border bg-card/70 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-500 flex items-center justify-center shrink-0">
                    <Zap className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">Connect OAuth subscriptions or API-key providers</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      Multi-account & multi-key requests automatically rotate and fall back on 429 rate limits.
                    </div>
                  </div>
                </div>
                <div
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-background p-0.5 text-[11px] shrink-0"
                  title="Multi-account rotation strategy"
                >
                  <Shuffle className="w-3 h-3 ml-1.5 text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => void handleRoutingChange('ordered')}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      routingStrategy === 'ordered'
                        ? 'btn-metal font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Ordered
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRoutingChange('round_robin')}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      routingStrategy === 'round_robin'
                        ? 'btn-metal font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Round-Robin
                  </button>
                </div>
              </div>

              <SubscriptionAccounts onChanged={refresh} />

              <GatewayCombos
                combos={combos}
                models={models}
                onChanged={(next) => {
                  setCombos(next)
                  void refresh()
                }}
                onTestInPlayground={openPlaygroundWithModel}
              />

              <ProvidersSection
                providers={providers}
                onChanged={refresh}
                onTryModel={openPlaygroundWithModel}
              />
            </>
          )}

          {tab === 'keys' && (
            <KeysSection
              keys={keys}
              providers={providers}
              newSecret={newSecret}
              onSecret={setNewSecret}
              onChanged={refresh}
              onCreateTestRequest={async (secret) => {
                const live = (await api.gatewayModels()).models
                  .map((x) => x.id)
                  .filter((m) => !m.startsWith('auto/'))
                if (!live.length) {
                  toast.error('Connect a provider first')
                  return
                }
                await onCreateTestRequest(`${openaiBase}/chat/completions`, secret, live[0])
              }}
              sampleCurl={(secret) =>
                `curl ${openaiBase}/chat/completions \\\n  -H "Authorization: Bearer ${secret}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${sampleModel}","messages":[{"role":"user","content":"hi"}]}'`
              }
            />
          )}

          {tab === 'quickstart' && (
            <GatewayQuickstart
              openaiBase={openaiBase}
              anthropicBase={anthropicBase}
              healthUrl={healthUrl}
              models={modelItems}
              sampleSecret={newSecret}
              onTryModel={openPlaygroundWithModel}
              onCreateTestRequest={async (chosenModel) => {
                if (!newSecret) {
                  toast.info('Create or copy a Virtual Key in the Virtual Keys tab first')
                  setTab('keys')
                  return
                }
                await onCreateTestRequest(`${openaiBase}/chat/completions`, newSecret, chosenModel)
              }}
            />
          )}

          {tab === 'playground' && (
            <GatewayPlayground
              models={models}
              combos={combos}
              initialModel={playgroundModel}
              onManageProviders={() => setTab('providers')}
              onCompleted={() => void refresh()}
            />
          )}

          {tab === 'usage' && <GatewayUsagePanel usage={usage} stats={stats} onChanged={refresh} />}
        </div>
      </div>
    </div>
  )
}

function providerCatalog(p: GatewayProvider): string[] {
  const live = p.models || []
  const seed = p.seed_models || []
  if ((p.id === 'ollama' || p.id === 'custom') && live.length > 0) {
    return Array.from(new Set(live))
  }
  return Array.from(new Set([...live, ...seed]))
}

function ProvidersSection({
  providers,
  onChanged,
  onTryModel,
}: {
  providers: GatewayProvider[]
  onChanged: () => void
  onTryModel: (modelId: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'connected'>('all')
  const [catalogProvider, setCatalogProvider] = useState<GatewayProvider | null>(null)
  const [catalogFilter, setCatalogFilter] = useState('')
  const [copiedModel, setCopiedModel] = useState<string | null>(null)

  const open = (p: GatewayProvider) => {
    setEditing(p.id)
    setApiKey('')
    setBaseUrl(p.base_url || '')
  }

  const copyModelId = async (fullModel: string) => {
    try {
      await navigator.clipboard.writeText(fullModel)
      setCopiedModel(fullModel)
      toast.success(`Copied ${fullModel}`)
      window.setTimeout(() => setCopiedModel((prev) => (prev === fullModel ? null : prev)), 1400)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const connect = async (p: GatewayProvider) => {
    setBusy(true)
    try {
      await api.gatewayConnect(p.id, apiKey.trim(), baseUrl.trim())
      toast.success(`${p.name} connected`)
      setEditing(null)
      onChanged()
    } catch (e: any) {
      toast.error(e?.message || 'Verification failed')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (p: GatewayProvider) => {
    try {
      await api.gatewayDisconnect(p.id)
      toast.success(`${p.name} disconnected`)
      onChanged()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to disconnect')
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return providers.filter((p) => {
      if (filter === 'connected' && !p.connected) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.alias.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        providerCatalog(p).some((m) => m.toLowerCase().includes(q))
      )
    })
  }, [providers, search, filter])

  const modalModels = useMemo(() => {
    if (!catalogProvider) return []
    const q = catalogFilter.trim().toLowerCase()
    return providerCatalog(catalogProvider).filter((m) => !q || m.toLowerCase().includes(q))
  }, [catalogProvider, catalogFilter])

  const modalLiveSet = useMemo(() => new Set(catalogProvider?.models || []), [catalogProvider])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">API-Key Providers ({providers.filter((p) => p.connected).length} / {providers.length})</div>
          <p className="text-[11px] text-muted-foreground">
            Verify upstream API keys and route with <code className="rounded bg-muted px-1 font-mono">&lt;alias&gt;/&lt;model&gt;</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-44 sm:w-56">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter providers or models…"
              className="h-8 pl-8 text-xs"
              data-no-token-complete
            />
          </div>
          <div className="inline-flex rounded-lg border border-border bg-background p-0.5 text-[11px]">
            {(
              [
                ['all', 'All'],
                ['connected', 'Connected'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`px-2 py-0.5 rounded-md cursor-pointer ${
                  filter === id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => {
          const catalog = providerCatalog(p)
          const preview = catalog.slice(0, 2)
          const remaining = catalog.length - preview.length
          return (
            <Card key={p.id} className="flex flex-col justify-between gap-2.5 p-3.5 bg-card/60 backdrop-blur-sm hover:border-cyan-500/30 transition-colors">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <ProviderLogo provider={p.id} size="sm" badge />
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-sm font-semibold truncate">{p.name}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] shrink-0">{p.alias}/</code>
                  </div>
                  {p.connected && (
                    <span
                      className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${
                        p.cooling
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {p.cooling ? 'Cooling down' : 'Connected'}
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-muted-foreground flex items-center justify-between gap-2">
                  {p.connected ? (
                    <span className="truncate">
                      {p.api_key ? <span className="font-mono">{p.api_key}</span> : 'Local/No key'} · {catalog.length} models
                      {p.latency_ms != null && ` · ${p.latency_ms} ms`}
                    </span>
                  ) : (
                    <span className="truncate font-mono text-[10px] opacity-80">
                      {p.default_base_url || 'Custom base URL (/v1)'}
                    </span>
                  )}
                </div>

                {catalog.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {preview.map((m) => {
                      const full = m.startsWith(`${p.alias}/`) ? m : `${p.alias}/${m}`
                      return (
                        <button
                          key={full}
                          type="button"
                          onClick={() => (p.connected ? onTryModel(full) : void copyModelId(full))}
                          className="max-w-[165px] truncate rounded border border-border/80 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:border-cyan-500 transition-colors cursor-pointer"
                          title={p.connected ? `Test ${full} in Playground` : `Copy ${full}`}
                        >
                          {full}
                        </button>
                      )
                    })}
                    {remaining > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setCatalogProvider(p)
                          setCatalogFilter('')
                        }}
                        className="rounded border border-dashed border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-cyan-500 hover:text-foreground transition-colors cursor-pointer"
                        title={`View all ${catalog.length} models for ${p.name}`}
                      >
                        +{remaining}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {editing === p.id ? (
                <div className="space-y-2">
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    data-no-token-complete
                    placeholder={p.connected ? 'Leave empty to keep saved key' : p.needs_key ? 'API key' : 'API key (optional)'}
                    className="h-8 font-mono text-xs"
                    aria-label={`${p.name} API key`}
                  />
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    data-no-token-complete
                    placeholder={p.default_base_url || 'https://your-host/v1'}
                    className="h-8 font-mono text-xs"
                    aria-label={`${p.name} base URL`}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" className="h-8" disabled={busy} onClick={() => void connect(p)}>
                      {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Verify & save
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                  <Button size="sm" variant="outline" className="h-8" onClick={() => open(p)}>
                    {p.connected ? 'Edit' : 'Connect'}
                  </Button>
                  {p.connected && catalog[0] && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1 text-xs"
                      onClick={() =>
                        onTryModel(
                          catalog[0].startsWith(`${p.alias}/`) ? catalog[0] : `${p.alias}/${catalog[0]}`,
                        )
                      }
                    >
                      <Play className="h-3 w-3" /> Test
                    </Button>
                  )}
                  {p.connected && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-8 gap-1.5 text-red-500"
                      onClick={() => void disconnect(p)}
                    >
                      <Unplug className="h-3.5 w-3.5" /> Disconnect
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {catalogProvider && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
          onClick={() => setCatalogProvider(null)}
        >
          <Card
            role="dialog"
            aria-modal="true"
            aria-label={`${catalogProvider.name} Models`}
            className="w-full max-w-lg border-border bg-card shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold truncate">{catalogProvider.name} Models</h3>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                    {catalogProvider.alias}/
                  </code>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {modalModels.length}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {catalogProvider.connected
                    ? 'Click Test to launch in Playground, or Copy to use in API requests.'
                    : 'Default catalog preview. Connect this provider to enable live routing.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCatalogProvider(null)}
                aria-label="Close models dialog"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
                <Input
                  value={catalogFilter}
                  onChange={(e) => setCatalogFilter(e.target.value)}
                  placeholder={`Filter ${catalogProvider.name} models…`}
                  className="h-8 pl-8 text-xs"
                  data-no-token-complete
                  autoFocus
                />
              </div>
              <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
                {modalModels.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">No matching models.</p>
                ) : (
                  modalModels.map((m) => {
                    const full = m.startsWith(`${catalogProvider.alias}/`) ? m : `${catalogProvider.alias}/${m}`
                    const isLive = modalLiveSet.has(m)
                    return (
                      <div
                        key={full}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 hover:bg-muted/60"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <code className="truncate font-mono text-xs text-foreground">{full}</code>
                          {catalogProvider.connected && isLive && (
                            <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[9px] font-medium text-emerald-500 shrink-0">
                              live
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {catalogProvider.connected && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[11px] gap-1"
                              onClick={() => {
                                setCatalogProvider(null)
                                onTryModel(full)
                              }}
                            >
                              <Play className="h-2.5 w-2.5" /> Test
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => void copyModelId(full)}
                          >
                            {copiedModel === full ? 'Copied' : 'Copy'}
                          </Button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function KeysSection({
  keys,
  providers,
  newSecret,
  onSecret,
  onChanged,
  onCreateTestRequest,
  sampleCurl,
}: {
  keys: GatewayKey[]
  providers: GatewayProvider[]
  newSecret: string | null
  onSecret: (secret: string | null) => void
  onChanged: () => void
  onCreateTestRequest: (secret: string) => Promise<void>
  sampleCurl: (secret: string) => string
}) {
  const [name, setName] = useState('')
  const [rateLimit, setRateLimit] = useState('')
  const [allowedProviders, setAllowedProviders] = useState<string[]>([])
  const [showPolicies, setShowPolicies] = useState(false)

  const toggleAllowedProvider = (pid: string) => {
    setAllowedProviders((prev) => (prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]))
  }

  const create = async () => {
    if (!name.trim()) return
    const parsedLimit = rateLimit.trim() ? Number.parseInt(rateLimit.trim(), 10) : null
    if (parsedLimit !== null && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
      toast.error('Rate limit must be a positive integer')
      return
    }
    try {
      const { key } = await api.gatewayCreateKey(name.trim(), {
        allowed_providers: allowedProviders.length > 0 ? allowedProviders : undefined,
        rate_limit_per_min: parsedLimit,
      })
      onSecret(key.key)
      setName('')
      setRateLimit('')
      setAllowedProviders([])
      setShowPolicies(false)
      toast.success(`Virtual key "${key.name}" created`)
      onChanged()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create key')
    }
  }

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      onChanged()
    } catch (e: any) {
      toast.error(e?.message || 'Action failed')
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Create Virtual Key</div>
            <p className="text-[11px] text-muted-foreground">
              Issue per-tool API keys with optional rate limits and provider scoping. Management routes stay disabled for virtual keys.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            onClick={() => setShowPolicies((v) => !v)}
          >
            {showPolicies ? 'Hide policies' : 'Add policies'}
          </Button>
        </div>

        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
            }}
            placeholder="Key name, e.g. Claude Code or Local Script"
            className="h-8 text-xs"
            aria-label="New key name"
            data-no-token-complete
          />
          <Button size="sm" className="h-8 shrink-0 gap-1.5" onClick={() => void create()} disabled={!name.trim()}>
            <Plus className="h-3.5 w-3.5" /> Create key
          </Button>
        </div>

        {showPolicies && (
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5 text-xs">
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <div>
                <label className="text-[10.5px] font-medium text-muted-foreground block mb-1">
                  Rate limit (requests / min)
                </label>
                <Input
                  type="number"
                  min={1}
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value)}
                  placeholder="Unlimited"
                  className="h-8 font-mono text-xs"
                  data-no-token-complete
                />
              </div>
              <div>
                <label className="text-[10.5px] font-medium text-muted-foreground block mb-1">
                  Allowed API-key providers (leave unchecked for all)
                </label>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {providers.map((p) => {
                    const selected = allowedProviders.includes(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleAllowedProvider(p.id)}
                        className={`rounded-md border px-2 py-0.5 text-[10.5px] font-mono transition-colors cursor-pointer ${
                          selected
                            ? 'border-cyan-500 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 font-semibold'
                            : 'border-border bg-card text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {p.alias} ({p.name})
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {newSecret && (
          <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              Copy this key now. It will not be shown again.
            </div>
            <CopyField value={newSecret} />
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[10px]">
              {sampleCurl(newSecret)}
            </pre>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void onCreateTestRequest(newSecret)}>
                <Zap className="h-3.5 w-3.5" /> Add a test request to this project
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => onSecret(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-2">
        <div className="text-sm font-semibold">Issued Keys ({keys.length})</div>
        {keys.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No keys yet. Create one above for Claude Code, Codex, Cursor, or external scripts.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {keys.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-3 py-2.5 text-xs">
                <KeyRound className={`h-3.5 w-3.5 shrink-0 ${k.enabled ? 'text-cyan-500' : 'text-muted-foreground'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{k.name}</span>
                    <code className="font-mono text-[10px] text-muted-foreground">{k.key_prefix}</code>
                    {!k.enabled && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Disabled</span>
                    )}
                    {k.rate_limit_per_min && (
                      <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {k.rate_limit_per_min}/min
                      </span>
                    )}
                    {k.allowed_providers && k.allowed_providers.length > 0 && (
                      <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {k.allowed_providers.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {fmt(k.total_requests)} req · {fmt(k.total_input_tokens + k.total_output_tokens)} tokens
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => void act(() => api.gatewayToggleKey(k.id))}
                >
                  {k.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-red-500"
                  aria-label={`Delete ${k.name}`}
                  onClick={() => void act(() => api.gatewayDeleteKey(k.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
