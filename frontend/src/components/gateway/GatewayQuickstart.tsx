import { useMemo, useState } from 'react'
import { Check, Copy, Play, Search, Terminal, Zap } from 'lucide-react'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { toast } from '../ui/toast'

interface GatewayQuickstartProps {
  openaiBase: string
  anthropicBase: string
  healthUrl: string
  models: Array<{ id: string; owned_by: string }>
  sampleSecret?: string | null
  onTryModel: (modelId: string) => void
  onCreateTestRequest: (modelId: string) => void
}

type ClientKind = 'claude' | 'openai' | 'cursor' | 'curl'

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Copied to clipboard')
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Failed to copy')
    }
  }
  return (
    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px] shrink-0" onClick={() => void copy()}>
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? 'Copied' : label}</span>
    </Button>
  )
}

export function GatewayQuickstart({
  openaiBase,
  anthropicBase,
  healthUrl,
  models,
  sampleSecret,
  onTryModel,
  onCreateTestRequest,
}: GatewayQuickstartProps) {
  const [clientTab, setClientTab] = useState<ClientKind>('claude')
  const [modelSearch, setModelSearch] = useState('')
  const [copiedModel, setCopiedModel] = useState<string | null>(null)

  const apiKeyPlaceholder = sampleSecret || '<YOUR_BEACON_GATEWAY_KEY>'
  const firstRoutableModel = models.find((m) => !m.id.startsWith('auto/'))?.id || models[0]?.id || 'oa/gpt-4o'
  const claudeModel =
    models.find((m) => m.id.startsWith('cc/') || m.id.startsWith('ac/'))?.id || firstRoutableModel

  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase()
    if (!q) return models
    return models.filter((m) => m.id.toLowerCase().includes(q) || m.owned_by.toLowerCase().includes(q))
  }, [models, modelSearch])

  const copyModel = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      setCopiedModel(id)
      toast.success(`Copied ${id}`)
      window.setTimeout(() => setCopiedModel((p) => (p === id ? null : p)), 1400)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const snippets: Record<ClientKind, { title: string; subtitle: string; code: string }> = {
    claude: {
      title: 'Claude Code CLI',
      subtitle: 'Point Claude Code at Beacon AI Gateway using the Anthropic Messages endpoint.',
      code: `export ANTHROPIC_BASE_URL="${anthropicBase}"
export ANTHROPIC_AUTH_TOKEN="${apiKeyPlaceholder}"
export ANTHROPIC_MODEL="${claudeModel}"

claude`,
    },
    openai: {
      title: 'OpenAI SDK / Codex',
      subtitle: 'Works with any OpenAI-compatible client, SDK, or Codex CLI.',
      code: `export OPENAI_BASE_URL="${openaiBase}"
export OPENAI_API_KEY="${apiKeyPlaceholder}"

# Python OpenAI SDK example:
# from openai import OpenAI
# client = OpenAI(base_url="${openaiBase}", api_key="${apiKeyPlaceholder}")
# res = client.chat.completions.create(model="${firstRoutableModel}", messages=[{"role": "user", "content": "Hello"}])`,
    },
    cursor: {
      title: 'Cursor / OpenCode / Continue',
      subtitle: 'Set Custom OpenAI Base URL and paste any routable model ID or auto/<combo>.',
      code: `Base URL:  ${openaiBase}
API Key:   ${apiKeyPlaceholder}
Model ID:  ${firstRoutableModel}   # or auto/<combo-name>, <alias>/auto`,
    },
    curl: {
      title: 'cURL Test Request',
      subtitle: 'Fire an OpenAI chat completion request directly from your terminal.',
      code: `curl ${openaiBase}/chat/completions \\
  -H "Authorization: Bearer ${apiKeyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${firstRoutableModel}",
    "stream": false,
    "messages": [{"role": "user", "content": "Reply with one concise sentence."}]
  }'`,
    },
  }

  const activeSnippet = snippets[clientTab]

  return (
    <div className="space-y-5">
      {/* Endpoints Card */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Gateway Endpoints</div>
            <p className="text-[11px] text-muted-foreground">
              Local & LAN clients authenticate with a Virtual Key from the Virtual Keys tab.
            </p>
          </div>
          {models.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs shrink-0"
              onClick={() => onCreateTestRequest(firstRoutableModel)}
            >
              <Zap className="w-3.5 h-3.5 text-cyan-500" /> Add test request to project
            </Button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {[
            ['OpenAI Base URL (OPENAI_BASE_URL)', openaiBase],
            ['Anthropic Base URL (ANTHROPIC_BASE_URL)', anthropicBase],
            ['Models List (GET)', `${openaiBase}/models`],
            ['Health Check (GET)', healthUrl],
          ].map(([label, url]) => (
            <div key={label} className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px]" title={url}>
                  {url}
                </code>
                <CopyButton text={url} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Client Presets Card */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-500" />
            <span className="text-sm font-semibold">Client Configuration Snippets</span>
          </div>
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
            {(
              [
                ['claude', 'Claude Code'],
                ['openai', 'OpenAI / Codex'],
                ['cursor', 'Cursor / IDE'],
                ['curl', 'cURL'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setClientTab(id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  clientTab === id
                    ? 'bg-card text-foreground shadow-sm border border-border/80'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold">{activeSnippet.title}</div>
              <div className="text-[11px] text-muted-foreground">{activeSnippet.subtitle}</div>
            </div>
            <CopyButton text={activeSnippet.code} label="Copy snippet" />
          </div>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-foreground">
            {activeSnippet.code}
          </pre>
        </div>
      </Card>

      {/* Routable Models Directory */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Available Routable Models ({models.length})</div>
            <p className="text-[11px] text-muted-foreground">
              Click any model ID to copy it, or launch directly into Playground.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
            <Input
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder="Filter models (e.g. gpt, claude, auto/)…"
              className="h-8 pl-8 text-xs font-mono"
              data-no-token-complete
            />
          </div>
        </div>

        {filteredModels.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            {models.length === 0
              ? 'No models available yet. Connect a Subscription OAuth account or API-key provider in the Providers tab.'
              : 'No matching models found.'}
          </p>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 max-h-[320px] overflow-y-auto pr-1">
            {filteredModels.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/50 px-2.5 py-1.5 text-[11px] hover:border-ring transition-colors"
              >
                <button
                  type="button"
                  onClick={() => void copyModel(m.id)}
                  className="min-w-0 flex-1 text-left flex items-center gap-1.5 truncate font-mono cursor-pointer"
                  title={`Click to copy ${m.id}`}
                >
                  {copiedModel === m.id ? (
                    <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                  ) : (
                    <Copy className="w-3 h-3 text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate">{m.id}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onTryModel(m.id)}
                  className="px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-[10px] font-medium inline-flex items-center gap-1 shrink-0 cursor-pointer"
                  title={`Open ${m.id} in Playground`}
                >
                  <Play className="w-2.5 h-2.5" /> Try
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

