import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  PauseCircle,
  Play,
  RotateCcw,
  ShieldAlert,
  SkipForward,
  Sparkles,
  Square,
  Terminal,
  X,
} from 'lucide-react'
import type { AgentBubbleAction, AgentLiveStatus } from '../../types'
import { AgentCharacter, type CharacterMood } from './AgentCharacter'

interface AgentTriggerProps {
  open: boolean
  onClick: () => void
  status?: AgentLiveStatus
  onAnchorChange?: (origin: { x: number; y: number }) => void
  onAction?: (action: AgentBubbleAction) => void
}

const POS_STORAGE_KEY = 'beacon.agent.char_pos.v1'
const CHAR_W = 74
const CHAR_H = 82
const MARGIN = 14

const IDLE_QUIPS = [
  'Butuh bantuan API? (⌘J)',
  'Siap probe & cek endpoint...',
  'Semua aman terkendali ✨',
  'Tanya apa aja! (⌘J)',
]

function clampPosition(x: number, y: number): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y }
  const maxX = Math.max(MARGIN, window.innerWidth - CHAR_W - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - CHAR_H - MARGIN)
  return {
    x: Math.min(maxX, Math.max(MARGIN, x)),
    y: Math.min(maxY, Math.max(MARGIN, y)),
  }
}

function getInitialPosition(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 24, y: 24 }
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        return clampPosition(parsed.x, parsed.y)
      }
    }
  } catch {
    // ignore storage errors
  }
  return clampPosition(window.innerWidth - CHAR_W - 24, window.innerHeight - CHAR_H - 22)
}

export function AgentTrigger({
  open,
  onClick,
  status,
  onAnchorChange,
  onAction,
}: AgentTriggerProps) {
  const [hovered, setHovered] = useState(false)
  const [quipIdx, setQuipIdx] = useState(0)
  const [pos, setPos] = useState<{ x: number; y: number }>(getInitialPosition)
  const [dragging, setDragging] = useState(false)
  const [dragTilt, setDragTilt] = useState(0)
  const [look, setLook] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [idleAction, setIdleAction] = useState<'none' | 'jump' | 'run'>('none')
  const [runDir, setRunDir] = useState<1 | -1>(-1)
  const [hiddenForDrawer, setHiddenForDrawer] = useState(open)

  const posRef = useRef(pos)
  posRef.current = pos

  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    lastX: number
    moved: boolean
  } | null>(null)
  const tiltDecayRef = useRef<number>(0)
  const hoverTimerRef = useRef<number>(0)

  const enterHover = () => {
    window.clearTimeout(hoverTimerRef.current)
    setHovered(true)
  }

  const leaveHover = () => {
    window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = window.setTimeout(() => setHovered(false), 140)
  }

  useEffect(() => () => window.clearTimeout(hoverTimerRef.current), [])

  const state = status?.state || 'idle'
  const mode = status?.mode || 'agent'

  const triggerOpen = () => {
    setIdleAction('none')
    onAnchorChange?.({
      x: posRef.current.x + CHAR_W / 2,
      y: posRef.current.y + CHAR_H / 2,
    })
    onClick()
  }

  useEffect(() => {
    onAnchorChange?.({ x: pos.x + CHAR_W / 2, y: pos.y + CHAR_H / 2 })
  }, [pos.x, pos.y, onAnchorChange])

  useEffect(() => {
    if (open) {
      setHiddenForDrawer(true)
      setIdleAction('none')
      return
    }
    const tm = window.setTimeout(() => setHiddenForDrawer(false), 210)
    return () => window.clearTimeout(tm)
  }, [open])

  // Cursor eye-tracking
  useEffect(() => {
    if (open) return
    let rafId = 0
    const onPointerMove = (e: PointerEvent) => {
      if (rafId) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        const headX = posRef.current.x + CHAR_W / 2
        const headY = posRef.current.y + 30
        const nx = Math.max(-1, Math.min(1, (e.clientX - headX) / 220))
        const ny = Math.max(-1, Math.min(1, (e.clientY - headY) / 180))
        setLook((prev) =>
          Math.abs(prev.x - nx) < 0.03 && Math.abs(prev.y - ny) < 0.03
            ? prev
            : { x: nx, y: ny },
        )
      })
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId)
      window.removeEventListener('pointermove', onPointerMove)
    }
  }, [open])

  // Autonomous playful jump & run while idle
  useEffect(() => {
    if (state !== 'idle' || hovered || dragging || open) {
      setIdleAction('none')
      return
    }

    let timeoutId = 0
    let actionTimeoutId = 0
    let rafId = 0
    let cancelled = false

    const scheduleNext = () => {
      const waitMs = 6500 + Math.random() * 5500
      timeoutId = window.setTimeout(() => {
        if (cancelled) return
        if (Math.random() < 0.45) {
          setIdleAction('jump')
          actionTimeoutId = window.setTimeout(() => {
            if (cancelled) return
            setIdleAction('none')
            scheduleNext()
          }, 1150)
          return
        }

        const cur = posRef.current
        const maxX = Math.max(MARGIN, window.innerWidth - CHAR_W - MARGIN)
        const dir: 1 | -1 =
          cur.x < maxX * 0.25 ? 1 : cur.x > maxX * 0.75 ? -1 : Math.random() < 0.5 ? 1 : -1
        const distance = 90 + Math.random() * 110
        const clampedTarget = clampPosition(cur.x + dir * distance, cur.y)
        const actualDist = clampedTarget.x - cur.x
        if (Math.abs(actualDist) < 28) {
          setIdleAction('jump')
          actionTimeoutId = window.setTimeout(() => {
            if (cancelled) return
            setIdleAction('none')
            scheduleNext()
          }, 1100)
          return
        }

        setRunDir(actualDist >= 0 ? 1 : -1)
        setIdleAction('run')
        const startX = cur.x
        const startY = cur.y
        const duration = 1450
        const t0 = performance.now()

        const step = (now: number) => {
          if (cancelled) return
          const elapsed = now - t0
          const p = Math.min(1, elapsed / duration)
          const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
          const next = clampPosition(startX + actualDist * eased, startY)
          setPos(next)
          if (p < 1) {
            rafId = window.requestAnimationFrame(step)
          } else {
            try {
              localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(next))
            } catch {
              // ignore storage errors
            }
            setIdleAction('none')
            scheduleNext()
          }
        }
        rafId = window.requestAnimationFrame(step)
      }, waitMs)
    }

    scheduleNext()
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      window.clearTimeout(actionTimeoutId)
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [state, hovered, dragging, open])

  useEffect(() => {
    if (state !== 'idle' || open) return
    const id = window.setInterval(() => setQuipIdx((i) => i + 1), 9000)
    return () => window.clearInterval(id)
  }, [state, open])

  useEffect(() => {
    const onResize = () => setPos((prev) => clampPosition(prev.x, prev.y))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!dragging) return

    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      const dxTotal = e.clientX - d.startX
      const dyTotal = e.clientY - d.startY
      if (!d.moved && Math.hypot(dxTotal, dyTotal) > 5) d.moved = true

      const nextPos = clampPosition(d.originX + dxTotal, d.originY + dyTotal)
      setPos(nextPos)

      const vx = e.clientX - d.lastX
      d.lastX = e.clientX
      setDragTilt(Math.max(-16, Math.min(16, vx * 1.15)))
      window.clearTimeout(tiltDecayRef.current)
      tiltDecayRef.current = window.setTimeout(() => setDragTilt(0), 90)
    }

    const onPointerUp = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      dragRef.current = null
      setDragging(false)
      setDragTilt(0)

      if (d.moved) {
        const finalPos = clampPosition(d.originX + (e.clientX - d.startX), d.originY + (e.clientY - d.startY))
        setPos(finalPos)
        try {
          localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(finalPos))
        } catch {
          // ignore
        }
      } else {
        triggerOpen()
      }
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, onClick])

  if (open || hiddenForDrawer) return null

  const mood: CharacterMood = dragging
    ? 'dragging'
    : state !== 'idle'
      ? state
      : hovered
        ? 'hovered'
        : idleAction === 'jump'
          ? 'jumping'
          : idleAction === 'run'
            ? 'running'
            : 'idle'

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      lastX: e.clientX,
      moved: false,
    }
    setDragging(true)
  }

  const hasActionBubble = state !== 'idle'
  const showIdleHoverBubble = state === 'idle' && hovered && !dragging
  const showBubble = (hasActionBubble || showIdleHoverBubble) && !dragging
  const isExpanded = hovered

  const placeBubbleBelow = pos.y < 185
  const alignBubbleRight = typeof window !== 'undefined' ? pos.x > window.innerWidth / 2 : true

  const statusHeadline =
    state === 'executing'
      ? `Tool${status?.projectName ? ` · ${status.projectName}` : '...'}`
      : state === 'thinking'
        ? `Thinking...${status?.step && status.step > 1 ? ` · #${status.step}` : ''}`
        : state === 'approval'
          ? `Needs approval!${(status?.pendingCount || 1) > 1 ? ` (${status?.pendingCount})` : ''}`
          : state === 'limit'
            ? `Paused (${status?.maxSteps || 10} steps)`
            : state === 'error'
              ? 'Error!'
              : state === 'done'
                ? 'Done!'
                : IDLE_QUIPS[quipIdx % IDLE_QUIPS.length]

  const bubbleBorderColor =
    state === 'approval' || state === 'limit'
      ? 'border-amber-500/60'
      : state === 'error'
        ? 'border-red-500/60'
        : state === 'executing' || state === 'done'
          ? 'border-emerald-500/55'
          : state === 'thinking'
            ? 'border-sky-500/55'
            : 'border-border'

  const bubbleShadow =
    state === 'approval' || state === 'limit'
      ? 'shadow-amber-500/15'
      : state === 'error'
        ? 'shadow-red-500/15'
        : state === 'executing' || state === 'done'
          ? 'shadow-emerald-500/15'
          : state === 'thinking'
            ? 'shadow-sky-500/15'
            : ''

  const triggerNode = (
    <div
      style={{ left: pos.x, top: pos.y, width: CHAR_W, height: CHAR_H, touchAction: 'none' }}
      onMouseEnter={enterHover}
      onMouseLeave={leaveHover}
      className="fixed z-40 select-none"
    >
      {showBubble && (
        <div
          onMouseEnter={enterHover}
          onMouseLeave={leaveHover}
          className={`absolute ${placeBubbleBelow ? 'top-full pt-2' : 'bottom-full pb-2'} ${
            alignBubbleRight ? 'right-0' : 'left-0'
          } z-20`}
        >
          <div
            style={{ animation: 'agent-pop-in 150ms ease-out' }}
            className={`relative text-left border shadow-xl backdrop-blur-md bg-card/95 transition-all duration-200 ease-out ${bubbleBorderColor} ${bubbleShadow} ${
              isExpanded
                ? 'w-max min-w-[230px] max-w-[290px] rounded-2xl px-3.5 py-2.5 shadow-2xl'
                : 'w-max max-w-[225px] rounded-full px-2.5 py-1.5'
            }`}
          >
            <span
              aria-hidden
              className={`absolute w-2.5 h-2.5 rotate-45 bg-card ${bubbleBorderColor} ${
                placeBubbleBelow ? '-top-[6px] border-l border-t' : '-bottom-[6px] border-r border-b'
              } ${alignBubbleRight ? 'right-7' : 'left-7'}`}
            />

            <div
              role="button"
              tabIndex={0}
              onClick={triggerOpen}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  triggerOpen()
                }
              }}
              className="cursor-pointer group/hdr relative z-10"
            >
              <div className="flex items-center justify-between gap-2 text-[11.5px] font-semibold text-foreground">
                <div className="flex items-center gap-1.5 min-w-0">
                  {state === 'executing' && <Terminal className="w-3.5 h-3.5 text-emerald-500 shrink-0 animate-pulse" />}
                  {state === 'thinking' && (
                    <Sparkles className="w-3.5 h-3.5 text-sky-500 shrink-0 animate-spin" style={{ animationDuration: '3s' }} />
                  )}
                  {state === 'approval' && <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-bounce" />}
                  {state === 'limit' && <PauseCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-pulse" />}
                  {state === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                  {state === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                  <span className="truncate group-hover/hdr:underline decoration-muted-foreground/50">
                    {statusHeadline}
                  </span>
                </div>
                <span
                  className={`shrink-0 rounded-full font-mono uppercase border ${
                    isExpanded ? 'px-1.5 py-0.5 text-[9.5px]' : 'px-1.5 py-0 text-[9px]'
                  } ${
                    mode === 'full'
                      ? 'bg-amber-500/15 text-amber-500 border-amber-500/35'
                      : mode === 'safe'
                        ? 'bg-sky-500/15 text-sky-500 border-sky-500/35'
                        : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/35'
                  }`}
                >
                  {mode === 'full' ? '⚡ Auto' : mode}
                </span>
              </div>

              {isExpanded && (
                <>
                  {status?.command && (state === 'executing' || state === 'approval') ? (
                    <div
                      className={`mt-1.5 rounded-lg bg-muted border px-2 py-1 font-mono text-[10.5px] truncate max-w-[255px] text-foreground ${
                        status?.isRisky && state === 'approval' ? 'border-red-500/50' : 'border-border'
                      }`}
                    >
                      <span className="text-emerald-500 font-bold mr-1">▸</span>
                      {status.command}
                    </div>
                  ) : status?.preview && hasActionBubble ? (
                    <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2 leading-snug">
                      {status.preview}
                    </p>
                  ) : state === 'idle' ? (
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                      Click to open chat · Drag to move
                    </p>
                  ) : null}
                </>
              )}
            </div>

            {isExpanded && hasActionBubble && (
              <div className="mt-2 pt-2 border-t border-border/70 flex items-center justify-between gap-1.5 relative z-10">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {state === 'approval' && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onAction?.('approve')
                        }}
                        className={`px-2 py-1 rounded-lg text-[10.5px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
                          status?.isRisky
                            ? 'bg-red-600 hover:bg-red-500 text-white'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                      >
                        <Play className="w-2.5 h-2.5 fill-current" />
                        <span>{status?.isRisky ? 'Run (!)' : 'Approve'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onAction?.('skip')
                        }}
                        className="px-2 py-1 rounded-lg text-[10.5px] font-medium bg-muted hover:bg-muted/80 text-foreground border border-border inline-flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <SkipForward className="w-2.5 h-2.5" />
                        <span>Skip</span>
                      </button>
                    </>
                  )}

                  {(state === 'thinking' || state === 'executing') && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAction?.('stop')
                      }}
                      className="px-2 py-1 rounded-lg text-[10.5px] font-semibold bg-red-600 hover:bg-red-500 text-white shadow-sm inline-flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                      <span>Stop</span>
                    </button>
                  )}

                  {state === 'error' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAction?.('retry')
                      }}
                      className="px-2 py-1 rounded-lg text-[10.5px] font-semibold bg-red-600 hover:bg-red-500 text-white shadow-sm inline-flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>Retry</span>
                    </button>
                  )}

                  {state === 'done' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        triggerOpen()
                      }}
                      className="px-2.5 py-1 rounded-lg text-[10.5px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <MessageSquare className="w-2.5 h-2.5" />
                      <span>View</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {state !== 'done' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        triggerOpen()
                      }}
                      title="Open full chat"
                      className="px-1.5 py-1 rounded-lg text-[10.5px] font-medium text-foreground/80 hover:text-foreground hover:bg-muted inline-flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <MessageSquare className="w-3 h-3" />
                      <span>Chat</span>
                    </button>
                  )}
                  {(state === 'done' || state === 'error') && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAction?.('dismiss')
                      }}
                      title="Dismiss"
                      className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            triggerOpen()
          }
        }}
        title="Open Beacon AI Agent (⌘J) · Drag to move"
        aria-label="Open Beacon AI Agent"
        className={`relative w-full h-full flex items-center justify-center outline-none transition-transform duration-150 ${
          dragging ? 'cursor-grabbing scale-110' : 'cursor-grab hover:scale-105 active:scale-95'
        }`}
      >
        <AgentCharacter mood={mood} mode={mode} dragTilt={dragTilt} look={look} runDir={runDir} />

        {(state === 'approval' || state === 'limit' || state === 'done' || state === 'error') && !dragging && (
          <span
            className={`absolute top-2 right-2 w-3 h-3 rounded-full border-2 border-background ${
              state === 'approval' || state === 'limit'
                ? 'bg-amber-400 animate-ping'
                : state === 'error'
                  ? 'bg-red-500 animate-pulse'
                  : 'bg-emerald-400'
            }`}
          />
        )}
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(triggerNode, document.body) : triggerNode
}

