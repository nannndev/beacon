import { useMemo, useState } from 'react'
import { Activity, Search, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { toast } from '../ui/toast'
import { api } from '../../lib/api'
import type { GatewayStats, GatewayUsage } from '../../types'

interface GatewayUsageProps {
  usage: GatewayUsage[]
  stats: GatewayStats | null
  onChanged: () => void
}

const fmt = (n: number) => n.toLocaleString()

export function GatewayUsagePanel({ usage, stats, onChanged }: GatewayUsageProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all')
  const [clearing, setClearing] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return usage.filter((u) => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false
      if (!q) return true
      return (
        u.model.toLowerCase().includes(q) ||
        u.key_name.toLowerCase().includes(q) ||
        u.provider.toLowerCase().includes(q) ||
        (u.error || '').toLowerCase().includes(q)
      )
    })
  }, [usage, search, statusFilter])

  const topProviders = useMemo(() => {
    const map = new Map<string, { provider: string; requests: number; tokens: number; errors: number }>()
    for (const u of usage) {
      const prev = map.get(u.provider) || { provider: u.provider, requests: 0, tokens: 0, errors: 0 }
      prev.requests += 1
      prev.tokens += (u.input_tokens || 0) + (u.output_tokens || 0)
      if (u.status === 'error') prev.errors += 1
      map.set(u.provider, prev)
    }
    const list = Array.from(map.values()).sort((a, b) => b.requests - a.requests)
    const maxReq = Math.max(1, list[0]?.requests || 1)
    return list.slice(0, 6).map((item) => ({ ...item, pct: Math.round((item.requests / maxReq) * 100) }))
  }, [usage])

  const handleClear = async () => {
    setClearing(true)
    try {
      await api.gatewayClearUsage()
      toast.success('Gateway usage logs cleared')
      onChanged()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to clear usage logs')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="space-y-5">
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Requests', fmt(stats.requests)],
            ['Input tokens', fmt(stats.input_tokens)],
            ['Output tokens', fmt(stats.output_tokens)],
            ['Errors', fmt(stats.errors)],
            ['Active keys', fmt(stats.active_keys)],
            ['Providers', fmt(stats.connected_providers)],
          ].map(([label, value]) => (
            <Card key={label} className="p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
            </Card>
          ))}
        </div>
      )}

      {topProviders.length > 0 && (
        <Card className="p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Activity className="w-3.5 h-3.5 text-cyan-500" />
              <span>Traffic Distribution by Provider (recent {usage.length} requests)</span>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {topProviders.map((p) => (
              <div key={p.provider} className="rounded-lg border border-border bg-background/50 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold">{p.provider}</span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {fmt(p.requests)} req · {fmt(p.tokens)} tok
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.max(6, p.pct)}%` }} />
                </div>
                {p.errors > 0 && (
                  <div className="text-[10px] text-red-500 font-mono">{p.errors} error(s)</div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3 bg-muted/20">
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[200px]">
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by model, key, provider…"
                className="h-8 pl-8 text-xs"
                data-no-token-complete
              />
            </div>
            <div className="inline-flex rounded-lg border border-border bg-background p-0.5 text-[11px]">
              {(
                [
                  ['all', 'All'],
                  ['success', 'Success'],
                  ['error', 'Errors'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStatusFilter(id)}
                  className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                    statusFilter === id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {usage.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={clearing}
              onClick={() => void handleClear()}
              className="h-8 gap-1.5 text-xs text-red-500 hover:text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear logs
            </Button>
          )}
        </div>

        {filtered.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            {usage.length === 0 ? 'No gateway traffic recorded yet.' : 'No requests match the current filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/10">
                <tr>
                  <th className="p-2.5">Time</th>
                  <th className="p-2.5">Key</th>
                  <th className="p-2.5">Provider</th>
                  <th className="p-2.5">Model</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5 text-right">Tokens in / out</th>
                  <th className="p-2.5 text-right">ms</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((u) => (
                  <tr key={u.id} title={u.error || undefined} className="hover:bg-muted/20">
                    <td className="whitespace-nowrap p-2.5 text-muted-foreground">
                      {new Date(u.ts * 1000).toLocaleTimeString()}
                    </td>
                    <td className="p-2.5 font-medium">{u.key_name}</td>
                    <td className="p-2.5 font-mono text-[11px] text-muted-foreground">{u.provider}</td>
                    <td className="p-2.5 font-mono">
                      {u.model}
                      {u.streaming && (
                        <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[9.5px] text-muted-foreground">
                          stream
                        </span>
                      )}
                    </td>
                    <td
                      className={`p-2.5 font-mono ${
                        u.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
                      }`}
                    >
                      {u.status_code}
                      {u.error && u.status === 'success' && (
                        <span className="ml-1 text-[10px] text-amber-500">(fallback)</span>
                      )}
                    </td>
                    <td className="p-2.5 text-right font-mono">
                      {fmt(u.input_tokens)} / {fmt(u.output_tokens)}
                    </td>
                    <td className="p-2.5 text-right font-mono">{fmt(u.duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

