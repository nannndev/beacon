import { Braces, Database, RefreshCw, Loader2 } from 'lucide-react'
import type { SendResponse } from '../../lib/api'

interface Props {
  query: string
  variables: string
  schemaUrl?: string
  schemaHash?: string
  schemaFetchedAt?: number
  endpointHeaders: Record<string, string>
  onQueryChange: (query: string) => void
  onVariablesChange: (vars: string) => void
  onFetchSchema: (url: string, headers: Record<string, string>) => Promise<{ ok: boolean; error?: string }>
  loading?: boolean
  response?: SendResponse | null
}

export function GraphqlEditor({
  query, variables, schemaUrl, schemaHash, schemaFetchedAt,
  endpointHeaders, onQueryChange, onVariablesChange, onFetchSchema,
  loading, response,
}: Props) {
  const schemaFetched = !!schemaHash
  const lastFetched = schemaFetchedAt
    ? new Date(schemaFetchedAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Database className="h-3.5 w-3.5 text-violet-500" />
            GraphQL
          </span>
          {schemaFetched ? (
            <span className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 font-mono text-[9px] text-emerald-600 dark:text-emerald-400">
              Schema · {schemaHash} {lastFetched ? `· ${lastFetched}` : ''}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => onFetchSchema(schemaUrl || '', endpointHeaders)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-cyan-500/40 hover:bg-cyan-500/5 hover:text-cyan-500 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Fetch Schema
        </button>
      </div>

      <div className="grid gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Query</label>
          <textarea
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={`query {\n  \n}`}
            rows={8}
            spellCheck={false}
            className="w-full font-mono text-xs p-3 border border-border rounded-lg bg-[#07090d] text-slate-300 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-y min-h-[180px]"
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Braces className="inline h-3 w-3 mr-1" />
            Variables
          </label>
          <textarea
            value={variables}
            onChange={(e) => onVariablesChange(e.target.value)}
            placeholder={`{\n  \n}`}
            rows={4}
            spellCheck={false}
            className="w-full font-mono text-xs p-3 border border-border rounded-lg bg-[#0b0d10] text-slate-300 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-y min-h-[80px]"
          />
        </div>
      </div>

      {response?.error && response.phase === 'graphql' && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-500">
          {response.error}
        </div>
      )}
    </div>
  )
}
