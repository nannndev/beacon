import { useEffect, useRef } from 'react'

type Point = { x: number; y: number }

const curvePoint = (start: Point, control: Point, end: Point, progress: number): Point => {
  const inverse = 1 - progress
  return {
    x: inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * end.x,
    y: inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * end.y,
  }
}

export function NetworkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let frame = 0
    let startedAt = performance.now()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = rect.width * ratio
      canvas.height = rect.height * ratio
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const drawNode = (point: Point, color: string, dark: boolean) => {
      ctx.beginPath()
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
      ctx.fillStyle = dark ? 'rgba(8, 12, 18, .92)' : 'rgba(255, 255, 255, .92)'
      ctx.fill()
      ctx.lineWidth = 1.2
      ctx.strokeStyle = color
      ctx.stroke()
    }

    const drawPacket = (point: Point, color: string, response = false) => {
      ctx.save()
      ctx.shadowColor = color
      ctx.shadowBlur = 14
      ctx.fillStyle = color
      ctx.beginPath()
      if (response) ctx.roundRect(point.x - 8, point.y - 3, 16, 6, 3)
      else ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    const render = (now: number) => {
      const { width, height } = canvas.getBoundingClientRect()
      const dark = document.documentElement.classList.contains('dark')
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--beacon-400').trim().replace(/\s+/g, ', ')
      const blue = `rgb(${accent})`
      const elapsed = reduceMotion ? 0.42 : (now - startedAt) / 9000

      ctx.clearRect(0, 0, width, height)
      const lanes = [0.2, 0.49, 0.78]

      lanes.forEach((lane, index) => {
        const start = { x: width * 0.05, y: height * lane }
        const end = { x: width * 0.95, y: height * (lane + (index === 1 ? -0.035 : 0.025)) }
        const control = { x: width * 0.51, y: height * (lane + (index - 1) * 0.075) }
        const pathColor = dark ? `rgba(${accent}, .13)` : `rgba(${accent}, .1)`

        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.quadraticCurveTo(control.x, control.y, end.x, end.y)
        ctx.lineWidth = 1
        ctx.strokeStyle = pathColor
        ctx.stroke()

        const gateway = curvePoint(start, control, end, 0.52)
        drawNode(start, pathColor, dark)
        drawNode(gateway, pathColor, dark)
        drawNode(end, pathColor, dark)

        const requestProgress = (elapsed + index * 0.24) % 1
        const responseProgress = 1 - ((elapsed + index * 0.24 + 0.46) % 1)
        drawPacket(curvePoint(start, control, end, requestProgress), blue)
        drawPacket(curvePoint(start, control, end, responseProgress), blue, true)

        if (index === 0) {
          ctx.fillStyle = dark ? 'rgba(148, 163, 184, .36)' : 'rgba(71, 85, 105, .34)'
          ctx.font = '600 9px JetBrains Mono, monospace'
          ctx.letterSpacing = '1px'
          ctx.fillText('CLIENT', start.x + 10, start.y - 10)
          ctx.fillText('REQUEST', gateway.x + 10, gateway.y - 10)
          ctx.fillText('API', end.x - 24, end.y - 10)
        }
      })

      if (!reduceMotion) frame = requestAnimationFrame(render)
    }

    resize()
    render(performance.now())
    window.addEventListener('resize', resize)
    const restart = () => { startedAt = performance.now() }
    document.addEventListener('visibilitychange', restart)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', restart)
    }
  }, [])

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 -z-10 h-full w-full opacity-50 dark:opacity-60" aria-hidden="true" />
}
