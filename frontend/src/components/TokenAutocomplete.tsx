import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DYNAMIC_HELPERS, applyToken, findOpenToken } from '../lib/templateTokens'

type Field = HTMLInputElement | HTMLTextAreaElement

interface Suggestion { token: string; label: string; kind: 'variable' | 'generator' }

interface Props {
  variables: Record<string, unknown>
}

const TEXT_TYPES = new Set(['text', 'search', 'url', 'password', ''])

function isField(el: EventTarget | null): el is Field {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly
  return el instanceof HTMLInputElement && TEXT_TYPES.has(el.type) && !el.readOnly
}

// Set the value the way a keystroke would, so React's onChange sees it.
function setNativeValue(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Typing `{{` in any text field opens a list of environment variables and
 * dynamic generators. Mounted once; no per-field wiring. Opt a field out with
 * `data-no-token-complete`.
 */
export function TokenAutocomplete({ variables }: Props) {
  const [field, setField] = useState<Field | null>(null)
  const [open, setOpen] = useState<{ start: number; query: string } | null>(null)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<Field | null>(null)
  fieldRef.current = field

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!open) return []
    const q = open.query.toLowerCase()
    const vars: Suggestion[] = Object.keys(variables || {}).sort().map((name) => ({ token: `{{${name}}}`, label: 'Environment variable', kind: 'variable' }))
    const gens: Suggestion[] = DYNAMIC_HELPERS.map((h) => ({ token: h.token, label: h.label, kind: 'generator' }))
    const name = (s: Suggestion) => s.token.slice(2).toLowerCase()
    // Names that start with the typed text first (both `nam` → `name…` and `random_nam…`), then other matches.
    const rank = (s: Suggestion) => (name(s).startsWith(q) || name(s).startsWith(`random_${q}`) ? 0 : 1)
    return [...vars, ...gens].filter((s) => name(s).includes(q)).sort((a, b) => rank(a) - rank(b)).slice(0, 12)
  }, [open, variables])

  const close = () => { setOpen(null); setField(null) }

  const pick = (s: Suggestion) => {
    if (!field || !open) return
    const caret = field.selectionStart ?? field.value.length
    const next = applyToken(field.value, open.start, caret, s.token)
    setNativeValue(field, next.text)
    const target = field
    requestAnimationFrame(() => { target.focus(); target.setSelectionRange(next.caret, next.caret) })
    close()
  }

  useEffect(() => {
    const onInput = (e: Event) => {
      const el = e.target
      if (!isField(el) || el.closest('[data-no-token-complete]')) return
      const found = findOpenToken(el.value, el.selectionStart ?? el.value.length)
      if (found) { setField(el); setOpen(found); setActive(0) } else close()
    }
    const onBlur = (e: FocusEvent) => {
      // Only the field that owns the list closes it; let a click on the list land first.
      const blurred = e.target
      if (blurred !== fieldRef.current || listRef.current?.contains(e.relatedTarget as Node)) return
      setTimeout(() => { if (fieldRef.current === blurred && document.activeElement !== blurred) close() }, 120)
    }
    document.addEventListener('input', onInput, true)
    document.addEventListener('focusout', onBlur, true)
    return () => {
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('focusout', onBlur, true)
    }
  }, [])

  useEffect(() => {
    if (!open || !suggestions.length) return
    // Capture phase so editors' own Tab/Enter handlers don't also fire.
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== field) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation()
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation()
        pick(suggestions[active])
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  })

  if (!field || !open || !suggestions.length) return null
  // shortcut: anchored under the field, not the caret; upgrade if long textareas make it feel far away.
  const rect = field.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom > 260
  // Modal dialogs block pointer events outside themselves, and their transform
  // makes `fixed` relative to the dialog, so render inside it and offset by it.
  const host = (field.closest('[role="dialog"]') as HTMLElement | null) || document.body
  const origin = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect()
  return createPortal(
    <div
      ref={listRef}
      role="listbox"
      aria-label="Insert variable or generator"
      className="fixed z-[100] w-72 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      style={{
        left: Math.min(rect.left, window.innerWidth - 296) - origin.left,
        top: below ? rect.bottom + 4 - origin.top : undefined,
        bottom: below ? undefined : (host === document.body ? window.innerHeight : origin.top + host.offsetHeight) - rect.top + 4,
      }}
    >
      <div className="max-h-60 overflow-y-auto py-1">
        {suggestions.map((s, i) => (
          <button
            key={s.token}
            type="button"
            role="option"
            aria-selected={i === active}
            tabIndex={-1}
            onMouseDown={(e) => { e.preventDefault(); pick(s) }}
            onMouseEnter={() => setActive(i)}
            className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left ${i === active ? 'bg-accent' : ''}`}
          >
            <span className="truncate font-mono text-[11px]">{s.token}</span>
            <span className={`shrink-0 text-[9px] ${s.kind === 'variable' ? 'text-emerald-600 dark:text-emerald-400' : 'text-cyan-600 dark:text-cyan-400'}`}>{s.label}</span>
          </button>
        ))}
      </div>
      <div className="border-t border-border px-2.5 py-1 text-[9px] text-muted-foreground">↑↓ to move · Enter to insert · Esc to close</div>
    </div>,
    host,
  )
}
