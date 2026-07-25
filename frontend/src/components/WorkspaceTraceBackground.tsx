import { useEffect, useRef } from 'react'

type Point = { x: number; y: number }

const pointOnCurve = (start: Point, control: Point, end: Point, progress: number): Point => {
  const inverse = 1 - progress
  return {
    x: inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * end.x,
    y: inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * end.y,
  }
}

export function WorkspaceTraceBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let frame = 0
    const startedAt = performance.now()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = rect.width * ratio
      canvas.height = rect.height * ratio
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const render = (now: number) => {
      const { width, height } = canvas.getBoundingClientRect()
      const dark = document.documentElement.classList.contains('dark')
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--beacon-400').trim().replace(/\s+/g, ', ')
      const progress = reduceMotion ? 0.44 : ((now - startedAt) / 10000) % 1
      ctx.clearRect(0, 0, width, height)

      ;[0.32, 0.72].forEach((lane, index) => {
        const start = { x: width * 0.08, y: height * lane }
        const end = { x: width * 0.94, y: height * (lane + (index ? -0.04 : 0.035)) }
        const control = { x: width * 0.54, y: height * (lane + (index ? 0.08 : -0.07)) }
        const stroke = dark ? `rgba(${accent}, .11)` : `rgba(${accent}, .075)`

        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.quadraticCurveTo(control.x, control.y, end.x, end.y)
        ctx.strokeStyle = stroke
        ctx.lineWidth = 1
        ctx.stroke()

        ;[start, pointOnCurve(start, control, end, 0.52), end].forEach((node) => {
          ctx.beginPath()
          ctx.arc(node.x, node.y, 3, 0, Math.PI * 2)
          ctx.strokeStyle = stroke
          ctx.stroke()
        })

        const request = pointOnCurve(start, control, end, (progress + index * 0.3) % 1)
        const response = pointOnCurve(start, control, end, 1 - ((progress + index * 0.3 + 0.48) % 1))
        ctx.save()
        ctx.shadowColor = `rgb(${accent})`
        ctx.shadowBlur = 12
        ctx.fillStyle = `rgb(${accent})`
        ctx.beginPath()
        ctx.arc(request.x, request.y, 2.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.roundRect(response.x - 6, response.y - 2, 12, 4, 2)
        ctx.fill()
        ctx.restore()

        ctx.font = '600 8px JetBrains Mono, monospace'
        ctx.fillStyle = dark ? 'rgba(148, 163, 184, .25)' : 'rgba(71, 85, 105, .22)'
        ctx.fillText(index ? '200 RESPONSE' : 'REQUEST', width * 0.53, control.y - 8)
      })

      if (!reduceMotion) frame = requestAnimationFrame(render)
    }

    resize()
    render(performance.now())
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="workspace-trace pointer-events-none fixed inset-0 h-full w-full" aria-hidden="true" />
}
