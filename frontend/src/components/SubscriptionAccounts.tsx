import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { toast } from './ui/toast'
import { api } from '../lib/api'
import type {
  OAuthAccount,
  OAuthAccountUsage,
  OAuthAccountsState,
  OAuthLoginStart,
  OAuthProviderId,
  OAuthProviderMeta,
} from '../types'

interface Props {
  onChanged?: () => void | Promise<void>
}

interface PendingFlow {
  provider: OAuthProviderId
  providerName: string
  start: OAuthLoginStart
  reloginAccountId?: string
  previousIds: string[]
  previousRefreshed: Record<string, number | null>
}

function fmtNum(n?: number) {
  return (n ?? 0).toLocaleString()
}

function formatReset(resetsAt: string | null): string {
  if (!resetsAt) return ''
  const ts = Date.parse(resetsAt)
  if (!Number.isFinite(ts)) return resetsAt
  const diffMin = Math.round((ts - Date.now()) / 60_000)
  if (diffMin <= 0) return 'soon'
  if (diffMin < 60) return `in ${diffMin}m`
  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  if (h < 24) return m ? `in ${h}h ${m}m` : `in ${h}h`
  const d = Math.floor(h / 24)
  return `in ${d}d ${h % 24}h`
}

function barColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-emerald-500'
}

export function SubscriptionAccounts({ onChanged }: Props) {
  const [state, setState] = useState<OAuthAccountsState | null>(null)
  const [usageMap, setUsageMap] = useState<Record<string, OAuthAccountUsage>>({})
  const [summaryMap, setSummaryMap] = useState<Record<string, any>>({})
  const [syncingUsage, setSyncingUsage] = useState(false)
  const [detailed, setDetailed] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingFlow | null>(null)
  const [pastedCallback, setPastedCallback] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedOAuth, setExpandedOAuth] = useState<Record<string, boolean>>({})

  // Gemini OAuth client credentials drawer
  const [showGeminiConfig, setShowGeminiConfig] = useState(false)
  const [geminiClientId, setGeminiClientId] = useState('')
  const [geminiClientSecret, setGeminiClientSecret] = useState('')
  const [savingGemini, setSavingGemini] = useState(false)

  const pollTimerRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(key)
      toast.success(`Copied ${text}`)
      window.setTimeout(() => setCopiedId((prev) => (prev === key ? null : prev)), 1500)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const loadAccounts = useCallback(async () => {
    try {
      const next = await api.gatewayAccounts()
      setState(next)
      if (next?.settings?.gemini_oauth_client_id && !geminiClientId) {
        setGeminiClientId(next.settings.gemini_oauth_client_id)
      }
      return next
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load subscription accounts')
      return null
    }
  }, [geminiClientId])

  const syncUsage = useCallback(async (fresh = false) => {
    setSyncingUsage(true)
    try {
      const res = await api.gatewayAccountUsage(fresh)
      const map: Record<string, OAuthAccountUsage> = {}
      for (const item of res.usage) {
        map[item.account_id] = item
      }
      setUsageMap(map)
      setSummaryMap(res.summary || {})
    } catch (e: any) {
      toast.error(e?.message || 'Failed to sync subscription quota')
    } finally {
      setSyncingUsage(false)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const loaded = await loadAccounts()
      if (loaded && loaded.accounts.length > 0) {
        void syncUsage(false)
      }
    })()
    return () => stopPolling()
  }, [loadAccounts, syncUsage, stopPolling])

  // Device-code & redirect auto-callback polling
  useEffect(() => {
    stopPolling()
    if (!pending) return

    if (pending.start.kind === 'device') {
      const ms = Math.max(2000, (pending.start.interval || 5) * 1000)
      pollTimerRef.current = window.setInterval(async () => {
        try {
          const out = await api.gatewayAccountPoll(pending.provider, {
            session_id: pending.start.session_id,
            account_id: pending.reloginAccountId,
          })
          if (out.status === 'done') {
            stopPolling()
            setPending(null)
            setState({
              accounts: out.accounts,
              models: out.models,
              aliases: out.aliases,
              providers: out.providers,
              settings: out.settings,
            })
            toast.success(`${pending.providerName} connected`)
            void syncUsage(true)
            await onChanged?.()
          }
        } catch (e: any) {
          stopPolling()
          toast.error(e?.message || `${pending.providerName} login failed`)
          setPending(null)
        }
      }, ms)
    } else if (pending.start.auto_callback) {
      pollTimerRef.current = window.setInterval(async () => {
        try {
          const next = await api.gatewayAccounts()
          const prevSet = new Set(pending.previousIds)
          const sameProv = next.accounts.filter((a) => a.provider === pending.provider)
          const added = sameProv.find((a) => !prevSet.has(a.id))
          const refreshed =
            pending.reloginAccountId &&
            sameProv.find(
              (a) =>
                a.id === pending.reloginAccountId &&
                a.refreshed_at !== pending.previousRefreshed[a.id],
            )
          if (added || refreshed) {
            stopPolling()
            setPending(null)
            setPastedCallback('')
            setState(next)
            toast.success(`${pending.providerName} connected automatically`)
            void syncUsage(true)
            await onChanged?.()
          }
        } catch {
          // ignore transient poll errors
        }
      }, 2000)
    }

    return () => stopPolling()
  }, [pending, stopPolling, syncUsage, onChanged])

  const beginLogin = async (meta: OAuthProviderMeta, reloginAccountId?: string) => {
    if (meta.id === 'gemini-cli' && !state?.settings.gemini_oauth_configured) {
      setShowGeminiConfig(true)
      toast.error('Configure Gemini OAuth Client ID & Secret first')
      return
    }
    setBusyKey(`start:${meta.id}:${reloginAccountId || 'new'}`)
    try {
      const start = await api.gatewayAccountStart(meta.id, {
        account_id: reloginAccountId,
      })
      const existing = (state?.accounts || []).filter((a) => a.provider === meta.id)
      const previousRefreshed: Record<string, number | null> = {}
      for (const a of existing) previousRefreshed[a.id] = a.refreshed_at
      setPastedCallback('')
      setPending({
        provider: meta.id,
        providerName: meta.name,
        start,
        reloginAccountId,
        previousIds: existing.map((a) => a.id),
        previousRefreshed,
      })
      if (start.kind === 'redirect' && start.auth_url) {
        window.open(start.auth_url, '_blank', 'noopener,noreferrer')
      }
    } catch (e: any) {
      toast.error(e?.message || `Could not start ${meta.name} login`)
      if (meta.id === 'gemini-cli') setShowGeminiConfig(true)
    } finally {
      setBusyKey(null)
    }
  }

  const completeRedirect = async () => {
    if (!pending || !pastedCallback.trim()) return
    setBusyKey('complete')
    try {
      const res = await api.gatewayAccountComplete(pending.provider, {
        session_id: pending.start.session_id,
        callback: pastedCallback.trim(),
        account_id: pending.reloginAccountId,
      })
      stopPolling()
      setPending(null)
      setPastedCallback('')
      setState({
        accounts: res.accounts,
        models: res.models,
        aliases: res.aliases,
        providers: res.providers,
        settings: res.settings,
      })
      toast.success(`${pending.providerName} connected`)
      void syncUsage(true)
      await onChanged?.()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to complete login')
    } finally {
      setBusyKey(null)
    }
  }

  const testAccount = async (acct: OAuthAccount, metaName: string) => {
    setBusyKey(`test:${acct.id}`)
    try {
      const res = await api.gatewayAccountTest(acct.provider, acct.id)
      if (res.valid) {
        toast.success(`${metaName} (${acct.email || acct.id}) valid${res.latency_ms != null ? ` (${res.latency_ms}ms)` : ''}`)
      } else {
        toast.error(res.error || 'Account check failed')
      }
      await loadAccounts()
    } catch (e: any) {
      toast.error(e?.message || 'Account test failed')
    } finally {
      setBusyKey(null)
    }
  }

  const reorder = async (provider: OAuthProviderId, list: OAuthAccount[], idx: number, dir: -1 | 1) => {
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= list.length) return
    const nextOrder = [...list]
    ;[nextOrder[idx], nextOrder[swapIdx]] = [nextOrder[swapIdx], nextOrder[idx]]
    setBusyKey(`reorder:${provider}`)
    try {
      const updated = await api.gatewayAccountReorder(
        provider,
        nextOrder.map((a) => a.id),
      )
      setState(updated)
      await onChanged?.()
    } catch (e: any) {
      toast.error(e?.message || 'Could not reorder accounts')
    } finally {
      setBusyKey(null)
    }
  }

  const disconnect = async (acct: OAuthAccount, label: string) => {
    setBusyKey(`del:${acct.id}`)
    try {
      const updated = await api.gatewayAccountDelete(acct.provider, acct.id)
      setState(updated)
      toast.success(`Disconnected ${label}`)
      await onChanged?.()
    } catch (e: any) {
      toast.error(e?.message || 'Disconnect failed')
    } finally {
      setBusyKey(null)
    }
  }

  const toggleStrategy = async (strategy: 'ordered' | 'round_robin') => {
    try {
      const res = await api.gatewayUpdateSettings({ routing_strategy: strategy })
      setState((prev) => (prev ? { ...prev, settings: res.settings } : prev))
      toast.success(`Account routing set to ${strategy === 'round_robin' ? 'Round-robin' : 'Ordered (#1 first)'}`)
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update routing strategy')
    }
  }

  const saveGeminiCreds = async () => {
    setSavingGemini(true)
    try {
      const res = await api.gatewayUpdateSettings({
        gemini_oauth_client_id: geminiClientId.trim(),
        gemini_oauth_client_secret: geminiClientSecret.trim() || undefined,
      })
      setState((prev) => (prev ? { ...prev, settings: res.settings } : prev))
      setGeminiClientSecret('')
      setShowGeminiConfig(false)
      toast.success('Gemini OAuth credentials saved')
    } catch (e: any) {
      toast.error(e?.message || 'Could not save Gemini credentials')
    } finally {
      setSavingGemini(false)
    }
  }

  const grouped = useMemo(() => {
    const map: Record<string, OAuthAccount[]> = {}
    for (const a of state?.accounts || []) {
      ;(map[a.provider] ||= []).push(a)
    }
    return map
  }, [state?.accounts])

  const connectedProviders = useMemo(
    () => (state?.providers || []).filter((p) => (grouped[p.id] || []).length > 0),
    [state?.providers, grouped],
  )
  const availableProviders = useMemo(
    () => (state?.providers || []).filter((p) => (grouped[p.id] || []).length === 0),
    [state?.providers, grouped],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-cyan-500" />
            Subscription accounts (OAuth)
          </div>
          <p className="text-[11px] text-muted-foreground">
            Route requests through your Claude, ChatGPT Codex, GitHub Copilot, Gemini, Kimi, Kilo Code, Muse, or Nous subscriptions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {state?.settings && (
            <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => toggleStrategy('ordered')}
                className={`rounded px-2 py-1 font-medium transition-colors ${
                  state.settings.routing_strategy === 'ordered'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Always try account #1 first; fail over to #2 on 429 or errors"
              >
                Ordered (#1→#2)
              </button>
              <button
                type="button"
                onClick={() => toggleStrategy('round_robin')}
                className={`rounded px-2 py-1 font-medium transition-colors ${
                  state.settings.routing_strategy === 'round_robin'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Rotate requests evenly across healthy accounts"
              >
                Round-robin
              </button>
            </div>
          )}

          <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setDetailed(false)}
              className={`rounded px-2 py-1 font-medium ${!detailed ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
            >
              Compact
            </button>
            <button
              type="button"
              onClick={() => setDetailed(true)}
              className={`rounded px-2 py-1 font-medium ${detailed ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
            >
              Detailed
            </button>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setShowGeminiConfig((v) => !v)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Gemini App
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={syncingUsage || !state?.accounts.length}
            onClick={() => syncUsage(true)}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncingUsage ? 'animate-spin' : ''}`} />
            Sync Quota
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          Subscription OAuth tokens are encrypted locally in <code className="font-mono">gateway.db</code> and route through your own plan quota.
          Review each provider’s Terms of Service before heavy automated or shared gateway usage.
        </div>
      </div>

      {showGeminiConfig && (
        <Card className="space-y-3 border-cyan-500/30 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <KeyRound className="h-3.5 w-3.5 text-cyan-500" />
              Google OAuth Client (Gemini CLI)
            </div>
            {state?.settings?.gemini_oauth_configured && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                Configured {state.settings.gemini_oauth_client_secret_masked ? `(${state.settings.gemini_oauth_client_secret_masked})` : ''}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Google requires your own Desktop OAuth Client ID &amp; Secret (or set <code className="font-mono">GEMINI_OAUTH_CLIENT_ID</code> / <code className="font-mono">GEMINI_OAUTH_CLIENT_SECRET</code> in the backend environment).
            Authorize redirect URI <code className="font-mono">http://localhost:54545/callback</code>.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={geminiClientId}
              onChange={(e) => setGeminiClientId(e.target.value)}
              placeholder="Google OAuth Client ID"
              className="h-8 font-mono text-xs"
              data-no-token-complete
            />
            <Input
              type="password"
              value={geminiClientSecret}
              onChange={(e) => setGeminiClientSecret(e.target.value)}
              placeholder={state?.settings.gemini_oauth_client_secret_masked ? 'New Client Secret (leave blank to keep)' : 'Google OAuth Client Secret'}
              className="h-8 font-mono text-xs"
              data-no-token-complete
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowGeminiConfig(false)}>
              Close
            </Button>
            <Button size="sm" className="h-8 text-xs" disabled={savingGemini || !geminiClientId.trim()} onClick={saveGeminiCreds}>
              {savingGemini ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save Gemini Credentials'}
            </Button>
          </div>
        </Card>
      )}

      {pending && (
        <Card className="space-y-3 border-cyan-500/40 bg-cyan-500/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-500" />
              Connecting {pending.providerName}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => {
                stopPolling()
                setPending(null)
              }}
            >
              Cancel
            </Button>
          </div>

          {pending.start.kind === 'redirect' ? (
            <div className="space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {pending.start.auth_url && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => window.open(pending.start.auth_url, '_blank', 'noopener,noreferrer')}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Login Page
                  </Button>
                )}
                {pending.start.auth_url && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1 text-xs"
                    onClick={() => copyText('auth-url', pending.start.auth_url!)}
                  >
                    {copiedId === 'auth-url' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Copy URL
                  </Button>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {pending.start.auto_callback
                    ? `Listening on ${pending.start.redirect_uri} for automatic completion...`
                    : 'After signing in, paste the full redirect URL or code#state below.'}
                </span>
              </div>
              <div className="flex gap-2">
                <Input
                  value={pastedCallback}
                  onChange={(e) => setPastedCallback(e.target.value)}
                  placeholder="Paste redirect URL (http://localhost:...) or code#state"
                  className="h-8 flex-1 font-mono text-xs"
                  data-no-token-complete
                  onKeyDown={(e) => e.key === 'Enter' && void completeRedirect()}
                />
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={busyKey === 'complete' || !pastedCallback.trim()}
                  onClick={completeRedirect}
                >
                  {busyKey === 'complete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Complete Login'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
                <span className="text-[11px] text-muted-foreground">Code:</span>
                <code className="font-mono text-sm font-bold tracking-wider">{pending.start.user_code}</code>
                <button
                  type="button"
                  onClick={() => copyText('device-code', pending.start.user_code || '')}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Copy device code"
                >
                  {copiedId === 'device-code' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              {pending.start.verification_uri && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => window.open(pending.start.verification_uri, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Verification Page
                </Button>
              )}
              <span className="text-[11px] text-muted-foreground">Waiting for authorization…</span>
            </div>
          )}
        </Card>
      )}

      {connectedProviders.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {connectedProviders.map((meta) => {
            const accts = grouped[meta.id] || []
            const models = state?.models[meta.id] || []
            const gstat = summaryMap[meta.id]
            return (
              <Card key={meta.id} className="space-y-3 border-emerald-500/30 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        {meta.alias}/
                      </code>
                      <span className="text-xs font-semibold">{meta.name}</span>
                      <span className="text-[10px] text-muted-foreground">{meta.plan}</span>
                    </div>
                    {gstat && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Today: <span className="font-mono text-foreground">{fmtNum(gstat.today_requests)}</span> req /{' '}
                        <span className="font-mono text-foreground">{fmtNum(gstat.today_tokens)}</span> tok · All:{' '}
                        <span className="font-mono text-foreground">{fmtNum(gstat.total_requests)}</span> req
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-[11px]"
                    disabled={busyKey !== null}
                    onClick={() => beginLogin(meta)}
                  >
                    <Plus className="h-3 w-3" />
                    Add account
                  </Button>
                </div>

                <div className="space-y-2">
                  {accts.map((acct, idx) => {
                    const usage = usageMap[acct.id]
                    const maxPct = usage?.windows?.reduce((m, w) => Math.max(m, w.used_pct), 0)
                    return (
                      <div key={acct.id} className="space-y-1.5 rounded-md border border-border bg-muted/20 p-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5 text-xs">
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                              #{idx + 1}
                            </span>
                            <span className="truncate font-medium" title={acct.email || acct.id}>
                              {acct.email || acct.id}
                            </span>
                            {(usage?.plan || acct.plan) && (
                              <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-600 dark:text-cyan-400">
                                {usage?.plan || acct.plan}
                              </span>
                            )}
                            {acct.last_error ? (
                              <span className="truncate rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-500" title={acct.last_error}>
                                Error
                              </span>
                            ) : (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Connected" />
                            )}
                            {!detailed && maxPct !== undefined && usage?.windows?.length ? (
                              <span className="font-mono text-[10px] text-muted-foreground">{maxPct}% used</span>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-1">
                            {accts.length > 1 && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0"
                                  disabled={idx === 0 || busyKey !== null}
                                  onClick={() => reorder(meta.id, accts, idx, -1)}
                                  title="Move up"
                                  aria-label="Move account up"
                                >
                                  <ArrowUp className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0"
                                  disabled={idx === accts.length - 1 || busyKey !== null}
                                  onClick={() => reorder(meta.id, accts, idx, 1)}
                                  title="Move down"
                                  aria-label="Move account down"
                                >
                                  <ArrowDown className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-[11px]"
                              disabled={busyKey === `test:${acct.id}`}
                              onClick={() => testAccount(acct, meta.name)}
                            >
                              {busyKey === `test:${acct.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Test'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-[11px]"
                              disabled={busyKey !== null}
                              onClick={() => beginLogin(meta, acct.id)}
                            >
                              Re-login
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-red-500"
                              disabled={busyKey === `del:${acct.id}`}
                              onClick={() => disconnect(acct, `${meta.name} (${acct.email || acct.id})`)}
                              title="Disconnect account"
                              aria-label="Disconnect account"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        {detailed && acct.last_error && (
                          <div className="text-[10px] text-red-500">{acct.last_error}</div>
                        )}

                        {detailed && usage?.windows && usage.windows.length > 0 && (
                          <div className="grid gap-1.5 pt-1 sm:grid-cols-2">
                            {usage.windows.map((w) => (
                              <div key={w.label} className="space-y-0.5 text-[10px]">
                                <div className="flex justify-between gap-2">
                                  <span className="truncate font-medium text-muted-foreground">{w.label}</span>
                                  <span className="shrink-0 font-mono">
                                    {w.used_pct}%{w.resets_at ? ` · ${formatReset(w.resets_at)}` : ''}
                                  </span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className={`h-full transition-all ${barColor(w.used_pct)}`}
                                    style={{ width: `${Math.min(100, Math.max(0, w.used_pct))}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {detailed && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {[`${meta.alias}/auto`, ...models.map((m) => `${meta.alias}/${m}`)].map((fullId) => (
                      <button
                        key={fullId}
                        type="button"
                        onClick={() => copyText(`model:${fullId}`, fullId)}
                        className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-cyan-500/40 hover:text-foreground"
                        title={`Click to copy ${fullId}`}
                      >
                        {copiedId === `model:${fullId}` && <Check className="h-2.5 w-2.5 text-emerald-500" />}
                        {fullId}
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {availableProviders.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {availableProviders.map((meta) => {
            const models = state?.models[meta.id] || []
            const allIds = [`${meta.alias}/auto`, ...models.map((m) => `${meta.alias}/${m}`)]
            const isExpanded = !!expandedOAuth[meta.id]
            const shown = isExpanded ? allIds : allIds.slice(0, 3)
            const rest = allIds.length - shown.length
            return (
              <Card key={meta.id} className="flex flex-col justify-between gap-2 p-3">
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold shrink-0">
                          {meta.alias}/
                        </code>
                        <span className="text-xs font-semibold truncate">{meta.name}</span>
                      </div>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground shrink-0">
                        {meta.flow === 'redirect' ? 'OAuth PKCE' : 'Device'}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{meta.plan}</span>
                      <span className="font-mono">{models.length} models</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {shown.map((fullId) => (
                      <button
                        key={fullId}
                        type="button"
                        onClick={() => copyText(`avail:${fullId}`, fullId)}
                        className="max-w-[140px] truncate rounded border border-border/80 bg-muted/40 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground hover:border-cyan-500/40 hover:text-foreground cursor-pointer"
                        title={`Copy ${fullId}`}
                      >
                        {copiedId === `avail:${fullId}` ? 'Copied!' : fullId}
                      </button>
                    ))}
                    {rest > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpandedOAuth((prev) => ({ ...prev, [meta.id]: true }))}
                        className="rounded border border-dashed border-border px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground hover:border-cyan-500/40 hover:text-foreground cursor-pointer"
                        title={`Show all ${allIds.length} models`}
                      >
                        +{rest}
                      </button>
                    )}
                    {isExpanded && allIds.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setExpandedOAuth((prev) => ({ ...prev, [meta.id]: false }))}
                        className="rounded border border-border px-1.5 py-0.5 font-mono text-[9.5px] text-cyan-500 hover:bg-muted/40 cursor-pointer"
                      >
                        less
                      </button>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full text-xs"
                  disabled={busyKey !== null}
                  onClick={() => beginLogin(meta)}
                >
                  {busyKey === `start:${meta.id}:new` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    'Connect'
                  )}
                </Button>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

