// Client-side mirrors of the backend generators (core/templating.py `generate`)
// purely to show an illustrative sample — the real value is generated per request.
const _rand = (n: number) =>
  Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
const _uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
const _digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
const _pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)]

export interface DynamicHelper { token: string; label: string; sample: () => string }
export const DYNAMIC_HELPERS: DynamicHelper[] = [
  { token: '{{random_email}}', label: 'Random email', sample: () => `test${_digits(7)}@mail.test` },
  { token: '{{random_name}}', label: 'Random full name', sample: () => `${_pick(['Andi', 'Citra', 'Dewi', 'Sam'])} ${_pick(['Wijaya', 'Pratama', 'Lee'])}` },
  { token: '{{random_phone}}', label: 'Phone (+62)', sample: () => `+62812${_digits(8)}` },
  { token: '{{uuid}}', label: 'UUID v4', sample: _uuid },
  { token: '{{timestamp}}', label: 'Unix milliseconds', sample: () => String(Date.now()) },
  { token: '{{iso_date}}', label: 'UTC date-time (ISO 8601)', sample: () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') },
  { token: '{{random_bool}}', label: 'true or false', sample: () => _pick(['true', 'false']) },
  { token: '{{random_choice:a|b|c}}', label: 'One of the listed options', sample: () => _pick(['a', 'b', 'c']) },
  { token: '{{random_string:12}}', label: 'Random string · N chars', sample: () => _rand(12) },
  { token: '{{random_int:1:100}}', label: 'Random int · min:max', sample: () => String(1 + Math.floor(Math.random() * 100)) },
  { token: '{{random_number}}', label: 'Random number', sample: () => String(100000 + Math.floor(Math.random() * 900000)) },
]

/** Generator names (without parameters), e.g. `random_int` for `{{random_int:1:100}}`. */
export const isGeneratorName = (name: string) =>
  name.split(':')[0] === 'random_uuid' ||
  DYNAMIC_HELPERS.some((helper) => helper.token.slice(2, -2).split(':')[0] === name.split(':')[0])

/** An unclosed `{{partial` that ends at the caret, or null. */
export function findOpenToken(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const start = before.lastIndexOf('{{')
  if (start < 0) return null
  const query = before.slice(start + 2)
  if (/[{}\s"]/.test(query)) return null
  return { start, query }
}

/** Replace `{{partial` (plus a `}}` already right after the caret) with `token`. */
export function applyToken(text: string, start: number, caret: number, token: string): { text: string; caret: number } {
  const after = text.slice(caret).startsWith('}}') ? text.slice(caret + 2) : text.slice(caret)
  const next = text.slice(0, start) + token + after
  return { text: next, caret: start + token.length }
}
