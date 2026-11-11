import { useMemo, useState } from 'react'
import { Activity, Search, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { toast } from '../ui/toast'
import { api } from '../../lib/api'
import { GatewayChart } from './GatewayChart'
import { ProviderLogo } from './ProviderLogo'
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
      {/* Visual Analytics Chart */}
      <GatewayChart usage={usage} stats={stats} />

      {/* Logs Table */}
      <Card className="overflow-hidden p-0 border-border/80 bg-card/60 backdrop-blur-sm">
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
                    <td className="whitespace-nowrap p-2.5 text-muted-foreground font-mono text-[11px]">
                      {new Date(u.ts * 1000).toLocaleTimeString()}
                    </td>
                    <td className="p-2.5 font-medium">{u.key_name}</td>
                    <td className="p-2.5">
                      <div className="flex items-center gap-1.5 font-mono text-[11px] text-foreground">
                        <ProviderLogo provider={u.provider} size="xs" badge />
                        <span className="capitalize">{u.provider}</span>
                      </div>
                    </td>
                    <td className="p-2.5 font-mono text-cyan-500">
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
                    <td className="p-2.5 text-right font-mono text-muted-foreground">
                      <span className="text-foreground">{fmt(u.input_tokens)}</span> / {fmt(u.output_tokens)}
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
