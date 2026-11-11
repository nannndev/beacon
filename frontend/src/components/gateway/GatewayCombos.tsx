import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, Copy, Layers, Play, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { toast } from '../ui/toast'
import { api } from '../../lib/api'
import { AgentModelPicker } from '../agent/AgentModelPicker'
import { ProviderLogo } from './ProviderLogo'

interface GatewayCombosProps {
  combos: Record<string, string[]>
  models: string[]
  onChanged: (next: Record<string, string[]>) => void
  onTestInPlayground?: (comboModel: string) => void
}

export function GatewayCombos({ combos, models, onChanged, onTestInPlayground }: GatewayCombosProps) {
  const [name, setName] = useState('')
  const [targets, setTargets] = useState<string[]>([])
  const [manualTarget, setManualTarget] = useState('')
  const [showBuilder, setShowBuilder] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copiedCombo, setCopiedCombo] = useState<string | null>(null)

  const selectableModels = models.filter((m) => !m.startsWith('auto/'))
  const availableOptions = selectableModels.filter((m) => !targets.includes(m))

  const addTarget = (modelId: string) => {
    const clean = modelId.trim()
    if (!clean || clean === 'auto' || targets.includes(clean)) return
    setTargets((prev) => [...prev, clean])
  }

  const move = (index: number, delta: -1 | 1) => {
    setTargets((prev) => {
      const targetIdx = index + delta
      if (targetIdx < 0 || targetIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[targetIdx]] = [next[targetIdx], next[index]]
      return next
    })
  }

  const save = async () => {
    const cleanName = name.trim().replace(/^auto\//i, '')
    if (!cleanName || targets.length === 0) return
    setSaving(true)
    try {
      const res = await api.gatewaySaveCombo(cleanName, targets)
      onChanged(res.combos)
      toast.success(`Saved auto/${cleanName}`)
      setName('')
      setTargets([])
      setManualTarget('')
      setShowBuilder(false)
    } catch (e: any) {
      toast.error(e?.message || 'Could not save combo')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (comboName: string) => {
    try {
      const res = await api.gatewayDeleteCombo(comboName)
      onChanged(res.combos)
      toast.success(`Removed auto/${comboName}`)
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete combo')
    }
  }

  const copyId = async (comboName: string) => {
    const id = `auto/${comboName}`
    try {
      await navigator.clipboard.writeText(id)
      setCopiedCombo(comboName)
      toast.success(`Copied ${id}`)
      window.setTimeout(() => setCopiedCombo((p) => (p === comboName ? null : p)), 1500)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const editExisting = (comboName: string, list: string[]) => {
    setName(comboName)
    setTargets(list)
    setShowBuilder(true)
  }

  const entries = Object.entries(combos)

  return (
    <Card className="p-4 space-y-3" data-picker-bounds>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/25 text-violet-500 flex items-center justify-center shrink-0">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Fallback Combos</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {entries.length}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              Call <code className="rounded bg-muted px-1 font-mono">auto/&lt;name&gt;</code> — tries each model in priority order on 429, 401, 403, or 5xx.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={showBuilder ? 'ghost' : 'outline'}
          className="h-8 gap-1.5 shrink-0 text-xs"
          onClick={() => setShowBuilder((v) => !v)}
        >
          {showBuilder ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showBuilder ? 'Close' : 'New combo'}
        </Button>
      </div>

      {entries.length === 0 && !showBuilder ? (
        <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          No combos yet. Create one like <code className="rounded bg-muted px-1 font-mono">auto/fast</code> or{' '}
          <code className="rounded bg-muted px-1 font-mono">auto/coding</code> to automatically fall back across providers.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {entries.map(([comboName, list]) => (
            <div key={comboName} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs bg-card hover:bg-muted/25 transition-colors">
              <button
                type="button"
                onClick={() => void copyId(comboName)}
                className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-mono font-semibold text-violet-600 dark:text-violet-300 hover:bg-violet-500/20 transition-colors"
                title="Click to copy auto/ combo model ID"
              >
                <span>auto/{comboName}</span>
                {copiedCombo === comboName ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 opacity-70" />}
              </button>

              <div className="flex items-center flex-wrap gap-1 min-w-0 flex-1">
                {list.map((target, idx) => (
                  <span key={`${comboName}-${idx}`} className="inline-flex items-center gap-1">
                    {idx > 0 && <span className="text-muted-foreground text-[10px]">→</span>}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-foreground inline-flex items-center gap-1">
                      <ProviderLogo provider={target.split('/')[0]} size="xs" />
                      <span>{target}</span>
                    </code>
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-1 ml-auto shrink-0">
                {onTestInPlayground && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] gap-1"
                    onClick={() => onTestInPlayground(`auto/${comboName}`)}
                    title="Test combo in Playground"
                  >
                    <Play className="w-3 h-3" /> Test
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => editExisting(comboName, list)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-red-500 hover:text-red-400"
                  aria-label={`Delete combo ${comboName}`}
                  onClick={() => void remove(comboName)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showBuilder && (
        <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
            <div>
              <label className="text-[10.5px] font-medium text-muted-foreground block mb-1">
                Combo name (called as <code className="font-mono">auto/&lt;name&gt;</code>)
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. fast, coding, smart"
                className="h-8 font-mono text-xs"
                aria-label="Combo name"
                data-no-token-complete
              />
            </div>

            <div>
              <label className="text-[10.5px] font-medium text-muted-foreground block mb-1">
                Add target model (from connected providers & accounts)
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <AgentModelPicker
                  value=""
                  onChange={(val) => {
                    if (val && val !== 'auto') addTarget(val)
                  }}
                  options={availableOptions}
                  placement="bottom"
                  placeholderLabel="Pick connected model…"
                />
                <div className="flex items-center gap-1 flex-1 min-w-[160px]">
                  <Input
                    value={manualTarget}
                    onChange={(e) => setManualTarget(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addTarget(manualTarget)
                        setManualTarget('')
                      }
                    }}
                    list="gateway-combo-models"
                    placeholder="or type alias/model & press Enter"
                    className="h-8 font-mono text-xs"
                    aria-label="Combo targets"
                    data-no-token-complete
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2"
                    type="button"
                    disabled={!manualTarget.trim()}
                    onClick={() => {
                      addTarget(manualTarget)
                      setManualTarget('')
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <datalist id="gateway-combo-models">
                {availableOptions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>

          {targets.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10.5px] font-medium text-muted-foreground">
                Priority fallback order ({targets.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {targets.map((target, idx) => (
                  <div
                    key={target}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-mono"
                  >
                    <span className="text-[10px] text-muted-foreground">#{idx + 1}</span>
                    <span>{target}</span>
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => move(idx, -1)}
                      className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                      title="Move higher priority"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === targets.length - 1}
                      onClick={() => move(idx, 1)}
                      className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                      title="Move lower priority"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargets((prev) => prev.filter((t) => t !== target))}
                      className="p-0.5 rounded hover:bg-red-500/15 text-red-500"
                      title="Remove target"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setShowBuilder(false)
                setName('')
                setTargets([])
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={saving || !name.trim() || targets.length === 0}
              onClick={() => void save()}
            >
              Save combo
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

