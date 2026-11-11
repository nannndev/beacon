import React, { useRef, useState } from 'react'
import { Check, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { Button } from '../ui/button'
import type { AgentCustomSkill, AgentPreferences } from '../../types'
import { AGENT_GUIDES, DEFAULT_AGENT_PREFERENCES, parseSkillMarkdown } from '../../lib/agentApi'

interface Props {
  value: AgentPreferences
  projectId: string | null
  projectName: string | null
  onSave: (p: AgentPreferences) => void
  onClose: () => void
}

const Seg = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
  label: string
}) => (
  <div role="radiogroup" aria-label={label} className="flex w-full rounded-lg border border-border p-0.5 bg-background">
    {options.map(([v, text]) => (
      <button
        key={v}
        type="button"
        role="radio"
        aria-checked={value === v}
        onClick={() => onChange(v)}
        className={`flex-1 px-2 py-1 rounded-md text-[11px] whitespace-nowrap transition-colors cursor-pointer ${
          value === v ? 'btn-metal' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {text}
      </button>
    ))}
  </div>
)

export function AgentSettings({ value, projectId, projectName, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<AgentPreferences>({ ...value, skills: value.skills || [] })
  const [addingSkill, setAddingSkill] = useState(false)
  const [skillName, setSkillName] = useState('')
  const [skillTriggers, setSkillTriggers] = useState('')
  const [skillContent, setSkillContent] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const note = projectId ? draft.projectNotes[projectId] || '' : ''
  const dirty = JSON.stringify(draft) !== JSON.stringify({ ...value, skills: value.skills || [] })
  const set = (patch: Partial<AgentPreferences>) => setDraft((d) => ({ ...d, ...patch }))
  const toggleGuide = (id: string) =>
    set({
      guides: draft.guides.includes(id) ? draft.guides.filter((g) => g !== id) : [...draft.guides, id],
    })

  const handleSkillContentChange = (raw: string) => {
    if (raw.trim().startsWith('---')) {
      const parsed = parseSkillMarkdown(raw)
      if (parsed.name && !skillName.trim()) setSkillName(parsed.name)
      if (parsed.triggers && !skillTriggers.trim()) setSkillTriggers(parsed.triggers)
      setSkillContent(parsed.content)
      return
    }
    setSkillContent(raw)
  }

  const handleAddSkill = () => {
    const parsed = parseSkillMarkdown(skillContent)
    const finalName = (skillName.trim() || parsed.name || 'custom-skill').slice(0, 80)
    const finalTriggers = (skillTriggers.trim() || parsed.triggers || '').slice(0, 200)
    const finalContent = (parsed.content || skillContent).trim().slice(0, 4000)
    if (!finalContent) return
    const nextSkill: AgentCustomSkill = {
      id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: finalName,
      triggers: finalTriggers,
      content: finalContent,
      enabled: true,
    }
    set({ skills: [...(draft.skills || []), nextSkill] })
    setSkillName('')
    setSkillTriggers('')
    setSkillContent('')
    setAddingSkill(false)
  }

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const parsed = parseSkillMarkdown(text, file.name)
    const nextSkill: AgentCustomSkill = {
      id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: parsed.name.slice(0, 80),
      triggers: parsed.triggers,
      content: parsed.content.slice(0, 4000),
      enabled: true,
    }
    set({ skills: [...(draft.skills || []), nextSkill] })
    e.target.value = ''
  }

  return (
    <div style={{ animation: 'agent-expand-in 220ms ease-out' }} className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Agent Skills &amp; Preferences</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Customize tone, workflow guides, project notes, and custom SKILL.md playbooks.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} title="Close" className="h-8 w-8 shrink-0 text-muted-foreground">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <section className="space-y-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Style &amp; Execution</div>
          <div className="space-y-2">
            <div className="grid grid-cols-[76px_1fr] items-center gap-2.5">
              <span className="text-[11px] font-medium text-muted-foreground">Language</span>
              <Seg
                label="Language"
                value={draft.language}
                onChange={(language) => set({ language })}
                options={[
                  ['auto', 'Auto'],
                  ['id', 'Indonesia'],
                  ['en', 'English'],
                ]}
              />
            </div>
            <div className="grid grid-cols-[76px_1fr] items-center gap-2.5">
              <span className="text-[11px] font-medium text-muted-foreground">Length</span>
              <Seg
                label="Length"
                value={draft.style}
                onChange={(style) => set({ style })}
                options={[
                  ['concise', 'Concise'],
                  ['balanced', 'Balanced'],
                  ['detailed', 'Detailed'],
                ]}
              />
            </div>
            <div className="grid grid-cols-[76px_1fr] items-center gap-2.5">
              <span className="text-[11px] font-medium text-muted-foreground">Scope</span>
              <Seg
                label="Scope"
                value={draft.scope}
                onChange={(scope) => set({ scope })}
                options={[
                  ['global', 'Global (all projects)'],
                  ['workspace', 'This workspace only'],
                ]}
              />
            </div>
            <div className="grid grid-cols-[76px_1fr] items-center gap-2.5">
              <span className="text-[11px] font-medium text-muted-foreground">Max steps</span>
              <div className="flex items-center gap-1.5 min-w-0">
                <Seg
                  label="Max steps"
                  value={[6, 10, 20, 0].includes(draft.maxSteps) ? String(draft.maxSteps) : 'custom'}
                  onChange={(v) => {
                    if (v !== 'custom') set({ maxSteps: Number(v) })
                  }}
                  options={[
                    ['6', '6'],
                    ['10', '10'],
                    ['20', '20'],
                    ['0', 'Unlimited'],
                  ]}
                />
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={draft.maxSteps}
                  aria-label="Max steps (0 = unlimited)"
                  title="0 = unlimited"
                  onChange={(e) => {
                    const n = Math.max(0, Math.min(500, Math.floor(Number(e.target.value) || 0)))
                    set({ maxSteps: n })
                  }}
                  className="w-14 h-[29px] px-2 rounded-lg border border-border bg-background text-[11px] font-mono tabular-nums text-center text-foreground focus:outline-none focus:border-ring shrink-0"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Workflow Guides</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {AGENT_GUIDES.map((g, idx) => {
              const on = draft.guides.includes(g.id)
              const isOddLast = AGENT_GUIDES.length % 2 === 1 && idx === AGENT_GUIDES.length - 1
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGuide(g.id)}
                  aria-pressed={on}
                  className={`text-left p-3 rounded-xl border transition-colors flex flex-col justify-start cursor-pointer ${
                    isOddLast ? 'sm:col-span-2' : ''
                  } ${on ? 'border-ring bg-foreground/[0.06]' : 'border-border hover:border-ring'}`}
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <span
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                        on ? 'btn-metal border-transparent' : 'border-border'
                      }`}
                    >
                      {on && <Check className="w-2.5 h-2.5" />}
                    </span>
                    <span>{g.label}</span>
                  </div>
                  <div className="text-[10.5px] text-muted-foreground mt-1 pl-5 leading-snug">{g.description}</div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>Custom Skills (SKILL.md)</span>
              </div>
              <div className="text-[10.5px] text-muted-foreground mt-0.5 leading-snug">
                Injected automatically by trigger keyword or always-on when triggers are empty.
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <input ref={fileRef} type="file" accept=".md,.txt" className="hidden" onChange={handleUploadFile} />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="h-7 text-[11px] px-2">
                <Upload className="w-3 h-3 mr-1" /> .md
              </Button>
              {!addingSkill && (
                <Button variant="outline" size="sm" onClick={() => setAddingSkill(true)} className="h-7 text-[11px] px-2.5">
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              )}
            </div>
          </div>

          {addingSkill && (
            <div className="p-3.5 rounded-xl border border-ring bg-background space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-start">
                <div className="flex flex-col gap-1 min-w-0">
                  <label className="text-[10.5px] font-medium text-muted-foreground">Skill Name</label>
                  <input
                    type="text"
                    maxLength={80}
                    value={skillName}
                    onChange={(e) => setSkillName(e.target.value)}
                    placeholder="e.g. Payments Idempotency Check"
                    className="h-8 w-full rounded-lg bg-card border border-border px-2.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="flex flex-col gap-1 min-w-0">
                  <label className="text-[10.5px] font-medium text-muted-foreground">Trigger Keywords</label>
                  <input
                    type="text"
                    maxLength={200}
                    value={skillTriggers}
                    onChange={(e) => setSkillTriggers(e.target.value)}
                    placeholder="payment, webhook, stripe (optional)"
                    className="h-8 w-full rounded-lg bg-card border border-border px-2.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10.5px] font-medium text-muted-foreground">SKILL.md Content</label>
                <textarea
                  rows={5}
                  maxLength={4000}
                  value={skillContent}
                  onChange={(e) => handleSkillContentChange(e.target.value)}
                  placeholder="Paste markdown rules or frontmatter (---) + instructions…"
                  className="w-full resize-y rounded-lg bg-card border border-border p-2.5 text-xs font-mono text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
                    {skillContent.length}/4000
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" onClick={() => setAddingSkill(false)} className="h-7 text-[11px] px-2.5">
                      Cancel
                    </Button>
                    <Button size="sm" disabled={!skillContent.trim()} onClick={handleAddSkill} className="h-7 text-[11px] px-3 btn-metal">
                      Save Skill
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(draft.skills || []).length > 0 && (
            <div className="space-y-2">
              {(draft.skills || []).map((s) => (
                <div
                  key={s.id}
                  className={`flex items-start justify-between gap-2.5 p-3 rounded-xl border transition-colors ${
                    s.enabled ? 'border-ring bg-foreground/[0.04]' : 'border-border opacity-60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      set({
                        skills: (draft.skills || []).map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)),
                      })
                    }
                    className="flex-1 text-left min-w-0 cursor-pointer"
                  >
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground flex-wrap">
                      <span
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                          s.enabled ? 'btn-metal border-transparent' : 'border-border'
                        }`}
                      >
                        {s.enabled && <Check className="w-2.5 h-2.5" />}
                      </span>
                      <span className="truncate font-mono">{s.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-background border border-border text-muted-foreground">
                        {s.triggers?.trim() ? s.triggers : 'Always active'}
                      </span>
                    </div>
                    <div className="text-[10.5px] text-muted-foreground mt-1 pl-5.5 line-clamp-2 font-mono">{s.content}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => set({ skills: (draft.skills || []).filter((x) => x.id !== s.id) })}
                    className="p-1 text-muted-foreground hover:text-destructive shrink-0"
                    title="Delete skill"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {projectId && (
          <section className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Project Notes · <span className="text-foreground normal-case">{projectName}</span>
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) =>
                set({ projectNotes: { ...draft.projectNotes, [projectId]: e.target.value } })
              }
              placeholder="Auth token format, rate-limit thresholds, staging endpoints, domain rules…"
              className="w-full rounded-xl bg-background border border-border p-2.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </section>
        )}

        <section className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
            Global Custom Instructions
          </label>
          <textarea
            rows={3}
            value={draft.custom}
            onChange={(e) => set({ custom: e.target.value })}
            placeholder="Instructions active across every project and session…"
            className="w-full rounded-xl bg-background border border-border p-2.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </section>

        <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>Secrets and HTTP tokens remain masked in reads and untrusted HTTP responses are fenced automatically.</span>
        </div>
      </div>

      {/* Footer matching 7Server AgentSettings */}
      <div className="p-3 border-t border-border bg-background/70 flex items-center justify-between gap-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDraft({ ...DEFAULT_AGENT_PREFERENCES })}
          className="h-8 text-xs text-muted-foreground"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!dirty}
            onClick={() => onSave(draft)}
            className="h-8 text-xs px-3.5 btn-metal"
          >
            Save Preferences
          </Button>
        </div>
      </div>
    </div>
  )
}

