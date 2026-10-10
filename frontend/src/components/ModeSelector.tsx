import { useState } from 'react'
import { ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react'
import { TestMode, ModeInfo, MODE_INFO } from '../types/testModes'

interface Props {
  selected: TestMode
  onChange: (mode: TestMode) => void
}

const colorMap: Record<string, { ring: string; bg: string; text: string; badge: string }> = {
  emerald: { ring: 'ring-emerald-500', bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', badge: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' },
  blue:    { ring: 'ring-blue-500',    bg: 'bg-blue-500/10',    text: 'text-blue-600 dark:text-blue-400',       badge: 'bg-blue-500/20 text-blue-600 dark:text-blue-400'       },
  orange:  { ring: 'ring-orange-500',  bg: 'bg-orange-500/10',  text: 'text-orange-600 dark:text-orange-400',   badge: 'bg-orange-500/20 text-orange-600 dark:text-orange-400' },
  violet:  { ring: 'ring-violet-500',  bg: 'bg-violet-500/10',  text: 'text-violet-600 dark:text-violet-400',   badge: 'bg-violet-500/20 text-violet-600 dark:text-violet-400' },
  amber:   { ring: 'ring-amber-500',   bg: 'bg-amber-500/10',   text: 'text-amber-600 dark:text-amber-400',     badge: 'bg-amber-500/20 text-amber-600 dark:text-amber-400'    },
  rose:    { ring: 'ring-rose-500',    bg: 'bg-rose-500/10',    text: 'text-rose-600 dark:text-rose-400',       badge: 'bg-rose-500/20 text-rose-600 dark:text-rose-400'       },
  cyan:    { ring: 'ring-cyan-500',    bg: 'bg-cyan-500/10',    text: 'text-cyan-600 dark:text-cyan-400',       badge: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400'       },
  indigo:  { ring: 'ring-indigo-500',  bg: 'bg-indigo-500/10',  text: 'text-indigo-600 dark:text-indigo-400',  badge: 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' },
  teal:    { ring: 'ring-teal-500',    bg: 'bg-teal-500/10',    text: 'text-teal-600 dark:text-teal-400',       badge: 'bg-teal-500/20 text-teal-600 dark:text-teal-400'       },
}

function ModeCard({ info, active, onClick }: { info: ModeInfo; active: boolean; onClick: () => void }) {
  const c = colorMap[info.color] ?? colorMap['emerald']
  const Icon = info.icon
  return (
    <button
      onClick={onClick}
      className={`relative w-full text-left p-2.5 rounded-lg border transition-all duration-150 ${
        active
          ? `${c.ring} ring-1 ${c.bg} border-transparent`
          : 'border-border bg-muted/30 hover:bg-muted/60 hover:border-border/80'
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${active ? c.text : 'text-muted-foreground'}`} aria-hidden="true" />
        <div className="min-w-0">
          <div className={`text-xs font-semibold leading-tight ${active ? c.text : ''}`}>{info.label}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{info.tagline}</div>
        </div>
        {info.danger && (
          <TriangleAlert className="ml-auto shrink-0 h-3 w-3 text-red-500" aria-label="Use only on systems you are authorized to test" />
        )}
      </div>
    </button>
  )
}

export function ModeSelector({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const current = MODE_INFO.find((m) => m.id === selected)!
  const c = colorMap[current.color] ?? colorMap['emerald']
  const CurrentIcon = current.icon
  const Chevron = open ? ChevronUp : ChevronDown

  return (
    <div>
      {/* Collapsed trigger */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Test Mode</span>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border transition-colors ${c.bg} ${c.text} border-transparent ring-1 ${c.ring}`}
        >
          <CurrentIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{current.label}</span>
          <Chevron className="h-3 w-3 opacity-60 ml-0.5" aria-hidden="true" />
        </button>
        <span className="text-[10px] text-muted-foreground">{current.tagline}</span>
      </div>

      {/* Expanded grid */}
      {open && (
        <div className="mb-3">
          <div className="grid grid-cols-3 lg:grid-cols-5 gap-1.5 mb-2">
            {MODE_INFO.map((info) => (
              <ModeCard
                key={info.id}
                info={info}
                active={selected === info.id}
                onClick={() => { onChange(info.id); setOpen(false) }}
              />
            ))}
          </div>
          {/* Description of selected mode */}
          <div className={`flex items-start gap-2 text-[11px] px-3 py-2 rounded-md ${c.bg} ${c.text} border border-current/20`}>
            <CurrentIcon className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <strong>{current.label}:</strong> {current.description}
              {current.danger && (
                <span className="ml-1 inline-flex items-center gap-1 text-red-500 font-semibold">
                  <TriangleAlert className="h-3 w-3" aria-hidden="true" /> Use only on systems you own / have permission to test.
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
