import { BAND, computeEvidence, detectStraight, type AxisData, type DetectedGrid } from './grid'

/**
 * Grids in photos of screens and prints: rotated, in mild perspective, with a pitch that drifts
 * across the chart and lines that bend a little. Each family of grid lines is modelled as a smooth
 * polynomial `position = f(line index, coordinate along the line)`, fitted to line evidence measured
 * in strips across the image. The luma is then resampled through both families into a straight
 * lattice, where the regular detector decides the extent and the confidence (so a photo without a
 * grid is still rejected the same way), and the lattice found there is mapped back to the photo.
 */

/** Largest line slope searched (dx/dy for vertical lines): about 9 degrees. */
const MAX_SLOPE = 0.16
const COARSE_STEP = 0.008
const FINE_STEP = 0.002
const MIN_PITCH = 4
/** Lines of the straight lattice kept around the fitted ones when resampling. */
const MARGIN = 2
/** Polynomial terms, in order of use: 1, k, t, k^2, kt, k^3, k^2 t, t^2, k t^2. */
const TERMS = 9
/** A measured line counts when its evidence reaches this fraction of the median measurement. */
const MEASURE_FLOOR = 0.3
/** Accepted distance between a measured line and the model, relative to the local pitch. */
const MAX_RESIDUAL = 0.18

interface AxisModel {
  coef: Float64Array
  terms: number
  /** Normalisation: k / kScale, (t - tc) / tScale. */
  kScale: number
  tScale: number
  tc: number
  /** Range of line indices that were measured. */
  kLo: number
  kHi: number
  pitch: number
  slope: number
}

function basis(k: number, t: number, m: AxisModel, out: Float64Array): void {
  const a = k / m.kScale
  const b = (t - m.tc) / m.tScale
  out[0] = 1
  out[1] = a
  out[2] = b
  out[3] = a * a
  out[4] = a * b
  out[5] = a * a * a
  out[6] = a * a * b
  out[7] = b * b
  out[8] = a * b * b
}

const scratch = new Float64Array(TERMS)
function evaluate(m: AxisModel, k: number, t: number): number {
  basis(k, t, m, scratch)
  let v = 0
  for (let i = 0; i < m.terms; i++) v += m.coef[i] * scratch[i]
  return v
}

/** Centre coordinate (across the axis) of band b. */
function bandCentre(d: AxisData, b: number): number {
  return b * BAND + d.bandSize[b] / 2
}

/** Sum of the evidence of bands [b0, b1), each shifted along the axis by `slope * (centre - tc)`. */
function sheared(d: AxisData, b0: number, b1: number, slope: number, tc: number, out: Float64Array): Float64Array {
  const n = d.n
  out.fill(0)
  for (let b = b0; b < b1; b++) {
    const shift = slope * (bandCentre(d, b) - tc)
    const fi = Math.floor(shift)
    const fr = shift - fi
    const off = b * n
    const lo = Math.max(0, -fi)
    const hi = Math.min(n, n - fi - 1)
    for (let i = lo; i < hi; i++) out[i] += d.ev[off + i + fi] * (1 - fr) + d.ev[off + i + fi + 1] * fr
  }
  return out
}

/** Top-hat (keeps features narrower than 9 px) followed by a [1 2 1] smoothing. */
function lineProfile(P: Float64Array): Float64Array {
  const n = P.length
  const T = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let m = P[i]
    const lo = i - 4 < 0 ? 0 : i - 4
    const hi = i + 4 >= n ? n - 1 : i + 4
    for (let k = lo; k <= hi; k++) if (P[k] < m) m = P[k]
    T[i] = P[i] - m
  }
  const S = new Float64Array(n)
  for (let i = 0; i < n; i++) S[i] = 0.25 * T[i > 0 ? i - 1 : 0] + 0.5 * T[i] + 0.25 * T[i < n - 1 ? i + 1 : n - 1]
  return S
}

/** The common slope of the lines along this axis: the shear that makes their profile sharpest. */
function bestSlope(d: AxisData): number {
  const tc = (d.bands * BAND) / 2
  const buf = new Float64Array(d.n)
  const score = (s: number) => {
    const S = lineProfile(sheared(d, 0, d.bands, s, tc, buf))
    let e = 0
    for (let i = 0; i < S.length; i++) e += S[i] * S[i]
    return e
  }
  let best = 0
  let bestScore = -1
  for (let s = -MAX_SLOPE; s <= MAX_SLOPE + 1e-9; s += COARSE_STEP) {
    const v = score(s)
    if (v > bestScore) {
      bestScore = v
      best = s
    }
  }
  const centre = best
  for (let s = centre - COARSE_STEP; s <= centre + COARSE_STEP + 1e-9; s += FINE_STEP) {
    const v = score(s)
    if (v > bestScore) {
      bestScore = v
      best = s
    }
  }
  return best
}

/** Sub-sample offset of a peak at `i` by fitting a parabola through its neighbours. */
function parabolic(v: ArrayLike<number>, i: number): number {
  if (i <= 0 || i >= v.length - 1) return 0
  const a = v[i - 1]
  const b = v[i]
  const c = v[i + 1]
  const den = a - 2 * b + c
  if (den >= 0) return 0
  const d = (0.5 * (a - c)) / den
  return d > 0.5 ? 0.5 : d < -0.5 ? -0.5 : d
}

/** Lattice pitch from the autocorrelation of a line profile: the first strong peak in [minLag, maxLag]. */
function profilePitch(S: Float64Array, minLag: number, maxLag: number): number | null {
  const n = S.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += S[i]
  mean /= n
  const hiLag = Math.min(Math.floor(n / 3), Math.ceil(maxLag) + 1)
  const loLag = Math.max(MIN_PITCH, Math.floor(minLag))
  if (hiLag <= loLag + 1) return null
  const A = new Float64Array(hiLag + 2)
  for (let l = 0; l < A.length; l++) {
    let acc = 0
    for (let i = 0, j = l; j < n; i++, j++) acc += (S[i] - mean) * (S[j] - mean)
    A[l] = acc
  }
  let best = 0
  for (let l = loLag; l <= hiLag; l++) if (A[l] > best) best = A[l]
  if (best <= 0) return null
  for (let l = loLag; l <= hiLag; l++) {
    if (A[l] >= 0.35 * best && A[l] >= A[l - 1] && A[l] > A[l + 1]) return l + parabolic(A, l)
  }
  return null
}

/** Solves the symmetric system `M x = v` (size n, row-major) by Gaussian elimination with pivoting. */
function solve(M: Float64Array, v: Float64Array, n: number): Float64Array | null {
  const a = Float64Array.from(M)
  const b = Float64Array.from(v)
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[p * n + c])) p = r
    if (Math.abs(a[p * n + c]) < 1e-12) return null
    if (p !== c) {
      for (let k = 0; k < n; k++) [a[c * n + k], a[p * n + k]] = [a[p * n + k], a[c * n + k]]
      ;[b[c], b[p]] = [b[p], b[c]]
    }
    for (let r = c + 1; r < n; r++) {
      const f = a[r * n + c] / a[c * n + c]
      if (f === 0) continue
      for (let k = c; k < n; k++) a[r * n + k] -= f * a[c * n + k]
      b[r] -= f * b[c]
    }
  }
  const x = new Float64Array(n)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let k = r + 1; k < n; k++) s -= a[r * n + k] * x[k]
    x[r] = s / a[r * n + r]
  }
  return x
}

interface Measure {
  k: number
  t: number
  pos: number
  weight: number
}

/** Weighted least squares of the model's first `terms` coefficients, dropping outliers twice. */
function fitModel(m: AxisModel, data: Measure[], terms: number): boolean {
  let use = data
  const row = new Float64Array(TERMS)
  for (let round = 0; round < 3; round++) {
    if (use.length < terms * 2) return false
    const M = new Float64Array(terms * terms)
    const v = new Float64Array(terms)
    for (const d of use) {
      basis(d.k, d.t, m, row)
      for (let i = 0; i < terms; i++) {
        v[i] += d.weight * row[i] * d.pos
        for (let j = 0; j < terms; j++) M[i * terms + j] += d.weight * row[i] * row[j]
      }
    }
    for (let i = 0; i < terms; i++) M[i * terms + i] *= 1 + 1e-9
    const c = solve(M, v, terms)
    if (!c) return false
    m.coef.fill(0)
    m.coef.set(c)
    m.terms = terms
    const limit = Math.max(0.8, MAX_RESIDUAL * m.pitch)
    const kept = use.filter((d) => Math.abs(evaluate(m, d.k, d.t) - d.pos) <= limit)
    if (kept.length === use.length) break
    use = kept
  }
  return true
}

function median(values: number[]): number {
  if (!values.length) return 0
  const s = values.slice().sort((a, b) => a - b)
  return s[s.length >> 1]
}

/**
 * Fits the polynomial model of one family of lines. Starts with a straight lattice around the
 * centre of the evidence and grows outwards, refitting with more terms as more lines join, so that
 * a slowly drifting pitch is followed instead of losing count.
 */
function fitAxis(d: AxisData, pitchHint: number | null): AxisModel | null {
  const n = d.n
  const across = d.bands * BAND
  const slope = bestSlope(d)
  const tcAll = across / 2
  const all = lineProfile(sheared(d, 0, d.bands, slope, tcAll, new Float64Array(n)))
  const pitch = pitchHint === null ? profilePitch(all, MIN_PITCH, n / 3) : profilePitch(all, pitchHint / 1.5, pitchHint * 1.5)
  if (pitch === null || pitch < MIN_PITCH) return null

  // Strips across the axis, about three cells tall, each profile sheared about its own centre.
  const group = Math.max(2, Math.min(8, Math.round((3 * pitch) / BAND)))
  const strips: { t: number; S: Float64Array }[] = []
  for (let b0 = 0; b0 < d.bands; b0 += group) {
    const b1 = Math.min(d.bands, b0 + group)
    const t = (b0 * BAND + (b1 - 1) * BAND + d.bandSize[b1 - 1]) / 2
    strips.push({ t, S: lineProfile(sheared(d, b0, b1, slope, t, new Float64Array(n))) })
  }

  // Anchor: the strongest line near the centre of mass of the evidence.
  let mass = 0
  let moment = 0
  for (let i = 0; i < n; i++) {
    mass += all[i]
    moment += all[i] * (i + 0.5)
  }
  if (mass <= 0) return null
  const centre = moment / mass
  let im = -1
  for (let i = Math.max(1, Math.floor(centre - pitch)); i <= Math.min(n - 2, Math.ceil(centre + pitch)); i++) if (im < 0 || all[i] > all[im]) im = i
  if (im < 0) return null
  const anchor = im + 0.5 + parabolic(all, im)

  const model: AxisModel = {
    coef: new Float64Array(TERMS),
    terms: 3,
    kScale: Math.max(1, n / pitch / 2),
    tScale: Math.max(1, across / 2),
    tc: tcAll,
    kLo: 0,
    kHi: 0,
    pitch,
    slope,
  }
  model.coef[0] = anchor
  model.coef[1] = pitch * model.kScale
  model.coef[2] = slope * model.tScale

  const kMax = Math.ceil(n / pitch) + 2
  let measures: Measure[] = []
  for (let R = 4; ; R = Math.ceil(R * 1.5)) {
    const found: Measure[] = []
    for (let k = -Math.min(R, kMax); k <= Math.min(R, kMax); k++) {
      for (const s of strips) {
        const p = evaluate(model, k, s.t)
        if (!(p >= 2 && p <= n - 3)) continue
        const local = Math.abs(evaluate(model, k + 0.5, s.t) - evaluate(model, k - 0.5, s.t))
        const radius = Math.max(1, Math.round(0.3 * local))
        const c = Math.round(p - 0.5)
        let best = -1
        for (let i = Math.max(1, c - radius); i <= Math.min(n - 2, c + radius); i++) if (best < 0 || s.S[i] > s.S[best]) best = i
        if (best < 0 || s.S[best] <= 0) continue
        found.push({ k, t: s.t, pos: best + 0.5 + parabolic(s.S, best), weight: s.S[best] })
      }
    }
    const floor = MEASURE_FLOOR * median(found.map((f) => f.weight))
    measures = found.filter((f) => f.weight >= floor)
    const terms = R >= 24 ? 9 : R >= 12 ? 5 : 3
    if (!fitModel(model, measures, terms)) return null
    // A fit that collapsed or reversed the lattice is no fit.
    const p = evaluate(model, 0.5, tcAll) - evaluate(model, -0.5, tcAll)
    if (!(p > 0.7 * pitch && p < 1.4 * pitch)) return null
    if (R >= kMax) break
  }

  // Lines measured in enough strips mark the extent of the grid.
  const counts = new Map<number, number>()
  const limit = Math.max(0.8, MAX_RESIDUAL * pitch)
  for (const f of measures) if (Math.abs(evaluate(model, f.k, f.t) - f.pos) <= limit) counts.set(f.k, (counts.get(f.k) ?? 0) + 1)
  const need = Math.max(2, Math.ceil(0.25 * strips.length))
  let kLo = Infinity
  let kHi = -Infinity
  for (const [k, c] of counts) {
    if (c < need) continue
    kLo = Math.min(kLo, k)
    kHi = Math.max(kHi, k)
  }
  if (!(kHi - kLo >= 3)) return null
  model.kLo = kLo
  model.kHi = kHi
  return model
}

/** Lattice nodes where the lines of both families cross, for line indices [k0, k1] x [l0, l1]. */
function nodes(mx: AxisModel, my: AxisModel, k0: number, k1: number, l0: number, l1: number): { x: Float64Array; y: Float64Array; nk: number; nl: number } {
  const nk = k1 - k0 + 1
  const nl = l1 - l0 + 1
  const x = new Float64Array(nk * nl)
  const y = new Float64Array(nk * nl)
  for (let l = 0; l < nl; l++) {
    for (let k = 0; k < nk; k++) {
      let px = evaluate(mx, k0 + k, my.tc)
      let py = evaluate(my, l0 + l, px)
      for (let it = 0; it < 3; it++) {
        px = evaluate(mx, k0 + k, py)
        py = evaluate(my, l0 + l, px)
      }
      x[l * nk + k] = px
      y[l * nk + k] = py
    }
  }
  return { x, y, nk, nl }
}

/** Bilinear position at fractional node coordinates (fu, fv), extrapolating past the outer nodes. */
function meshPoint(m: { x: Float64Array; y: Float64Array; nk: number; nl: number }, fu: number, fv: number): [number, number] {
  const a = Math.max(0, Math.min(m.nk - 2, Math.floor(fu)))
  const b = Math.max(0, Math.min(m.nl - 2, Math.floor(fv)))
  const al = fu - a
  const be = fv - b
  const i = b * m.nk + a
  const j = i + m.nk
  const x = (1 - be) * ((1 - al) * m.x[i] + al * m.x[i + 1]) + be * ((1 - al) * m.x[j] + al * m.x[j + 1])
  const y = (1 - be) * ((1 - al) * m.y[i] + al * m.y[i + 1]) + be * ((1 - al) * m.y[j] + al * m.y[j + 1])
  return [x, y]
}

/** Luma at a continuous point (pixel centres at +0.5), bilinear, edges replicated. */
function sampleLuma(L: Float32Array, w: number, h: number, x: number, y: number): number {
  const fx = Math.max(0, Math.min(w - 1, x - 0.5))
  const fy = Math.max(0, Math.min(h - 1, y - 0.5))
  const x0 = Math.min(w - 2, Math.floor(fx))
  const y0 = Math.min(h - 2, Math.floor(fy))
  const ax = fx - x0
  const ay = fy - y0
  const i = y0 * w + x0
  return (1 - ay) * ((1 - ax) * L[i] + ax * L[i + 1]) + ay * ((1 - ax) * L[i + w] + ax * L[i + w + 1])
}

/** A grid in a photo (see the top of this file), or null. `L` is the luma of the image. */
export function detectWarped(L: Float32Array, w: number, h: number): DetectedGrid | null {
  if (w < 32 || h < 32) return null
  const ev = computeEvidence(L, w, h, true)
  let mx = fitAxis(ev.x, null)
  if (!mx) return null
  // Cells are close to square: the pitch across is searched near the pitch along, which keeps
  // horizontal moiré bands from being taken for the rows; then the columns are checked back.
  const my = fitAxis(ev.y, mx.pitch)
  if (!my) return null
  mx = fitAxis(ev.x, my.pitch) ?? mx

  const P = Math.max(8, Math.round(Math.max(mx.pitch, my.pitch)))
  const k0 = mx.kLo - MARGIN
  const k1 = mx.kHi + MARGIN
  const l0 = my.kLo - MARGIN
  const l1 = my.kHi + MARGIN
  if ((k1 - k0) * (l1 - l0) > 250 * 250) return null
  const mesh = nodes(mx, my, k0, k1, l0, l1)
  const W = (k1 - k0) * P
  const H = (l1 - l0) * P
  const R = new Float32Array(W * H)
  for (let v = 0; v < H; v++) {
    const fv = (v + 0.5) / P
    for (let u = 0; u < W; u++) {
      const [x, y] = meshPoint(mesh, (u + 0.5) / P, fv)
      R[v * W + u] = sampleLuma(L, w, h, x, y)
    }
  }
  const straight = detectStraight(R, W, H, true, P)
  if (!straight) return null

  const cols = straight.x.count
  const rows = straight.y.count
  const gx: number[] = []
  const gy: number[] = []
  for (let r = 0; r <= rows; r++) {
    const fv = (straight.y.start + r * straight.y.pitch) / P
    for (let c = 0; c <= cols; c++) {
      const [x, y] = meshPoint(mesh, (straight.x.start + c * straight.x.pitch) / P, fv)
      gx.push(x)
      gy.push(y)
    }
  }
  let left = 0
  let right = 0
  for (let r = 0; r <= rows; r++) {
    left += gx[r * (cols + 1)]
    right += gx[r * (cols + 1) + cols]
  }
  let top = 0
  let bottom = 0
  for (let c = 0; c <= cols; c++) {
    top += gy[c]
    bottom += gy[rows * (cols + 1) + c]
  }
  left /= rows + 1
  right /= rows + 1
  top /= cols + 1
  bottom /= cols + 1
  return {
    x: { start: left, pitch: (right - left) / cols, count: cols },
    y: { start: top, pitch: (bottom - top) / rows, count: rows },
    confidence: straight.confidence,
    mesh: { x: gx, y: gy },
    angle: (Math.atan((my.slope - mx.slope) / 2) * 180) / Math.PI,
  }
}
