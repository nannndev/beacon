import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"

export type ToastType = "success" | "error" | "info" | "warning"

interface Toast {
  id: number
  message: string
  type: ToastType
  /** Optional second line (error detail, file name, next step). */
  detail?: string
  leaving?: boolean
}

interface ToastOptions {
  detail?: string
  /** ms before auto-dismiss; errors default longer so they can be read. */
  duration?: number
}

let toasts: Toast[] = []
let listeners: Array<() => void> = []
let counter = 0
const timers = new Map<number, number>()

const DEFAULT_MS: Record<ToastType, number> = { success: 3200, info: 3600, warning: 5000, error: 6500 }
const EXIT_MS = 180
const MAX_VISIBLE = 4

function emit() {
  listeners.forEach((l) => l())
}

function dismiss(id: number) {
  const t = timers.get(id)
  if (t) window.clearTimeout(t)
  timers.delete(id)
  toasts = toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x))
  emit()
  window.setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id)
    emit()
  }, EXIT_MS)
}

/** Show a transient toast notification. Identical consecutive messages collapse into one. */
export function toast(message: string, type: ToastType = "info", opts: ToastOptions = {}) {
  const dup = toasts.find((t) => !t.leaving && t.message === message && t.type === type && t.detail === opts.detail)
  if (dup) {
    const old = timers.get(dup.id)
    if (old) window.clearTimeout(old)
    timers.set(dup.id, window.setTimeout(() => dismiss(dup.id), opts.duration ?? DEFAULT_MS[type]))
    return dup.id
  }
  const id = ++counter
  toasts = [...toasts, { id, message, type, detail: opts.detail }]
  // Oldest non-error toasts make room so the stack never covers the screen.
  const visible = toasts.filter((t) => !t.leaving)
  if (visible.length > MAX_VISIBLE) {
    const victim = visible.find((t) => t.type !== "error") ?? visible[0]
    dismiss(victim.id)
  }
  emit()
  timers.set(id, window.setTimeout(() => dismiss(id), opts.duration ?? DEFAULT_MS[type]))
  return id
}

toast.success = (m: string, opts?: ToastOptions) => toast(m, "success", opts)
toast.error = (m: string, opts?: ToastOptions) => toast(m, "error", opts)
toast.info = (m: string, opts?: ToastOptions) => toast(m, "info", opts)
toast.warning = (m: string, opts?: ToastOptions) => toast(m, "warning", opts)
toast.dismiss = dismiss

const styles: Record<ToastType, { box: string; icon: string; Icon: typeof Info }> = {
  success: { box: "border-emerald-500/30", icon: "text-emerald-500", Icon: CheckCircle2 },
  error: { box: "border-red-500/35", icon: "text-red-500", Icon: XCircle },
  warning: { box: "border-amber-500/35", icon: "text-amber-500", Icon: AlertTriangle },
  info: { box: "border-border", icon: "text-cyan-500", Icon: Info },
}

export function Toaster() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.push(l)
    return () => {
      listeners = listeners.filter((x) => x !== l)
    }
  }, [])

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((t) => {
        const s = styles[t.type]
        return (
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card/95 px-3 py-2.5 text-sm text-foreground shadow-lg backdrop-blur",
              "motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in-0 motion-safe:duration-200",
              t.leaving && "motion-safe:animate-out motion-safe:fade-out-0 motion-safe:slide-out-to-right-2 motion-safe:duration-150 motion-safe:fill-mode-forwards",
              s.box,
            )}
          >
            <s.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.icon)} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="break-words leading-snug">{t.message}</div>
              {t.detail && <div className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">{t.detail}</div>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="-mr-1 -mt-0.5 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
