import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Brain,
  Check,
  ChevronDown,
  Code2,
  Layers,
  Search,
  Sparkles,
  Star,
  X,
  Zap,
} from 'lucide-react'

const PINNED_STORAGE_KEY = 'beacon.agent.pinned_models.v1'

export interface ProviderMetaInfo {
  label: string
  shortLabel: string
  badgeColor: string
  monogram: string
  kind: 'combo' | 'subscription' | 'apikey'
}

const PROVIDER_MAP: Record<string, ProviderMetaInfo> = {
  auto: {
    label: 'Model Combos',
    shortLabel: 'Combo',
    badgeColor: 'text-violet-400 bg-violet-500/15 border-violet-500/30',
    monogram: '⚡',
    kind: 'combo',
  },
  cc: {
    label: 'Claude (Pro / Max)',
    shortLabel: 'Claude',
    badgeColor: 'text-amber-500 bg-amber-500/15 border-amber-500/30',
    monogram: 'C',
    kind: 'subscription',
  },
  cx: {
    label: 'ChatGPT / Codex',
    shortLabel: 'Codex',
    badgeColor: 'text-emerald-500 bg-emerald-500/15 border-emerald-500/30',
    monogram: 'X',
    kind: 'subscription',
  },
  gh: {
    label: 'GitHub Copilot',
    shortLabel: 'Copilot',
    badgeColor: 'text-sky-400 bg-sky-500/15 border-sky-500/30',
    monogram: 'G',
    kind: 'subscription',
  },
  gc: {
    label: 'Gemini CLI',
    shortLabel: 'Gemini',
    badgeColor: 'text-blue-400 bg-blue-500/15 border-blue-500/30',
    monogram: '✦',
    kind: 'subscription',
  },
  km: {
    label: 'Kimi Code',
    shortLabel: 'Kimi',
    badgeColor: 'text-indigo-400 bg-indigo-500/15 border-indigo-500/30',
    monogram: 'K',
    kind: 'subscription',
  },
  kc: {
    label: 'Kilo Code',
    shortLabel: 'Kilo',
    badgeColor: 'text-yellow-500 bg-yellow-500/15 border-yellow-500/30',
    monogram: 'k',
    kind: 'subscription',
  },
  mu: {
    label: 'Muse Code',
    shortLabel: 'Muse',
    badgeColor: 'text-blue-400 bg-blue-500/15 border-blue-500/30',
    monogram: 'M',
    kind: 'subscription',
  },
  ns: {
    label: 'Nous Research',
    shortLabel: 'Nous',
    badgeColor: 'text-zinc-300 bg-zinc-500/15 border-zinc-500/30',
    monogram: 'N',
    kind: 'subscription',
  },
  an: {
    label: 'Anthropic API',
    shortLabel: 'Anthropic',
    badgeColor: 'text-amber-500 bg-amber-500/15 border-amber-500/30',
    monogram: 'A',
    kind: 'apikey',
  },
  oa: {
    label: 'OpenAI API',
    shortLabel: 'OpenAI',
    badgeColor: 'text-emerald-500 bg-emerald-500/15 border-emerald-500/30',
    monogram: 'O',
    kind: 'apikey',
  },
  ds: {
    label: 'DeepSeek',
    shortLabel: 'DeepSeek',
    badgeColor: 'text-blue-400 bg-blue-500/15 border-blue-500/30',
    monogram: 'D',
    kind: 'apikey',
  },
  or: {
    label: 'OpenRouter',
    shortLabel: 'OpenRouter',
    badgeColor: 'text-pink-400 bg-pink-500/15 border-pink-500/30',
    monogram: 'R',
    kind: 'apikey',
  },
  ge: {
    label: 'Google Gemini API',
    shortLabel: 'Gemini',
    badgeColor: 'text-red-400 bg-red-500/15 border-red-500/30',
    monogram: 'G',
    kind: 'apikey',
  },
  ol: {
    label: 'Ollama (Local)',
    shortLabel: 'Ollama',
    badgeColor: 'text-zinc-300 bg-zinc-500/15 border-zinc-500/30',
    monogram: 'L',
    kind: 'apikey',
  },
  gq: {
    label: 'Groq',
    shortLabel: 'Groq',
    badgeColor: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
    monogram: 'Q',
    kind: 'apikey',
  },
  mi: {
    label: 'Mistral AI',
    shortLabel: 'Mistral',
    badgeColor: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
    monogram: 'M',
    kind: 'apikey',
  },
  xa: {
    label: 'xAI Grok',
    shortLabel: 'xAI',
    badgeColor: 'text-zinc-300 bg-zinc-500/15 border-zinc-500/30',
    monogram: '𝕏',
    kind: 'apikey',
  },
  tg: {
    label: 'Together AI',
    shortLabel: 'Together',
    badgeColor: 'text-blue-400 bg-blue-500/15 border-blue-500/30',
    monogram: 'T',
    kind: 'apikey',
  },
  fw: {
    label: 'Fireworks AI',
    shortLabel: 'Fireworks',
    badgeColor: 'text-violet-400 bg-violet-500/15 border-violet-500/30',
    monogram: 'F',
    kind: 'apikey',
  },
  cb: {
    label: 'Cerebras',
    shortLabel: 'Cerebras',
    badgeColor: 'text-rose-400 bg-rose-500/15 border-rose-500/30',
    monogram: 'C',
    kind: 'apikey',
  },
  px: {
    label: 'Perplexity',
    shortLabel: 'Perplexity',
    badgeColor: 'text-teal-400 bg-teal-500/15 border-teal-500/30',
    monogram: 'P',
    kind: 'apikey',
  },
  ms: {
    label: 'Moonshot Kimi',
    shortLabel: 'Moonshot',
    badgeColor: 'text-slate-300 bg-slate-500/15 border-slate-500/30',
    monogram: 'K',
    kind: 'apikey',
  },
  qw: {
    label: 'Alibaba DashScope',
    shortLabel: 'Qwen',
    badgeColor: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
    monogram: 'Q',
    kind: 'apikey',
  },
  za: {
    label: 'Z.ai GLM',
    shortLabel: 'Z.ai',
    badgeColor: 'text-sky-400 bg-sky-500/15 border-sky-500/30',
    monogram: 'Z',
    kind: 'apikey',
  },
  mm: {
    label: 'MiniMax',
    shortLabel: 'MiniMax',
    badgeColor: 'text-pink-400 bg-pink-500/15 border-pink-500/30',
    monogram: 'M',
    kind: 'apikey',
  },
  nv: {
    label: 'NVIDIA NIM',
    shortLabel: 'NVIDIA',
    badgeColor: 'text-lime-400 bg-lime-500/15 border-lime-500/30',
    monogram: 'N',
    kind: 'apikey',
  },
  di: {
    label: 'DeepInfra',
    shortLabel: 'DeepInfra',
    badgeColor: 'text-sky-400 bg-sky-500/15 border-sky-500/30',
    monogram: 'D',
    kind: 'apikey',
  },
  sn: {
    label: 'SambaNova',
    shortLabel: 'SambaNova',
    badgeColor: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
    monogram: 'S',
    kind: 'apikey',
  },
  cu: {
    label: 'Custom OpenAI',
    shortLabel: 'Custom',
    badgeColor: 'text-zinc-400 bg-zinc-500/15 border-zinc-500/30',
    monogram: '⚙',
    kind: 'apikey',
  },
}

PROVIDER_MAP.anthropic = PROVIDER_MAP.an
PROVIDER_MAP.openai = PROVIDER_MAP.oa
PROVIDER_MAP.deepseek = PROVIDER_MAP.ds
PROVIDER_MAP.openrouter = PROVIDER_MAP.or
PROVIDER_MAP.gemini = PROVIDER_MAP.ge
PROVIDER_MAP.ollama = PROVIDER_MAP.ol
PROVIDER_MAP.gr = PROVIDER_MAP.gq
PROVIDER_MAP.groq = PROVIDER_MAP.gq
PROVIDER_MAP.mistral = PROVIDER_MAP.mi
PROVIDER_MAP.xai = PROVIDER_MAP.xa
PROVIDER_MAP.together = PROVIDER_MAP.tg
PROVIDER_MAP.fireworks = PROVIDER_MAP.fw
PROVIDER_MAP.cerebras = PROVIDER_MAP.cb
PROVIDER_MAP.perplexity = PROVIDER_MAP.px
PROVIDER_MAP.moonshot = PROVIDER_MAP.ms
PROVIDER_MAP.dashscope = PROVIDER_MAP.qw
PROVIDER_MAP.zai = PROVIDER_MAP.za
PROVIDER_MAP.minimax = PROVIDER_MAP.mm
PROVIDER_MAP.nvidia = PROVIDER_MAP.nv
PROVIDER_MAP.deepinfra = PROVIDER_MAP.di
PROVIDER_MAP.sambanova = PROVIDER_MAP.sn
PROVIDER_MAP.custom = PROVIDER_MAP.cu

export type ModelTag = 'AUTO' | 'FREE' | 'REASONING' | 'CODING' | 'FAST'

export interface ParsedModelItem {
  id: string
  prefix: string
  rawName: string
  cleanName: string
  subVendor?: string
  provider: ProviderMetaInfo
  tags: ModelTag[]
  subtitle?: string
  isProviderAuto?: boolean
}

export function getProviderMeta(prefix: string): ProviderMetaInfo {
  return (
    PROVIDER_MAP[prefix] || {
      label: prefix.toUpperCase(),
      shortLabel: prefix,
      badgeColor: 'text-muted-foreground bg-muted border-border',
      monogram: prefix.slice(0, 2).toUpperCase(),
      kind: 'apikey',
    }
  )
}

export function parseModelItem(id: string, combos?: Record<string, string[]>): ParsedModelItem {
  const slashIdx = id.indexOf('/')
  const prefix = slashIdx > 0 ? id.slice(0, slashIdx) : 'auto'
  const rawName = slashIdx > 0 ? id.slice(slashIdx + 1) : id
  const provider = getProviderMeta(prefix)
  const isProviderAuto = prefix !== 'auto' && rawName === 'auto'

  const tags: ModelTag[] = []
  if (isProviderAuto) {
    tags.push('AUTO')
  } else {
    if (/:free$/i.test(rawName)) tags.push('FREE')
    if (/(^|[-/])(o1|o3|o4|r1|reasoner|reasoning|thinking|qwq)([-/]|$)/i.test(rawName)) tags.push('REASONING')
    if (/(codex|coder|coding|codestral|devstral|starcoder)/i.test(rawName)) tags.push('CODING')
    if (/(mini|flash|haiku|instant|nano|air|lite|fast|lightning|turbo)/i.test(rawName)) tags.push('FAST')
  }

  let withoutFree = rawName.replace(/:free$/i, '')
  let subVendor: string | undefined
  const innerSlash = withoutFree.indexOf('/')
  if (innerSlash > 0) {
    subVendor = withoutFree.slice(0, innerSlash)
    withoutFree = withoutFree.slice(innerSlash + 1)
  }

  const subtitle = isProviderAuto
    ? `Auto-pick & fallback within ${provider.shortLabel}`
    : prefix === 'auto' && combos?.[rawName]
      ? combos[rawName].join(' → ')
      : undefined

  return {
    id,
    prefix,
    rawName,
    cleanName: isProviderAuto ? `Auto (${provider.shortLabel})` : withoutFree,
    subVendor,
    provider,
    tags,
    subtitle,
    isProviderAuto,
  }
}

function loadPinnedModels(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PINNED_STORAGE_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function savePinnedModels(list: string[]) {
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(list.slice(0, 30)))
  } catch {
    // ignore storage errors
  }
}

function ProviderBadge({ prefix, meta }: { prefix: string; meta: ProviderMetaInfo }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-4 h-4 rounded font-mono text-[9px] font-bold border shrink-0 ${meta.badgeColor}`}
      title={meta.label}
    >
      {meta.monogram || prefix.slice(0, 1).toUpperCase()}
    </span>
  )
}

interface AgentModelPickerProps {
  value: string // '' / 'auto' means Auto Smart Fallback
  onChange: (value: string) => void
  options: string[]
  combos?: Record<string, string[]>
  defaultLabel?: string | null
  disabled?: boolean
  onManageProviders?: () => void
  placement?: 'top' | 'bottom'
  placeholderLabel?: string
}

export function AgentModelPicker({
  value,
  onChange,
  options,
  combos,
  defaultLabel,
  disabled = false,
  onManageProviders,
  placement = 'top',
  placeholderLabel,
}: AgentModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [pinned, setPinned] = useState<string[]>(loadPinnedModels)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const [popoverBox, setPopoverBox] = useState<{ left: number; width: number }>({ left: 0, width: 390 })

  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => {
    const seen = new Set<string>()
    const out: ParsedModelItem[] = []
    for (const opt of options) {
      if (!opt || seen.has(opt)) continue
      seen.add(opt)
      out.push(parseModelItem(opt, combos))
    }
    return out
  }, [options, combos])

  const providerTabs = useMemo(() => {
    const counts = new Map<string, { prefix: string; meta: ProviderMetaInfo; count: number }>()
    for (const item of items) {
      const existing = counts.get(item.prefix)
      if (existing) existing.count += 1
      else counts.set(item.prefix, { prefix: item.prefix, meta: item.provider, count: 1 })
    }
    return Array.from(counts.values())
  }, [items])

  const pinnedItems = useMemo(() => items.filter((it) => pinned.includes(it.id)), [items, pinned])

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      if (activeFilter === 'pinned' && !pinned.includes(it.id)) return false
      if (activeFilter !== 'all' && activeFilter !== 'pinned' && it.prefix !== activeFilter) return false
      if (!q) return true
      return (
        it.id.toLowerCase().includes(q) ||
        it.cleanName.toLowerCase().includes(q) ||
        it.provider.label.toLowerCase().includes(q) ||
        it.provider.shortLabel.toLowerCase().includes(q) ||
        (it.subVendor && it.subVendor.toLowerCase().includes(q)) ||
        it.tags.some((tag) => tag.toLowerCase().includes(q))
      )
    })
  }, [items, search, activeFilter, pinned])

  const groupedSections = useMemo(() => {
    const groups: { key: string; title: string; prefix: string; meta: ProviderMetaInfo; list: ParsedModelItem[] }[] = []
    const byPrefix = new Map<string, ParsedModelItem[]>()
    for (const it of filteredItems) {
      const list = byPrefix.get(it.prefix) || []
      list.push(it)
      byPrefix.set(it.prefix, list)
    }
    for (const [prefix, list] of byPrefix.entries()) {
      const meta = getProviderMeta(prefix)
      groups.push({ key: prefix, title: meta.label, prefix, meta, list })
    }
    return groups
  }, [filteredItems])

  const flatSelectable = useMemo(() => {
    const list: string[] = []
    if (activeFilter === 'all' && !search.trim()) list.push('auto')
    for (const g of groupedSections) {
      for (const it of g.list) list.push(it.id)
    }
    return list
  }, [activeFilter, search, groupedSections])

  useEffect(() => {
    setHighlightIdx(0)
  }, [search, activeFilter, open])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  useEffect(() => {
    if (!open) {
      setSearch('')
      return
    }
    const updatePosition = () => {
      const el = containerRef.current
      if (!el) return
      const trigRect = el.getBoundingClientRect()
      const boundsEl = el.closest('[data-picker-bounds]')
      const boundsRect = boundsEl ? boundsEl.getBoundingClientRect() : null
      const bLeft = boundsRect ? boundsRect.left : 12
      const bRight = boundsRect ? boundsRect.right : window.innerWidth - 12
      const availW = Math.max(240, bRight - bLeft)
      const width = Math.min(390, availW)
      let targetLeft = trigRect.left
      if (targetLeft + width > bRight) targetLeft = bRight - width
      if (targetLeft < bLeft) targetLeft = bLeft
      setPopoverBox({ left: Math.round(targetLeft - trigRect.left), width: Math.round(width) })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    const tId = window.setTimeout(() => searchInputRef.current?.focus(), 20)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.clearTimeout(tId)
    }
  }, [open])

  const togglePin = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev]
      savePinnedModels(next)
      return next
    })
  }

  const selectModel = (modelId: string) => {
    onChange(modelId || 'auto')
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (!flatSelectable.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx((i) => (i + 1) % flatSelectable.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx((i) => (i - 1 + flatSelectable.length) % flatSelectable.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = flatSelectable[highlightIdx]
      if (target !== undefined) selectModel(target)
    }
  }

  const effectiveVal = value && value !== 'auto' ? value : ''
  const currentParsed = useMemo(
    () => (effectiveVal ? parseModelItem(effectiveVal, combos) : null),
    [effectiveVal, combos],
  )

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={
          currentParsed
            ? `${currentParsed.provider.label}: ${currentParsed.id}`
            : `Model: Auto${defaultLabel ? ` (${defaultLabel})` : ''}`
        }
        className={`h-7 px-2 rounded-lg text-[11px] flex items-center gap-1.5 min-w-0 max-w-[205px] transition-colors border ${
          open
            ? 'bg-muted text-foreground border-ring'
            : currentParsed
              ? 'bg-foreground/[0.04] text-foreground border-border hover:border-ring'
              : 'text-muted-foreground border-transparent hover:bg-muted hover:text-foreground'
        }`}
      >
        {currentParsed ? (
          <>
            <ProviderBadge prefix={currentParsed.prefix} meta={currentParsed.provider} />
            <span className="font-mono text-[10px] px-1 py-px rounded bg-muted text-muted-foreground shrink-0">
              {currentParsed.prefix}
            </span>
            <span className={`truncate font-mono text-[11px] ${currentParsed.isProviderAuto ? 'text-emerald-500 font-semibold' : ''}`}>
              {currentParsed.isProviderAuto ? 'auto' : currentParsed.cleanName}
            </span>
          </>
        ) : (
          <>
            <Sparkles className="w-3 h-3 shrink-0 text-emerald-500" />
            <span className="truncate font-medium">
              {placeholderLabel || `Auto${defaultLabel ? ` · ${defaultLabel.split('/').slice(1).join('/')}` : ''}`}
            </span>
          </>
        )}
        <ChevronDown className={`w-3 h-3 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          onKeyDown={handleKeyDown}
          style={{ left: popoverBox.left, width: popoverBox.width, animation: 'agent-pop-in 150ms ease-out' }}
          className={`absolute z-50 ${
            placement === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'
          } rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col`}
        >
          {/* Search Bar */}
          <div className="p-2.5 border-b border-border bg-background/70 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-1" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models, providers, or tags (free, coding, fast)…"
              className="w-full bg-transparent text-xs text-foreground placeholder-muted-foreground outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-muted shrink-0">
              {filteredItems.length}
            </span>
          </div>

          {/* Horizontal Provider Filter Pills */}
          {providerTabs.length > 1 && (
            <div className="flex items-center gap-1 px-2.5 py-1.5 border-b border-border bg-background/40 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setActiveFilter('all')}
                className={`px-2 py-1 rounded-lg text-[10px] font-medium shrink-0 transition-colors ${
                  activeFilter === 'all'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                All ({items.length})
              </button>

              {pinnedItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveFilter('pinned')}
                  className={`px-2 py-1 rounded-lg text-[10px] font-medium shrink-0 flex items-center gap-1 transition-colors ${
                    activeFilter === 'pinned'
                      ? 'bg-amber-500 text-black font-semibold'
                      : 'text-amber-500 bg-amber-500/10 hover:bg-amber-500/20'
                  }`}
                >
                  <Star className="w-2.5 h-2.5 fill-current" />
                  {pinnedItems.length}
                </button>
              )}

              {providerTabs.map((tab) => {
                const active = activeFilter === tab.prefix
                return (
                  <button
                    key={tab.prefix}
                    type="button"
                    onClick={() => setActiveFilter(active ? 'all' : tab.prefix)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-medium shrink-0 flex items-center gap-1.5 transition-colors border ${
                      active
                        ? 'bg-foreground text-background border-transparent'
                        : 'border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    }`}
                  >
                    <span className="font-mono text-[9px] uppercase">{tab.prefix}</span>
                    <span>{tab.meta.shortLabel}</span>
                    <span className="opacity-60 font-mono text-[9px]">{tab.count}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Grouped List */}
          <div role="listbox" className="max-h-72 overflow-y-auto divide-y divide-border/40">
            {activeFilter === 'all' && !search.trim() && (
              <div className="p-1.5">
                <button
                  type="button"
                  role="option"
                  aria-selected={!effectiveVal}
                  onClick={() => selectModel('auto')}
                  className={`w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-2 transition-colors ${
                    !effectiveVal || flatSelectable[highlightIdx] === 'auto'
                      ? 'bg-emerald-500/10 text-foreground border border-emerald-500/30'
                      : 'hover:bg-muted/60 text-foreground border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                      <Sparkles className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold flex items-center gap-1.5">
                        <span>Auto</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          SMART FALLBACK
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        Automatically routes across connected accounts &amp; API keys
                      </div>
                    </div>
                  </div>
                  {!effectiveVal && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                </button>
              </div>
            )}

            {activeFilter === 'all' && !search.trim() && pinnedItems.length > 0 && (
              <div className="py-1">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-500 flex items-center gap-1 bg-background/60 sticky top-0 backdrop-blur-sm z-10">
                  <Star className="w-2.5 h-2.5 fill-current" /> Pinned Models
                </div>
                <div className="px-1.5 space-y-0.5">
                  {pinnedItems.map((it) => (
                    <ModelOptionRow
                      key={`pin-${it.id}`}
                      item={it}
                      selected={effectiveVal === it.id}
                      highlighted={flatSelectable[highlightIdx] === it.id}
                      isPinned={true}
                      onSelect={() => selectModel(it.id)}
                      onTogglePin={(e) => togglePin(e, it.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {groupedSections.length === 0 ? (
              <div className="py-8 px-4 text-center space-y-1">
                <div className="text-xs font-medium text-foreground">No matching models</div>
                <div className="text-[11px] text-muted-foreground">
                  Try another keyword or clear the provider filter.
                </div>
              </div>
            ) : (
              groupedSections.map((group) => (
                <div key={group.key} className="py-1">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between bg-background/80 sticky top-0 backdrop-blur-sm z-10">
                    <span className="flex items-center gap-1.5">
                      <Layers className="w-3 h-3" />
                      <span>{group.title}</span>
                      <code className="font-mono text-[9px] px-1 rounded bg-muted text-foreground lowercase">
                        {group.prefix}/
                      </code>
                    </span>
                    <span className="font-mono text-[9px]">{group.list.length}</span>
                  </div>
                  <div className="px-1.5 space-y-0.5">
                    {group.list.map((it) => (
                      <ModelOptionRow
                        key={it.id}
                        item={it}
                        selected={effectiveVal === it.id}
                        highlighted={flatSelectable[highlightIdx] === it.id}
                        isPinned={pinned.includes(it.id)}
                        onSelect={() => selectModel(it.id)}
                        onTogglePin={(e) => togglePin(e, it.id)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="px-3 py-1.5 border-t border-border bg-background/70 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <span>↑↓ Navigate</span>
              <span>↵ Select</span>
              <span>★ Pin</span>
            </span>
            {onManageProviders ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onManageProviders()
                }}
                className="hover:text-foreground underline underline-offset-2"
              >
                Manage Providers
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function ModelOptionRow({
  item,
  selected,
  highlighted,
  isPinned,
  onSelect,
  onTogglePin,
}: {
  item: ParsedModelItem
  selected: boolean
  highlighted: boolean
  isPinned: boolean
  onSelect: () => void
  onTogglePin: (e: React.MouseEvent) => void
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={`group flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
        selected
          ? 'bg-foreground/[0.08] text-foreground font-medium'
          : highlighted
            ? 'bg-muted/70 text-foreground'
            : item.isProviderAuto
              ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.09] text-foreground border border-emerald-500/20'
              : 'hover:bg-muted/50 text-foreground'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <ProviderBadge prefix={item.prefix} meta={item.provider} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-[11.5px] truncate">{item.cleanName}</span>
            {item.subVendor && (
              <span className="text-[9px] font-mono px-1 rounded bg-muted text-muted-foreground shrink-0">
                {item.subVendor}
              </span>
            )}
            {item.tags.map((tag) => (
              <TagPill key={tag} tag={tag} />
            ))}
          </div>
          {item.subtitle && (
            <div className="text-[10px] font-mono text-muted-foreground truncate">{item.subtitle}</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[9px] font-mono text-muted-foreground opacity-70 group-hover:opacity-100">
          {item.prefix}/
        </span>
        <button
          type="button"
          onClick={onTogglePin}
          title={isPinned ? 'Unpin model' : 'Pin model to top'}
          className={`p-1 rounded hover:bg-background transition-opacity ${
            isPinned ? 'text-amber-400 opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-70 hover:!opacity-100'
          }`}
        >
          <Star className={`w-3 h-3 ${isPinned ? 'fill-current' : ''}`} />
        </button>
        {selected && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
      </div>
    </div>
  )
}

function TagPill({ tag }: { tag: ModelTag }) {
  if (tag === 'AUTO') {
    return (
      <span className="text-[8.5px] font-mono font-semibold px-1.5 py-px rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 flex items-center gap-0.5 shrink-0">
        <Sparkles className="w-2.5 h-2.5" /> PER-PROVIDER
      </span>
    )
  }
  if (tag === 'FREE') {
    return (
      <span className="text-[8.5px] font-mono font-semibold px-1 py-px rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
        FREE
      </span>
    )
  }
  if (tag === 'REASONING') {
    return (
      <span className="text-[8.5px] font-mono px-1 py-px rounded bg-purple-500/15 text-purple-400 border border-purple-500/30 flex items-center gap-0.5 shrink-0">
        <Brain className="w-2.5 h-2.5" /> THINK
      </span>
    )
  }
  if (tag === 'CODING') {
    return (
      <span className="text-[8.5px] font-mono px-1 py-px rounded bg-sky-500/15 text-sky-400 border border-sky-500/30 flex items-center gap-0.5 shrink-0">
        <Code2 className="w-2.5 h-2.5" /> CODE
      </span>
    )
  }
  return (
    <span className="text-[8.5px] font-mono px-1 py-px rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-0.5 shrink-0">
      <Zap className="w-2.5 h-2.5" /> FAST
    </span>
  )
}

