import type { DetectedGrid, GridAxis } from './grid'
import type { Box } from './image'

/**
 * Fitting a lattice of known cell counts into a picture whose grid was not detected (too blurred,
 * lines too faint): per axis, the start and pitch whose lines fall on the strongest boundary evidence
 * and whose cell middles fall on the weakest, inside the content box.
 */

/** The fitted pitch is searched down to this fraction of the box size divided by the count (margins with axis numbers). */
const MIN_FILL = 0.7
/** The outer cells may stick out of the content box by this fraction of a pitch (a chart cut by the image border). */
const OVERHANG = 0.2
/** At most about this many evidence lookups per axis in the coarse search; coarser steps beyond it. */
const MAX_WORK = 6_000_000
/** An axis is taken as a grid when its lines carry this much more evidence than the cell middles (relative). */
const MIN_CONTRAST = 0.2
/** ...at least this fraction of its active lines beat the middles of the cells on both sides... */
const MIN_LINES = 0.75
/** ...and at least this fraction of its lines are active: above the floor by this fraction of the typical line. */
const MIN_ACTIVE = 0.5
const SILENT = 0.25

interface AxisResult {
  axis: GridAxis
  confidence: number
}

/**
 * Boundary evidence along one axis, summed over the box across it: the luma gradient (edges between
 * ink and paper cells) plus thin ridges (grid lines). `at(u, v)` reads the luma at position u along
 * the axis and v across it.
 */
function profile(at: (u: number, v: number) => number, n: number, v0: number, v1: number): Float64Array {
  const P = new Float64Array(n)
  for (let v = v0; v < v1; v++) {
    for (let u = 2; u < n - 2; u++) {
      const a2 = at(u - 2, v)
      const c = at(u, v)
      const b2 = at(u + 2, v)
      const ridge = Math.max(0, Math.min(a2, b2) - c, c - Math.max(a2, b2))
      P[u] += Math.abs(at(u + 1, v) - at(u - 1, v)) + 2 * ridge
    }
  }
  return P
}

/** Box smoothing of radius r. */
function smooth(P: Float64Array, r: number): Float64Array {
  const n = P.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    let c = 0
    for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) {
      s += P[k]
      c++
    }
    out[i] = s / c
  }
  return out
}

function fitAxis(at: (u: number, v: number) => number, n: number, b0: number, b1: number, v0: number, v1: number, count: number): AxisResult | null {
  const width = b1 - b0
  const nominal = width / count
  const pHi = width / (count - 2 * OVERHANG)
  const pLo = Math.max(3, MIN_FILL * nominal)
  if (pLo >= pHi || n < 8) return null
  const r = Math.max(1, Math.round(nominal / 8))
  const S = smooth(profile(at, n, v0, v1), r)
  const value = (x: number) => {
    const f = x - 0.5
    if (f <= 0) return S[0]
    if (f >= n - 1) return S[n - 1]
    const i = Math.floor(f)
    return S[i] + (f - i) * (S[i + 1] - S[i])
  }
  const score = (s: number, p: number) => {
    let on = 0
    let off = 0
    for (let k = 0; k <= count; k++) on += value(s + k * p)
    for (let k = 0; k < count; k++) off += value(s + (k + 0.5) * p)
    return on / (count + 1) - off / count
  }
  const startRange = (p: number): [number, number] => [b0 - OVERHANG * p, b1 + OVERHANG * p - count * p]

  // Coarse: pitch steps that move the far end of the lattice by about the smoothing radius.
  let dp = r / count
  let ds = Math.max(1, r / 2)
  const work = ((pHi - pLo) / dp) * (((1 - MIN_FILL) * width + 2 * OVERHANG * pHi) / ds) * (2 * count + 1)
  if (work > MAX_WORK) {
    const grow = Math.sqrt(work / MAX_WORK)
    dp *= grow
    ds *= grow
  }
  let best = { s: b0, p: nominal, v: -Infinity }
  for (let p = pLo; p <= pHi; p += dp) {
    const [sLo, sHi] = startRange(p)
    for (let s = sLo; s <= sHi; s += ds) {
      const v = score(s, p)
      if (v > best.v) best = { s, p, v }
    }
  }
  // Fine: around the best placement, a tenth of the coarse steps.
  for (let round = 0; round < 2; round++) {
    const center = { ...best }
    const fdp = dp / 10
    const fds = ds / 10
    for (let i = -12; i <= 12; i++) {
      const p = center.p + i * fdp
      if (p < pLo || p > pHi) continue
      for (let j = -12; j <= 12; j++) {
        const s = center.s + j * fds
        const v = score(s, p)
        if (v > best.v) best = { s, p, v }
      }
    }
    dp /= 10
    ds /= 10
  }

  // Confidence: how much the lines stand out from the cell middles, and how many of them do. Lines
  // through a uniform area (a band of blank cells whose faint lines vanished in the blur) carry no
  // evidence either way and are left out of the count, as long as most lines are active.
  const lineValues = Array.from({ length: count + 1 }, (_, k) => value(best.s + k * best.p))
  const midValues = Array.from({ length: count }, (_, k) => value(best.s + (k + 0.5) * best.p))
  const floor = midValues.slice().sort((a, b) => a - b)[Math.floor(0.1 * (count - 1))]
  const excess = lineValues.map((v) => v - floor).sort((a, b) => a - b)
  const typical = excess[excess.length >> 1]
  let on = 0
  let off = 0
  let active = 0
  let beat = 0
  for (let k = 0; k <= count; k++) {
    const line = lineValues[k]
    on += line
    const neighbour = Math.max(k > 0 ? midValues[k - 1] : -Infinity, k < count ? midValues[k] : -Infinity)
    if (Math.max(line, neighbour) - floor < SILENT * typical) continue
    active++
    if (line > neighbour) beat++
  }
  for (const v of midValues) off += v
  on /= count + 1
  off /= count
  const contrast = on > 0 ? (on - off) / on : 0
  const lines = active ? beat / active : 0
  const confident = contrast >= MIN_CONTRAST && lines >= MIN_LINES && active >= MIN_ACTIVE * (count + 1)
  const confidence = confident ? Math.min(1, contrast) * lines : 0
  return { axis: { start: best.s, pitch: best.p, count }, confidence }
}

/**
 * A lattice of exactly `cols` x `rows` cells fitted inside `box` of the luma image `L`, with its
 * confidence (0 when the lines do not stand out from the cell middles on either axis), or null when
 * the box is too small for those counts.
 */
export function fitKnownCounts(L: Float32Array, w: number, h: number, box: Box, cols: number, rows: number): DetectedGrid | null {
  const x = fitAxis((u, v) => L[v * w + u], w, box.x, box.x + box.width, box.y, box.y + box.height, cols)
  const y = fitAxis((u, v) => L[u * w + v], h, box.y, box.y + box.height, box.x, box.x + box.width, rows)
  if (!x || !y) return null
  return { x: x.axis, y: y.axis, confidence: Math.min(x.confidence, y.confidence) }
}
