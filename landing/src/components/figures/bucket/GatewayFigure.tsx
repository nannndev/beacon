// Fig: the AI Gateway as a manifold. One intake, a lit shuttle that routes each
// request to the first account with quota, and three cylinders whose pistons
// show how much of each account's window is used. Driven by model.ts.
import * as React from 'react'
import { Dots, IsoFigure, Line, Plate, Solid } from '../../iso/react/draw'
import { asksForStillness, useInView, useReadout } from '../../iso/react/live'
import * as k from '../../iso/iso-kit'
import '../../iso/iso.css'
import './gateway.css'
import {
  BASE, CYLINDERS, CYL_X, HEIGHT, INTAKE, MANIFOLD_ART, P, PISTON_HIGH, PISTON_LOW,   RISERS, ROD, ROD_KNOB, SHUTTLE, SHUTTLE_REST, VALVES, WIDTH, pulseAt,
} from './geometry'
import { ACCOUNTS, fillOf, initial, readoutOf, step } from './model'

const pistonZ = (fill: number) => PISTON_LOW + (1 - fill) * (PISTON_HIGH - PISTON_LOW)

// Static art, built once. Keys on every root (see the kit's React notes).
const BASE_ART = (
  <g key="base">
    <path className="iso-halo" d={BASE.halo} />
    {BASE.feet.map((parts, i) => (
      <g key={i}>{parts.map((paths, j) => <Solid key={j} paths={paths} tone={j ? 'mid' : 'lo'} />)}</g>
    ))}
    <Solid paths={BASE.slab} tone="mid" />
    <Line d={BASE.groove} tone="lo" />
    <Line d={BASE.screwRings} tone="lo" />
    <Dots points={BASE.screws} size={0.5} />
    <Solid paths={BASE.strip} tone="lo" crease="none" />
    <Line d={BASE.ticksMinor} tone="lo" />
    <Line d={BASE.ticksMajor} tone="mid" />
    <Dots points={BASE.stripScrews} size={0.45} />
    <Solid paths={BASE.label} tone="lo" crease="none" />
    <Line d={BASE.labelLine} tone="faint" />
    {BASE.labelRules.map((d, i) => <Line key={i} d={d} tone="lo" free />)}
    <Dots points={BASE.labelScrews} size={0.45} />
  </g>
)

export function GatewayFigure() {
  const stage = React.useRef<HTMLDivElement | null>(null)
  const shuttle = React.useRef<SVGGElement | null>(null)
  const pulse = React.useRef<SVGCircleElement | null>(null)
  const pistons = React.useRef<(SVGGElement | null)[]>([])
  const rods = React.useRef<(SVGGElement | null)[]>([])
  const lamps = React.useRef<(SVGCircleElement | null)[]>([])
  const { anchor, say } = useReadout<SVGGElement>()
  const [light, setLight] = React.useState(false)
  React.useEffect(() => {
    const root = document.documentElement
    const sync = () => setLight(!root.classList.contains('dark'))
    sync()
    const watch = new MutationObserver(sync)
    watch.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => watch.disconnect()
  }, [])
  const inView = useInView(stage)

  React.useEffect(() => {
    if (!inView) return
    const s = initial()
    let x = SHUTTLE_REST
    let pulseT = 1 // 0..1 progress of the request travelling down the intake
    const fills = ACCOUNTS.map(() => 0)
    let last = 0
    let frame = 0

    const draw = () => {
      shuttle.current?.setAttribute('transform', k.translateAlong(P, [x, 0, 0]))
      fills.forEach((f, i) => {
        const z = pistonZ(f)
        pistons.current[i]?.setAttribute('transform', k.translateAlong(P, [0, 0, z]))
        rods.current[i]?.setAttribute('transform', k.translateAlong(P, [0, 0, -((PISTON_HIGH - z) / (PISTON_HIGH - PISTON_LOW)) * 8]))
        // A cylinder whose window is full answers 429: its lamp goes dark.
        lamps.current[i]?.setAttribute('data-on', s.tokens[i] >= 1 ? '' : 'off')
      })
      if (pulse.current) {
        const px = INTAKE.pulseFrom + (INTAKE.pulseTo - INTAKE.pulseFrom) * Math.min(pulseT, 1)
        const [cx, cy] = pulseAt(px)
        pulse.current.setAttribute('cx', cx.toFixed(1))
        pulse.current.setAttribute('cy', cy.toFixed(1))
        pulse.current.setAttribute('opacity', pulseT < 1 ? String(Math.sin(Math.PI * pulseT) * 0.9 + 0.1) : '0')
      }
    }

    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60
      last = now
      const calm = asksForStillness()
      const sent = step(s, calm ? 0 : dt)
      if (sent !== null) pulseT = 0
      pulseT += dt / 0.36
      const target = CYL_X[Math.max(0, s.route)]
      x = calm ? target : x + (target - x) * (1 - Math.exp(-dt / 0.12))
      ACCOUNTS.forEach((_, i) => {
        const want = fillOf(s, i)
        fills[i] = calm ? want : fills[i] + (want - fills[i]) * (1 - Math.exp(-dt / 0.18))
      })
      draw()
      say(readoutOf(s))
      frame = calm ? 0 : requestAnimationFrame(tick)
    }
    draw()
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [inView, say])

  return (
    <div ref={stage} className="gw-figure iso" data-theme={light ? 'light' : undefined}>
      <Plate
        fig="Fig 1"
        title="AI Gateway"
        hint="Ordered #1 → #2 → #3"
        readout="→ account #1 · 0 failovers"
        keys={[
          { mark: 'lit', label: 'The shuttle: where the next request goes' },
          { mark: 'raised', label: 'One cylinder per account; the piston drops as its quota is used' },
          { mark: 'dotted', label: 'A dark lamp means that account is answering 429' },
        ]}
        caption={`Requests arrive at ${2.6} per second; each account refills ${ACCOUNTS[0].refill} per second from a window of ${ACCOUNTS[0].capacity}. Account #1 drains first, so the gateway spills to #2 and #3 instead of failing.`}
      >
        <IsoFigure
          width={WIDTH}
          height={HEIGHT}
          label="Beacon's AI Gateway drawn as a manifold: requests enter one intake, a lit shuttle routes each one to the first account with quota left, and three cylinders show each account's remaining quota with a piston."
        >
          <g ref={anchor}>{BASE_ART}</g>
          {CYLINDERS.map((c, i) => (
            <g key={`cyl${i}`}>
              <Solid paths={c.pad} tone="lo" />
              <Dots points={c.padScrews} size={0.45} />
              <Solid paths={c.body} tone="hi" crease="lo" inner={<><Line d={c.bands} tone="faint" /><Line d={c.window} tone="lo" /><Line d={c.windowTicks} tone="lo" /></>} />
              <g ref={(n) => { pistons.current[i] = n }}>
                <path className="gw-piston" d={c.piston} />
              </g>
              <Solid paths={c.cap} tone="mid" />
              <Line d={c.capRing} tone="lo" />
              <Dots points={c.capBolts} size={0.45} />
              <Solid paths={c.gland} tone="mid" />
              <g ref={(n) => { rods.current[i] = n }}>
                <Solid paths={ROD(c.x)} tone="mid" crease="none" />
                <Solid paths={ROD_KNOB(c.x)} tone="mid" />
              </g>
            </g>
          ))}
          {RISERS.map((r, i) => (
            <g key={`riser${i}`}>
              <Solid paths={r.run} tone="mid" />
              <Solid paths={r.collar} tone="mid" />
            </g>
          ))}
          {MANIFOLD_ART.saddles.map((paths, i) => <Solid key={`sad${i}`} paths={paths} tone="lo" />)}
          <Dots points={MANIFOLD_ART.saddleScrews} size={0.45} />
          <Solid paths={INTAKE.pedestal} tone="lo" />
          <Solid paths={INTAKE.saddle} tone="lo" />
          <Solid paths={INTAKE.flange} tone="mid" />
          <Dots points={INTAKE.flangeScrews} size={0.45} />
          <Solid paths={INTAKE.run} tone="mid" />
          <circle ref={pulse} className="gw-pulse" r="1.6" opacity="0" />
          {INTAKE.bands.map((paths, i) => <Solid key={`band${i}`} paths={paths} tone="mid" />)}
          <Solid paths={MANIFOLD_ART.ends[0]} tone="mid" />
          <Solid paths={MANIFOLD_ART.body} tone="mid" inner={<Line d={MANIFOLD_ART.seam} tone="faint" />} />
          <Line d={MANIFOLD_ART.slot} tone="lo" />
          <Line d={MANIFOLD_ART.detents} tone="lo" />
          <Solid paths={MANIFOLD_ART.rulerStrip} tone="lo" crease="none" />
          <Line d={MANIFOLD_ART.ruler.minor} tone="lo" />
          <Line d={MANIFOLD_ART.ruler.major} tone="mid" />
          <Dots points={MANIFOLD_ART.rulerScrews} size={0.4} />
          <Solid paths={MANIFOLD_ART.ends[1]} tone="mid" />
          <Dots points={MANIFOLD_ART.endScrews} size={0.45} />
          {VALVES.map((v, i) => (
            <g key={`valve${i}`}>
              <Solid paths={v.neck} tone="mid" />
              <Solid paths={v.knob} tone="mid" />
              <Line d={v.knurl} tone="lo" />
              <Line d={v.pointer} tone="hi" />
              <circle ref={(n) => { lamps.current[i] = n }} className="gw-lamp" cx={v.hub[0]} cy={v.hub[1]} r="1.2" data-on="" />
            </g>
          ))}
          <g ref={shuttle} transform={k.translateAlong(P, [SHUTTLE_REST, 0, 0])}>
            <path className="iso-halo" d={SHUTTLE.halo} />
            <Solid paths={SHUTTLE.body} tone="hi" lit />
            <Solid paths={SHUTTLE.grip} tone="hi" lit />
            <Line d={SHUTTLE.gripKnurl} tone="lo" />
            <Line d={SHUTTLE.arrow} tone="lit" />
          </g>
        </IsoFigure>
      </Plate>
    </div>
  )
}
