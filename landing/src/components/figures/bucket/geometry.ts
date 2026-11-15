// Static geometry for the gateway manifold, computed once at module load.
// World units ≈ 1 px; x along the manifold, y toward the viewer, z up.
import * as k from '../../iso/iso-kit'
import { ACCOUNTS } from './model'

export const WIDTH = 620
export const HEIGHT = 360

const PLATE = { x: -150, y: -58, w: 300, d: 98, r: 8 }
const PLATE_H = 10
const FOOT_H = 5

// Manifold block that carries the three outlets, and the intake on its left end.
const MANIFOLD = { x: -112, y: -14, w: 214, d: 22, r: 4 }
const MANIFOLD_Z = 10
const MANIFOLD_H = 16
export const MANIFOLD_TOP = MANIFOLD_Z + MANIFOLD_H

// Three cylinders behind the manifold, one per account.
export const CYL_X = [-58, 2, 62]
const CYL_Y = -34
export const CYL_R = 13
const CYL_Z = 0
export const CYL_H = 74
const CYL_TOP = CYL_Z + CYL_H
// Piston travel inside the gauge window: empty bucket at the bottom, full at the top.
export const PISTON_LOW = 32
export const PISTON_HIGH = 64

// The shuttle rides a slot on top of the manifold, from outlet to outlet.
export const SHUTTLE_Y = -3
export const SHUTTLE_STOPS = CYL_X
export const SHUTTLE_REST = CYL_X[0]

export const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), ...CYL_X.map((x): k.Point3 => [x, CYL_Y - CYL_R, CYL_TOP + 6])],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 38, elevation: 30 },
)

export const at = (p: k.Point3) => k.iso(p, P)
const byDepth = <T extends k.Plane>(points: T[]) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))

// --- base -----------------------------------------------------------------
const strip = { x: -134, y: PLATE.y + PLATE.d - 14, w: 268, d: 7, r: 1 }
const label = { x: 104, y: PLATE.y + PLATE.d - 31, w: 34, d: 14, r: 1.5 }
const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P)

export const BASE = {
  halo: k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P),
  feet: byDepth(k.corners(PLATE, 22)).map(([x, y]) => [
    k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28),
    k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28),
  ]),
  slab: k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6),
  groove: k.planOutline(k.insetPlan(PLATE, 5), 0, P),
  screwRings: k.corners(PLATE, 10).map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(''),
  screws: k.corners(PLATE, 10).map(([x, y]) => at([x, y, 0])),
  strip: k.slabOf(strip, 0, 0.6, P, 3),
  ticksMinor: ticks.minor,
  ticksMajor: ticks.major,
  stripScrews: [at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])],
  label: k.slabOf(label, 0, 0.8, P, 4),
  labelLine: k.planOutline(k.insetPlan(label, 1.6), 0.8, P),
  labelRules: [
    k.lineOnTop([label.x + 4, label.y + 5], [label.x + label.w - 6, label.y + 5], 0.8, P),
    k.lineOnTop([label.x + 4, label.y + 8.5], [label.x + label.w - 14, label.y + 8.5], 0.8, P),
    k.lineOnTop([label.x + 4, label.y + 12], [label.x + label.w - 20, label.y + 12], 0.8, P),
  ],
  labelScrews: [at([label.x + 2.4, label.y + label.d / 2, 0.8]), at([label.x + label.w - 2.4, label.y + label.d / 2, 0.8])],
}

// --- cylinders (the token buckets) ------------------------------------------
// Each is drawn back to front by x, which at this azimuth is also by depth.
// The gauge window lies ON the curved body, centred on the side that faces the
// viewer, so its edges and ticks sit on the real surface.
const FACING = Math.atan2(k.towardViewer(P)[1], k.towardViewer(P)[0])
const WIN_HALF = 0.26 // radians either side of the facing line
const onBody = (x: number, a: number, z: number, r = CYL_R): k.Point3 => [x + Math.cos(a) * r, CYL_Y + Math.sin(a) * r, z]
const arcAt = (x: number, z: number, a0: number, a1: number, r = CYL_R) =>
  k.pathOf(Array.from({ length: 9 }, (_, i) => at(onBody(x, a0 + ((a1 - a0) * i) / 8, z, r))))
export const WIN_Z0 = PISTON_LOW - 3
export const WIN_Z1 = PISTON_HIGH + 4
export const CYLINDERS = CYL_X.map((x) => {
  const a0 = FACING - WIN_HALF
  const a1 = FACING + WIN_HALF
  return {
    x,
    pad: k.cylinder(x, CYL_Y, CYL_R + 4, CYL_Z, 3, P, 48, 0.6),
    padScrews: [0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      return at([x + Math.cos(a) * (CYL_R + 2), CYL_Y + Math.sin(a) * (CYL_R + 2), 3])
    }),
    body: k.cylinder(x, CYL_Y, CYL_R, CYL_Z + 3, CYL_H - 3, P, 56, 0.8),
    bands: [CYL_Z + 9, CYL_TOP - 6].map((z) => k.sideArc(x, CYL_Y, CYL_R, z, P, 40)).join(''),
    // A closed slot: two arcs and two vertical edges, so it has no free ends.
    window: arcAt(x, WIN_Z0, a0, a1) + arcAt(x, WIN_Z1, a0, a1) +
      k.segment(onBody(x, a0, WIN_Z0), onBody(x, a0, WIN_Z1), P) +
      k.segment(onBody(x, a1, WIN_Z0), onBody(x, a1, WIN_Z1), P),
    // Scale lines across the window, each running edge to edge so no end is loose.
    windowTicks: [1, 2, 3, 4, 5].map((i) => arcAt(x, PISTON_LOW + (i / 6) * (PISTON_HIGH - PISTON_LOW), a0, a1)).join(''),
    // The piston: a lit band across the window, built at z = 0 and lifted live.
    piston: k.pathOf([
      ...Array.from({ length: 9 }, (_, i) => at(onBody(x, a0 + ((a1 - a0) * i) / 8, 1.4))),
      ...Array.from({ length: 9 }, (_, i) => at(onBody(x, a1 - ((a1 - a0) * i) / 8, -1.4))),
    ], true),
    cap: k.cylinder(x, CYL_Y, CYL_R + 1.4, CYL_TOP, 4, P, 56, 0.6),
    capRing: k.ring(x, CYL_Y, CYL_R - 3, CYL_TOP + 4, P, 48),
    capBolts: [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2
      return at([x + Math.cos(a) * (CYL_R - 1.2), CYL_Y + Math.sin(a) * (CYL_R - 1.2), CYL_TOP + 4])
    }),
    // A rod rises out of the cap; its height is the same piston value, built at rest.
    gland: k.cylinder(x, CYL_Y, 3.4, CYL_TOP + 4, 3, P, 24),
  }
})

// The piston marker inside the window and the rod above the cap move together.
export const ROD = (x: number) => k.cylinder(x, CYL_Y, 1.8, CYL_TOP + 4, 12, P, 18)
export const ROD_KNOB = (x: number) => k.cylinder(x, CYL_Y, 3, CYL_TOP + 16, 2.4, P, 24)

// --- pipes from the manifold back to each cylinder (short risers) -------------
export const RISERS = CYL_X.map((x) => ({
  run: k.slabOf({ x: x - 3, y: CYL_Y + CYL_R - 1, w: 6, d: MANIFOLD.y - (CYL_Y + CYL_R) + 2, r: 1.4 }, MANIFOLD_Z + 2, 6, P, 3, 0.4),
  collar: k.slabOf({ x: x - 4.2, y: MANIFOLD.y - 2.4, w: 8.4, d: 2.4, r: 1 }, MANIFOLD_Z + 1, 8, P, 3, 0.4),
}))

// --- manifold, saddles, end caps, slot ----------------------------------------
const SADDLES = [MANIFOLD.x + 18, MANIFOLD.x + MANIFOLD.w - 26]
const RULER = { x: MANIFOLD.x + 12, y: MANIFOLD.y + MANIFOLD.d - 5.4, w: MANIFOLD.w - 24, d: 4.2, r: 0.8 }
export const MANIFOLD_ART = {
  saddles: SADDLES.map((x) => k.slabOf({ x, y: MANIFOLD.y - 3, w: 8, d: MANIFOLD.d + 6, r: 1.2 }, 0, MANIFOLD_Z, P, 3, 0.4)),
  saddleScrews: SADDLES.flatMap((x) => [at([x + 4, MANIFOLD.y - 1.4, MANIFOLD_Z]), at([x + 4, MANIFOLD.y + MANIFOLD.d + 1.4, MANIFOLD_Z])]),
  body: k.slabOf(MANIFOLD, MANIFOLD_Z, MANIFOLD_H, P, 6, 1.2),
  seam: k.sideSeam(MANIFOLD, MANIFOLD_Z + 5, P, 6),
  slot: k.planOutline({ x: MANIFOLD.x + 10, y: SHUTTLE_Y - 2.4, w: MANIFOLD.w - 20, d: 4.8, r: 2.2 }, MANIFOLD_TOP, P, 4),
  ends: [MANIFOLD.x - 5, MANIFOLD.x + MANIFOLD.w].map((x) => k.slabOf({ x, y: MANIFOLD.y - 2, w: 5, d: MANIFOLD.d + 4, r: 1.2 }, MANIFOLD_Z - 1, MANIFOLD_H + 2, P, 3, 0.5)),
  endScrews: [MANIFOLD.x - 2.5, MANIFOLD.x + MANIFOLD.w + 2.5].flatMap((x) => [at([x, MANIFOLD.y + 3, MANIFOLD_TOP + 1]), at([x, MANIFOLD.y + MANIFOLD.d - 3, MANIFOLD_TOP + 1])]),
  // Detents where the shuttle stops, one under each outlet.
  detents: CYL_X.map((x) => k.ring(x, SHUTTLE_Y, 1.4, MANIFOLD_TOP, P, 16)).join(''),
  // Ticks hang from a thin ruler strip's edge, never from bare metal.
  rulerStrip: k.slabOf(RULER, MANIFOLD_TOP, 0.5, P, 3),
  ruler: k.topTicks(RULER.x + 3, RULER.x + RULER.w - 3, 6, 5, RULER.y + 0.6, MANIFOLD_TOP + 0.5, [1.6, 3], P),
  rulerScrews: [at([RULER.x + 1.6, RULER.y + RULER.d / 2, MANIFOLD_TOP + 0.5]), at([RULER.x + RULER.w - 1.6, RULER.y + RULER.d / 2, MANIFOLD_TOP + 0.5])],
}

// --- valve towers on the front face, one per outlet ---------------------------
export const VALVES = CYL_X.map((x) => {
  const y = MANIFOLD.y + MANIFOLD.d
  return {
    neck: k.slabOf({ x: x - 3.4, y, w: 6.8, d: 4, r: 1 }, MANIFOLD_Z + 3, 10, P, 3, 0.4),
    knob: k.cylinder(x, y + 8, 5, MANIFOLD_Z + 1, 6, P, 32, 0.4),
    knurl: k.knurl(x, y + 8, 5, MANIFOLD_Z + 1, MANIFOLD_Z + 7, 30, P),
    pointer: k.lineOnTop([x, y + 8], [x, y + 12.4], MANIFOLD_Z + 7, P),
    hub: at([x, y + 8, MANIFOLD_Z + 7]),
  }
})

// --- intake: pipe from the left edge into the manifold's end -----------------
const INTAKE_Y = MANIFOLD.y + MANIFOLD.d / 2
const INTAKE_Z = MANIFOLD_Z + MANIFOLD_H / 2
const INTAKE_FROM = PLATE.x + 4
const INTAKE_TO = MANIFOLD.x - 5
export const INTAKE = {
  // A round pipe along x drawn as a rounded slab is crisp and has no seams.
  run: k.slabOf({ x: INTAKE_FROM + 6, y: INTAKE_Y - 4.2, w: INTAKE_TO - INTAKE_FROM - 6, d: 8.4, r: 4 }, INTAKE_Z - 4.2, 8.4, P, 6, 0.4),
  pedestal: k.slabOf({ x: INTAKE_FROM - 1, y: INTAKE_Y - 6, w: 8, d: 12, r: 1.2 }, 0, INTAKE_Z - 7, P, 3, 0.4),
  saddle: k.slabOf({ x: INTAKE_FROM + 20, y: INTAKE_Y - 5, w: 5, d: 10, r: 1 }, 0, INTAKE_Z - 4.2, P, 3, 0.4),
  flange: k.slabOf({ x: INTAKE_FROM, y: INTAKE_Y - 7, w: 6, d: 14, r: 1.6 }, INTAKE_Z - 7, 14, P, 3, 0.5),
  flangeScrews: [at([INTAKE_FROM + 3, INTAKE_Y - 4.6, INTAKE_Z + 7]), at([INTAKE_FROM + 3, INTAKE_Y + 4.6, INTAKE_Z + 7])],
  bands: [INTAKE_FROM + 16, INTAKE_FROM + 28].map((x) => k.slabOf({ x, y: INTAKE_Y - 4.8, w: 2.4, d: 9.6, r: 1 }, INTAKE_Z - 4.8, 9.6, P, 3)),
  pulseFrom: INTAKE_FROM + 8,
  pulseTo: INTAKE_TO,
  y: INTAKE_Y,
  z: INTAKE_Z,
}

// --- the lit shuttle, built at x = 0 and moved along the slot -----------------
export const SHUTTLE = {
  halo: k.haloOf({ x: -9, y: SHUTTLE_Y - 6, w: 18, d: 12, r: 3 }, MANIFOLD_TOP, 0.1, P),
  body: k.slabOf({ x: -9, y: SHUTTLE_Y - 6, w: 18, d: 12, r: 3 }, MANIFOLD_TOP, 7, P, 5, 0.6),
  grip: k.cylinder(0, SHUTTLE_Y, 3.6, MANIFOLD_TOP + 7, 4, P, 24, 0.3),
  gripKnurl: k.knurl(0, SHUTTLE_Y, 3.6, MANIFOLD_TOP + 7, MANIFOLD_TOP + 11, 20, P),
  arrow: k.lineOnTop([-9, SHUTTLE_Y], [9, SHUTTLE_Y], MANIFOLD_TOP + 7, P),
}

// On the pipe's top face, so the pulse reads as light running along the pipe.
export const pulseAt = (x: number) => at([x, INTAKE_Y, INTAKE_Z + 4.2])
export const ACCOUNT_COUNT = ACCOUNTS.length
