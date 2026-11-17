import { useEffect, useState } from 'react'
import {
  Check,
  Code2,
  FolderOpen,
  GitBranch,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Sparkles,
  Unplug,
} from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  api,
  type CodeSummaryResult,
  type DiscoveredEndpoint,
  type GitHubRepoSummary,
  type GitHubStatus,
} from '../../lib/api'
import { isDesktop } from '../../lib/platform'

interface Props {
  onGenerated: () => Promise<void> | void
  onClose: () => void
}

const METHOD_BADGE: Record<string, string> = {
  GET: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  POST: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  PUT: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  PATCH: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  DELETE: 'bg-red-500/15 text-red-400 border-red-500/30',
}

export function GitHubCodeSummaryPanel({ onGenerated, onClose }: Props) {
  const [sourceMode, setSourceMode] = useState<'github' | 'local'>('github')
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)

  const [patInput, setPatInput] = useState('')
  const [apiBaseInput, setApiBaseInput] = useState('')
  const [showAdvancedPat, setShowAdvancedPat] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const [repos, setRepos] = useState<GitHubRepoSummary[]>([])
  const [repoSearch, setRepoSearch] = useState('')
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [selectedRepo, setSelectedRepo] = useState('')
  const [branchInput, setBranchInput] = useState('')

  const [localPath, setLocalPath] = useState('')
  const [useAi, setUseAi] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const [summary, setSummary] = useState<CodeSummaryResult | null>(null)
  const [collectionName, setCollectionName] = useState('')
  const [baseUrl, setBaseUrl] = useState('http://localhost:8000')
  const [endpoints, setEndpoints] = useState<DiscoveredEndpoint[]>([])

  const loadStatusAndRepos = async () => {
    setLoadingStatus(true)
    try {
      const st = await api.githubStatus()
      setGhStatus(st)
      if (st.connected) {
        setLoadingRepos(true)
        try {
          const res = await api.githubRepos('', 50)
          setRepos(res.repos || [])
        } finally {
          setLoadingRepos(false)
        }
      } else {
        setRepos([])
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load GitHub status')
    } finally {
      setLoadingStatus(false)
    }
  }

  useEffect(() => {
    void loadStatusAndRepos()
  }, [])

  const handleConnectPat = async () => {
    if (!patInput.trim()) return
    setConnecting(true)
    setError('')
    try {
      const st = await api.githubConnect(patInput.trim(), apiBaseInput.trim() || undefined)
      setGhStatus(st)
      setPatInput('')
      setLoadingRepos(true)
      const res = await api.githubRepos('', 50)
      setRepos(res.repos || [])
    } catch (e: any) {
      setError(e?.message || 'GitHub PAT authentication failed')
    } finally {
      setConnecting(false)
      setLoadingRepos(false)
    }
  }

  const handleDisconnect = async () => {
    setError('')
    await api.githubDisconnect()
    setGhStatus({ connected: false, scopes: [] })
    setRepos([])
    setSelectedRepo('')
  }

  const refreshRepos = async (q = repoSearch) => {
    setLoadingRepos(true)
    setError('')
    try {
      const res = await api.githubRepos(q, 50)
      setRepos(res.repos || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load repositories')
    } finally {
      setLoadingRepos(false)
    }
  }

  const browseLocalFolder = async () => {
    if (!isDesktop()) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const chosen = await open({ directory: true, multiple: false, title: 'Select project code folder' })
      if (typeof chosen === 'string') setLocalPath(chosen)
    } catch (e: any) {
      setError(e?.message || 'Could not open folder picker')
    }
  }

  const runSummarize = async () => {
    setAnalyzing(true)
    setError('')
    try {
      const res =
        sourceMode === 'github'
          ? await api.githubSummarizeRepo(selectedRepo.trim(), branchInput.trim() || undefined, useAi)
          : await api.summarizeLocalCode(localPath.trim(), useAi)
      setSummary(res)
      setCollectionName(res.suggested_name)
      setBaseUrl(res.default_base_url || 'http://localhost:8000')
      setEndpoints(res.endpoints || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to summarize project code')
    } finally {
      setAnalyzing(false)
    }
  }

  const toggleEndpoint = (id: string) => {
    setEndpoints((prev) => prev.map((ep) => (ep.id === id ? { ...ep, selected: !ep.selected } : ep)))
  }

  const toggleAllEndpoints = (selected: boolean) => {
    setEndpoints((prev) => prev.map((ep) => ({ ...ep, selected })))
  }

  const handleGenerateCollection = async () => {
    setGenerating(true)
    setError('')
    try {
      await api.generateCodeCollection({
        name: collectionName.trim() || summary?.suggested_name || 'Generated Collection',
        base_url: baseUrl.trim() || 'http://localhost:8000',
        endpoints,
      })
      await onGenerated()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to generate collection')
    } finally {
      setGenerating(false)
    }
  }

  const selectedCount = endpoints.filter((e) => e.selected).length
  const filteredRepos = repos.filter((r) => {
    const q = repoSearch.trim().toLowerCase()
    if (!q) return true
    return (
      r.full_name.toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-3">
      {/* Source Mode Switcher */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 p-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { setSourceMode('github'); setError('') }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              sourceMode === 'github' ? 'bg-background text-foreground shadow-xs border border-border' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            GitHub Repo (PAT)
          </button>
          <button
            type="button"
            onClick={() => { setSourceMode('local'); setError('') }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              sourceMode === 'local' ? 'bg-background text-foreground shadow-xs border border-border' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Local Project Code
          </button>
        </div>

        <label className="flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useAi}
            onChange={(e) => setUseAi(e.target.checked)}
            className="rounded border-border accent-emerald-500"
          />
          <Sparkles className="w-3 h-3 text-emerald-500" />
          <span>AI Summary</span>
        </label>
      </div>

      {/* GitHub PAT Connection + Repo Picker */}
      {sourceMode === 'github' && !summary && (
        <div className="space-y-3">
          {loadingStatus ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/15 p-4 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking GitHub connection…
            </div>
          ) : ghStatus?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  {ghStatus.avatar_url ? (
                    <img src={ghStatus.avatar_url} alt={ghStatus.login || 'GitHub'} className="w-7 h-7 rounded-full border border-border shrink-0" />
                  ) : (
                    <KeyRound className="w-4 h-4 text-emerald-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground truncate">
                      Connected as <span className="font-mono text-emerald-500">@{ghStatus.login}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      Scopes: {ghStatus.scopes.length > 0 ? ghStatus.scopes.join(', ') : 'fine-grained PAT'}
                    </div>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={handleDisconnect} className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive">
                  <Unplug className="w-3.5 h-3.5 mr-1" /> Disconnect
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <Input
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Filter repos or type owner/repo below…"
                    className="pl-8 h-8 text-xs"
                  />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void refreshRepos()} disabled={loadingRepos} className="h-8 px-2.5 text-xs">
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingRepos ? 'animate-spin' : ''}`} />
                </Button>
              </div>

              <div className="max-h-40 overflow-y-auto rounded-xl border border-border divide-y divide-border/60 bg-background/60">
                {loadingRepos ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">Loading repositories…</div>
                ) : filteredRepos.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">No matching repositories found.</div>
                ) : (
                  filteredRepos.map((r) => {
                    const active = selectedRepo === r.full_name
                    return (
                      <button
                        key={r.full_name}
                        type="button"
                        onClick={() => {
                          setSelectedRepo(r.full_name)
                          setBranchInput(r.default_branch)
                        }}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors ${
                          active ? 'bg-emerald-500/10' : 'hover:bg-muted/50'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                            <span className="truncate font-mono">{r.full_name}</span>
                            {r.private && <Lock className="w-3 h-3 text-amber-500 shrink-0" />}
                          </div>
                          {r.description && <div className="text-[10.5px] text-muted-foreground truncate">{r.description}</div>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-muted-foreground">
                          {r.language && <span className="px-1.5 py-0.5 rounded bg-muted border border-border">{r.language}</span>}
                          {active && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 items-end">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground block mb-1">Repository (owner/repo)</label>
                  <Input
                    value={selectedRepo}
                    onChange={(e) => setSelectedRepo(e.target.value)}
                    placeholder="owner/repo"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground block mb-1">Branch</label>
                  <Input
                    value={branchInput}
                    onChange={(e) => setBranchInput(e.target.value)}
                    placeholder="main"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <Button type="button" onClick={runSummarize} disabled={!selectedRepo.trim() || analyzing} className="h-8 text-xs px-3.5">
                  {analyzing ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Summarizing…</> : 'Summarize & Scan'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-muted/15 p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <KeyRound className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-foreground">Connect GitHub with Personal Access Token (PAT)</div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Encrypted locally with AES-256-GCM (<code className="font-mono">gateway.key</code>). Use <code className="font-mono">repo</code> scope to scan private repositories.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Input
                  type="password"
                  value={patInput}
                  onChange={(e) => setPatInput(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx or github_pat_..."
                  className="h-8 text-xs font-mono"
                />
                {showAdvancedPat && (
                  <Input
                    value={apiBaseInput}
                    onChange={(e) => setApiBaseInput(e.target.value)}
                    placeholder="GitHub API Base (default: https://api.github.com)"
                    className="h-8 text-xs font-mono"
                  />
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdvancedPat((v) => !v)}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  {showAdvancedPat ? 'Hide Enterprise URL' : 'GitHub Enterprise URL?'}
                </button>
                <Button type="button" size="sm" onClick={handleConnectPat} disabled={!patInput.trim() || connecting} className="h-8 text-xs px-3.5">
                  {connecting ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Verifying…</> : 'Connect GitHub'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Local Project Code Scanner */}
      {sourceMode === 'local' && !summary && (
        <div className="rounded-xl border border-border bg-muted/15 p-4 space-y-3">
          <div>
            <div className="text-xs font-semibold text-foreground">Scan Local Backend / API Project Folder</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Reads OpenAPI/Postman specs or extracts routes directly from source code (Axum, Express, NestJS, Next.js, FastAPI, Go, Laravel).
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="/Users/you/projects/my-api"
              className="h-8 text-xs font-mono flex-1"
            />
            {isDesktop() && (
              <Button type="button" variant="outline" size="sm" onClick={browseLocalFolder} className="h-8 text-xs px-2.5">
                <FolderOpen className="w-3.5 h-3.5 mr-1" /> Browse
              </Button>
            )}
            <Button type="button" size="sm" onClick={runSummarize} disabled={!localPath.trim() || analyzing} className="h-8 text-xs px-3.5">
              {analyzing ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Scanning…</> : 'Summarize Code'}
            </Button>
          </div>
        </div>
      )}

      {/* Summary & Generated Collection Preview */}
      {summary && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {summary.frameworks.map((fw) => (
                  <span key={fw} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                    {fw}
                  </span>
                ))}
                {summary.ai_enhanced && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-500/10 text-violet-400 border border-violet-500/30 flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" /> AI Enhanced
                  </span>
                )}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSummary(null)} className="h-6 px-2 text-[11px]">
                Change Source
              </Button>
            </div>
            <div className="text-[11.5px] text-muted-foreground whitespace-pre-line leading-relaxed">
              {summary.summary_markdown}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Collection Name</label>
              <Input value={collectionName} onChange={(e) => setCollectionName(e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Base URL</label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="h-8 text-xs font-mono" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background/70 overflow-hidden">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between text-[11px]">
              <span className="font-semibold text-foreground">
                Discovered Endpoints ({selectedCount}/{endpoints.length})
              </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => toggleAllEndpoints(true)} className="text-muted-foreground hover:text-foreground">Select all</button>
                <button type="button" onClick={() => toggleAllEndpoints(false)} className="text-muted-foreground hover:text-foreground">Clear</button>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto divide-y divide-border/50">
              {endpoints.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">No endpoints detected in scanned files.</div>
              ) : (
                endpoints.map((ep) => (
                  <label key={ep.id} className="flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ep.selected}
                      onChange={() => toggleEndpoint(ep.id)}
                      className="rounded border-border accent-emerald-500"
                    />
                    <span className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold shrink-0 ${METHOD_BADGE[ep.method] || 'bg-muted text-foreground border-border'}`}>
                      {ep.method}
                    </span>
                    <span className="font-mono text-[11.5px] truncate flex-1">{ep.path}</span>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[110px]">{ep.folder}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleGenerateCollection}
              disabled={generating || selectedCount === 0}
              className="h-9 text-xs px-4"
            >
              {generating ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Generating…</>
              ) : (
                `Generate Collection (${selectedCount} endpoints)`
              )}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}
