
/** One axis of a regular grid, in source-pixel coordinates. */
export interface GridAxis {
  /** Leading edge of cell 0 (left / top): the centre of the grid line before it. */
  start: number
  /** Cell size in pixels (fractional). */
  pitch: number
  /** Number of cells. */
  count: number
}

/**
 * The lattice nodes of a grid that is not straight (a photo: rotation, perspective, bent lines).
 * Node (r, c), r in 0..y.count and c in 0..x.count, is the corner where horizontal line r meets
 * vertical line c, at index r * (x.count + 1) + c, in source-pixel coordinates.
 */
export interface GridMesh {
  x: number[]
  y: number[]
}

export interface DetectedGrid {
  /** For a mesh grid: the straight lattice that best approximates it (start and pitch averaged over the lines). */
  x: GridAxis
  y: GridAxis
  /** 0..1 */
  confidence: number
  /** Present when the grid was found in a photo and is not a straight lattice; sample cells through it. */
  mesh?: GridMesh
  /** Rotation of the grid in degrees (positive: clockwise on screen), when it was measured. */
  angle?: number
}

/** Evidence is accumulated in bands of this many pixels across the other axis. */
export const BAND = 8
const MIN_PITCH = 4
const MIN_CELLS = 3
/** A grid line may be invisible (e.g. between two filled cells) for at most this many lattice steps in a row. */
const MAX_GAP = 3
/** Coverage support: a line must show evidence in at least 75% of the bands across the grid (text does not). */
const COVERAGE_QUANTILE = 0.25
/** In a photo, lines between two filled cells often vanish in the blur: there a line needs evidence in 40% of the bands. */
const PHOTO_COVERAGE_QUANTILE = 0.6
/** In a photo a line is strong at this fraction of the typical support (0.35 for screenshots): moiré and page texture around the chart stay out. */
const PHOTO_STRONG = 0.5
/** An outer row or column of a photo lattice is kept when its crossing lines show at this fraction of their median support. */
const TRIM_SUPPORT = 0.5
/** The background evidence around a line: this quantile of the evidence across its cell. */
const BASELINE_QUANTILE = 0.3
/** At most this many evenly spaced samples estimate that background. */
const MAX_WINDOW = 24
/** Half-length of the smoothing along a line's direction. */
const SMOOTH = 2
/** Luma contrast at which a pixel's line evidence reaches one half. */
const SATURATION = 24
/** Saturated evidence per pixel below which a line is not a line, whatever its neighbours. */
const MIN_EVIDENCE_PER_PIXEL = 0.06
const MIN_CONFIDENCE = 0.45
/** Largest accepted ratio between the cell width and height. */
const MAX_ASPECT = 2
/** Radius of the local mean that tells a grid line from the centre of a blurred cell. */
const MEAN_RADIUS = 10
/** How far (relative to the ridge's own depth) the sides of a gated ridge may sit on its side of the mean: blur darkens a line's sides too. */
const GATE = 0.35

/** Per-axis accumulators. `ev` is band-major: index = band * n + position. */
export interface AxisData {
  n: number
  bands: number
  /** Pixels across the other axis covered by each band. */
  bandSize: Uint16Array
  ev: Float32Array
}

interface AxisFit {
  start: number
  pitch: number
  count: number
  confidence: number
}

/**
 * Line evidence at a pixel from its neighbours along one direction: a thin line darker or lighter
 * than both sides two pixels away (ridge), or a colour step concentrated on this pixel (the edge
 * between two differently coloured cells). Plain edges produce no ridge, flat areas nothing.
 *
 * With `gated`, `m` is the local mean luma. Grid lines are the minority pixels around them, so their
 * sides (the cells) lie on the far side of the mean: a dark ridge only counts when its sides are
 * lighter than the mean (up to GATE of its depth), a light ridge when they are darker. In a blurred photo the centre of a cell is a ridge
 * too (a white cell becomes a light bump between two dark lines); its sides are on the same side
 * as itself, so it is ignored and the lattice does not read at half its pitch.
 */
function lineEvidence(a2: number, a1: number, c: number, b1: number, b2: number, m: number, gated: boolean): number {
  const lo = a2 < b2 ? a2 : b2
  const hi = a2 < b2 ? b2 : a2
  let e = !gated || m - lo < GATE * (m - c) ? lo - c : 0
  const light = !gated || hi - m < GATE * (c - m) ? c - hi : 0
  if (light > e) e = light
  // Gated (photos): a blurred edge is a ramp, which the plain test reads as a step on every pixel;
  // only a step much steeper here than on either side counts.
  const step = Math.abs(b2 - a2) - (gated ? 2 : 1) * (Math.abs(b2 - b1) + Math.abs(a1 - a2))
  if (step > e) e = step
  // Saturate: what matters is that a line is there, not its contrast, so faint lines on paper
  // count nearly as much as strong ink/paper edges.
  return e > 0 ? e / (e + SATURATION) : 0
}

/** Mean of `L` over a (2r+1)^2 window, edges replicated (separable running sums). */
export function boxMean(L: Float32Array, w: number, h: number, r: number): Float32Array {
  const taps = 2 * r + 1
  const tmp = new Float32Array(w * h)
  for (let yy = 0; yy < h; yy++) {
    const row = yy * w
    let s = 0
    for (let k = -r; k <= r; k++) s += L[row + Math.min(w - 1, Math.max(0, k))]
    for (let xx = 0; xx < w; xx++) {
      tmp[row + xx] = s / taps
      s += L[row + Math.min(w - 1, xx + r + 1)] - L[row + Math.max(0, xx - r)]
    }
  }
  const out = new Float32Array(w * h)
  const acc = new Float64Array(w)
  for (let k = -r; k <= r; k++) {
    const src = Math.min(h - 1, Math.max(0, k)) * w
    for (let xx = 0; xx < w; xx++) acc[xx] += tmp[src + xx]
  }
  for (let yy = 0; yy < h; yy++) {
    const out0 = yy * w
    const add = Math.min(h - 1, yy + r + 1) * w
    const drop = Math.max(0, yy - r) * w
    for (let xx = 0; xx < w; xx++) {
      out[out0 + xx] = acc[xx] / taps
      acc[xx] += tmp[add + xx] - tmp[drop + xx]
    }
  }
  return out
}

export function computeEvidence(L: Float32Array, w: number, h: number, gated: boolean): { x: AxisData; y: AxisData } {
  const rowBands = Math.ceil(h / BAND)
  const colBands = Math.ceil(w / BAND)
  const x: AxisData = { n: w, bands: rowBands, bandSize: new Uint16Array(rowBands), ev: new Float32Array(rowBands * w) }
  const y: AxisData = { n: h, bands: colBands, bandSize: new Uint16Array(colBands), ev: new Float32Array(colBands * h) }
  for (let b = 0; b < rowBands; b++) x.bandSize[b] = Math.min(BAND, h - b * BAND)
  for (let b = 0; b < colBands; b++) y.bandSize[b] = Math.min(BAND, w - b * BAND)

  // Smooth along each line direction before differencing across it: lines keep their profile, noise
  // drops by about half. Lv averages rows (for vertical lines), Lh averages columns.
  const taps = 2 * SMOOTH + 1
  const Lv = new Float32Array(w * h)
  const acc = new Float64Array(w)
  for (let k = -SMOOTH; k <= SMOOTH; k++) {
    const src = Math.min(h - 1, Math.max(0, k)) * w
    for (let xx = 0; xx < w; xx++) acc[xx] += L[src + xx]
  }
  for (let yy = 0; yy < h; yy++) {
    const out = yy * w
    const add = Math.min(h - 1, yy + SMOOTH + 1) * w
    const drop = Math.max(0, yy - SMOOTH) * w
    for (let xx = 0; xx < w; xx++) {
      Lv[out + xx] = acc[xx] / taps
      acc[xx] += L[add + xx] - L[drop + xx]
    }
  }
  const Lh = new Float32Array(w * h)
  for (let yy = 0; yy < h; yy++) {
    const row = yy * w
    let s = 0
    for (let k = -SMOOTH; k <= SMOOTH; k++) s += L[row + Math.min(w - 1, Math.max(0, k))]
    for (let xx = 0; xx < w; xx++) {
      Lh[row + xx] = s / taps
      s += L[row + Math.min(w - 1, xx + SMOOTH + 1)] - L[row + Math.max(0, xx - SMOOTH)]
    }
  }

  const M = gated ? boxMean(L, w, h, MEAN_RADIUS) : L

  // The y evidence is accumulated row by row in (row, column band) order, then transposed.
  const xev = x.ev
  const tev = new Float32Array(h * colBands)
  for (let yy = 0; yy < h; yy++) {
    const row = yy * w
    const xb = (yy >> 3) * w
    for (let xx = 2; xx < w - 2; xx++) {
      const p = row + xx
      xev[xb + xx] += lineEvidence(Lv[p - 2], Lv[p - 1], Lv[p], Lv[p + 1], Lv[p + 2], M[p], gated)
    }
    if (yy >= 2 && yy < h - 2) {
      const tb = yy * colBands
      const r2 = row - 2 * w
      const r1 = row - w
      const s1 = row + w
      const s2 = row + 2 * w
      for (let xx = 0; xx < w; xx++) {
        tev[tb + (xx >> 3)] += lineEvidence(Lh[r2 + xx], Lh[r1 + xx], Lh[row + xx], Lh[s1 + xx], Lh[s2 + xx], M[row + xx], gated)
      }
    }
  }
  for (let yy = 0; yy < h; yy++) for (let b = 0; b < colBands; b++) y.ev[b * h + yy] = tev[yy * colBands + b]
  return { x, y }
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

/** The q-quantile of the first `len` values of `buf`, sorting them in place (insertion sort: short runs). */
function quantile(buf: Float64Array, len: number, q: number): number {
  for (let i = 1; i < len; i++) {
    const v = buf[i]
    let j = i - 1
    while (j >= 0 && buf[j] > v) {
      buf[j + 1] = buf[j]
      j--
    }
    buf[j + 1] = v
  }
  return buf[Math.floor(q * (len - 1))]
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid])
}

interface LineFit {
  a: number
  b: number
  rms: number
  used: number
}

/** Least squares `pos = a + b * k` over the given lines, discarding outliers once. */
function fitLines(ks: number[], pos: Float64Array, pitch: number): LineFit | null {
  let use = ks.slice()
  let result: LineFit | null = null
  for (let round = 0; round < 3; round++) {
    if (use.length < 2) return result
    let sk = 0
    let sp = 0
    for (const k of use) {
      sk += k
      sp += pos[k]
    }
    const mk = sk / use.length
    const mp = sp / use.length
    let num = 0
    let den = 0
    for (const k of use) {
      num += (k - mk) * (pos[k] - mp)
      den += (k - mk) ** 2
    }
    if (den === 0) return result
    const b = num / den
    const a = mp - b * mk
    let ss = 0
    for (const k of use) ss += (pos[k] - a - b * k) ** 2
    result = { a, b, rms: Math.sqrt(ss / use.length), used: use.length }
    const limit = Math.max(0.75, 0.12 * pitch)
    const kept = use.filter((k) => Math.abs(pos[k] - a - b * k) <= limit)
    if (kept.length === use.length) break
    use = kept
  }
  return result
}

/**
 * Finds the lattice along one axis using the bands [b0, b1) across the other axis. With `coverage`,
 * a line only counts when it shows up across most of those bands, which rejects axis numbers,
 * markers and watermarks that happen to sit on the lattice.
 */
function analyzeAxis(d: AxisData, b0: number, b1: number, coverage: boolean, hint?: number, photo = false): AxisFit | null {
  const n = d.n
  if (n < MIN_CELLS * MIN_PITCH + 6 || b1 <= b0) return null

  const P = new Float64Array(n)
  for (let b = b0; b < b1; b++) {
    const off = b * n
    for (let i = 0; i < n; i++) P[i] += d.ev[off + i]
  }
  // Top-hat: keep only features narrower than 9 px (lines), drop slow variations.
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

  // Pitch: the first strong autocorrelation peak, then refined on its multiples.
  let mean = 0
  for (let i = 0; i < n; i++) mean += S[i]
  mean /= n
  const Z = new Float64Array(n)
  for (let i = 0; i < n; i++) Z[i] = S[i] - mean
  const maxLag = n >> 1
  const A = new Float64Array(maxLag + 2)
  for (let l = 0; l < A.length; l++) {
    let acc = 0
    for (let i = 0, j = l; j < n; i++, j++) acc += Z[i] * Z[j]
    A[l] = acc
  }
  if (A[0] <= 0) return null
  const lagLimit = Math.min(maxLag, Math.floor(n / MIN_CELLS))
  let best = 0
  for (let l = MIN_PITCH; l <= lagLimit; l++) if (A[l] > best) best = A[l]
  if (best <= 0) return null
  let lag = -1
  if (hint !== undefined) {
    // Known pitch: the strongest peak near it.
    for (let l = Math.max(MIN_PITCH, Math.floor(0.8 * hint)); l <= Math.min(lagLimit, Math.ceil(1.25 * hint)); l++) {
      if (A[l] >= A[l - 1] && A[l] > A[l + 1] && A[l] > 0 && (lag < 0 || A[l] > A[lag])) lag = l
    }
  } else {
    for (let l = MIN_PITCH; l <= lagLimit; l++) {
      if (A[l] >= 0.35 * best && A[l] >= A[l - 1] && A[l] > A[l + 1]) {
        lag = l
        break
      }
    }
  }
  if (lag < 0) return null
  let pitch = lag + parabolic(A, lag)
  const baseLevel = A[lag] / (n - lag)
  for (let m = 2; m * pitch + 3 <= maxLag; m *= 2) {
    const target = Math.round(m * pitch)
    let pick = -1
    for (let l = target - 2; l <= target + 2; l++) {
      if (l < 1 || l > maxLag) continue
      if (A[l] >= A[l - 1] && A[l] > A[l + 1] && (pick < 0 || A[l] > A[pick])) pick = l
    }
    if (pick < 0 || A[pick] / (n - pick) < 0.25 * baseLevel) break
    pitch = (pick + parabolic(A, pick)) / m
  }
  const rho = Math.max(A[Math.floor(pitch)], A[Math.ceil(pitch)]) / A[0]

  // Phase: where the evidence concentrates modulo the pitch.
  const nb = Math.max(16, Math.ceil(pitch * 4))
  const hist = new Float64Array(nb)
  for (let i = 0; i < n; i++) {
    if (S[i] <= 0) continue
    const bin = Math.floor((((i + 0.5) % pitch) / pitch) * nb) % nb
    hist[bin] += S[i]
  }
  let peakBin = 0
  let peakVal = -1
  for (let j = 0; j < nb; j++) {
    const v = hist[(j + nb - 1) % nb] + 2 * hist[j] + hist[(j + 1) % nb]
    if (v > peakVal) {
      peakVal = v
      peakBin = j
    }
  }
  let phase = ((peakBin + 0.5) / nb) * pitch
  {
    let acc = 0
    let wsum = 0
    for (let i = 0; i < n; i++) {
      if (S[i] <= 0) continue
      let delta = (i + 0.5 - phase) % pitch
      if (delta < -pitch / 2) delta += pitch
      if (delta >= pitch / 2) delta -= pitch
      if (Math.abs(delta) < pitch / 6) {
        acc += S[i] * delta
        wsum += S[i]
      }
    }
    if (wsum > 0) phase += acc / wsum
  }

  // Locate each lattice line near its predicted position.
  const first = Math.ceil((1.5 - phase) / pitch)
  const last = Math.floor((n - 2.5 - phase) / pitch)
  const K = last - first + 1
  if (K < MIN_CELLS + 1) return null
  const pos = new Float64Array(K)
  const locate = (c: number, radius: number) => {
    const ci = Math.round(c - 0.5)
    let im = -1
    for (let i = Math.max(1, ci - radius); i <= Math.min(n - 2, ci + radius); i++) if (im < 0 || S[i] > S[im]) im = i
    return im < 0 ? c : im + 0.5 + parabolic(S, im)
  }
  const radius = Math.max(1, Math.round(0.25 * pitch))
  for (let k = 0; k < K; k++) pos[k] = locate(phase + (first + k) * pitch, radius)

  // Support of each line.
  const support = new Float64Array(K)
  let perPixel: number
  if (!coverage) {
    let rows = 0
    for (let b = b0; b < b1; b++) rows += d.bandSize[b]
    for (let k = 0; k < K; k++) support[k] = S[Math.min(n - 1, Math.max(0, Math.round(pos[k] - 0.5)))]
    perPixel = rows
  } else {
    // Per band: the peak near the line above a low percentile of the cell around it.
    const bands = b1 - b0
    perPixel = BAND
    const values = new Float64Array(bands)
    const win = new Float64Array(MAX_WINDOW)
    for (let k = 0; k < K; k++) {
      const xi = Math.round(pos[k] - 0.5)
      const lo = Math.max(0, Math.round(pos[k] - pitch / 2 - 0.5))
      const hi = Math.min(n - 1, Math.round(pos[k] + pitch / 2 - 0.5))
      const len = Math.min(MAX_WINDOW, hi - lo + 1)
      const step = (hi - lo + 1) / len
      for (let g = 0; g < bands; g++) {
        const off = (b0 + g) * n
        let peak = -Infinity
        for (let i = xi - 1; i <= xi + 1; i++) if (i >= 0 && i < n && d.ev[off + i] > peak) peak = d.ev[off + i]
        for (let i = 0; i < len; i++) win[i] = d.ev[off + lo + Math.floor(i * step)]
        const base = quantile(win, len, BASELINE_QUANTILE)
        values[g] = (peak - base) * (BAND / d.bandSize[b0 + g])
      }
      values.sort()
      support[k] = values[Math.floor((photo ? PHOTO_COVERAGE_QUANTILE : COVERAGE_QUANTILE) * bands)]
    }
  }
  let smax = 0
  for (let k = 0; k < K; k++) if (support[k] > smax) smax = support[k]
  if (smax <= 0) return null
  const ref = median(Array.from(support).filter((s) => s >= 0.15 * smax))
  // Summed support may come from a grid covering only part of the bands, hence the lower floor.
  const threshold = Math.max((photo ? PHOTO_STRONG : 0.35) * ref, MIN_EVIDENCE_PER_PIXEL * perPixel * (coverage ? 1 : 0.25))
  const strong = Array.from(support, (s) => s >= threshold)

  // Extent: the run of lattice positions with the most strong lines, gaps of up to MAX_GAP allowed.
  let bestStart = -1
  let bestEnd = -1
  let bestCount = 0
  let runStart = -1
  let lastStrong = -1
  let runCount = 0
  const close = () => {
    if (runStart >= 0 && (runCount > bestCount || (runCount === bestCount && lastStrong - runStart > bestEnd - bestStart))) {
      bestStart = runStart
      bestEnd = lastStrong
      bestCount = runCount
    }
  }
  for (let k = 0; k < K; k++) {
    if (!strong[k]) continue
    if (runStart >= 0 && k - lastStrong - 1 > MAX_GAP) {
      close()
      runStart = -1
    }
    if (runStart < 0) {
      runStart = k
      runCount = 0
    }
    lastStrong = k
    runCount++
  }
  close()
  if (bestStart < 0 || bestEnd - bestStart < MIN_CELLS) return null

  const used: number[] = []
  for (let k = bestStart; k <= bestEnd; k++) if (strong[k]) used.push(k)
  let fit = fitLines(used, pos, pitch)
  if (!fit) return null
  // Re-locate every line near the fitted lattice with a tighter window, then fit again.
  const tight = Math.max(1, Math.round(0.15 * fit.b))
  for (const k of used) pos[k] = locate(fit.a + fit.b * k, tight)
  fit = fitLines(used, pos, fit.b) ?? fit

  const count = bestEnd - bestStart
  const strongFraction = fit.used / (count + 1)
  const regularity = Math.max(0, 1 - fit.rms / (0.12 * fit.b))
  const periodicity = Math.max(0, Math.min(1, rho / 0.3))
  const confidence = strongFraction * (0.4 + 0.6 * regularity) * periodicity
  return { start: fit.a + fit.b * bestStart, pitch: fit.b, count, confidence }
}

/** Bands across this axis that lie inside the fitted extent (at least one). */
function bandRange(fit: AxisFit, bands: number): [number, number] {
  const lo = fit.start + 0.25 * fit.pitch
  const hi = fit.start + (fit.count - 0.25) * fit.pitch
  let b0 = Math.ceil(lo / BAND - 0.5)
  let b1 = Math.floor(hi / BAND - 0.5) + 1
  b0 = Math.max(0, Math.min(bands - 1, b0))
  b1 = Math.max(b0 + 1, Math.min(bands, b1))
  return [b0, b1]
}

/**
 * Drops outer rows and columns of a photo lattice that are page, not chart. Moiré bands and page
 * texture can carry one family of lines past the chart; a row of cells belongs to the chart when the
 * other family (its vertical lines) shows inside it, or when it is mostly dark (a solid row of ink
 * hides its lines in the blur). Columns likewise.
 */
function trimMargins(L: Float32Array, w: number, h: number, ev: { x: AxisData; y: AxisData }, x: AxisFit, y: AxisFit): [AxisFit, AxisFit] | null {
  const lumas: number[] = []
  for (let r = 0; r < y.count; r += 2) {
    const yy = Math.min(h - 1, Math.max(0, Math.round(y.start + (r + 0.5) * y.pitch - 0.5)))
    for (let c = 0; c < x.count; c += 2) lumas.push(L[yy * w + Math.min(w - 1, Math.max(0, Math.round(x.start + (c + 0.5) * x.pitch - 0.5)))])
  }
  lumas.sort((a, b) => a - b)
  const dark = 0.5 * (lumas[Math.floor(0.1 * (lumas.length - 1))] + lumas[Math.floor(0.9 * (lumas.length - 1))])
  const clampIndex = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.round(v - 0.5)))
  // Per cell row: vertical-line support (evidence on the lines minus mid-cell) and the dark fraction.
  const profile = (along: AxisFit, across: AxisFit, d: AxisData, n: number, pixel: (a: number, b: number) => number) => {
    const support: number[] = []
    const darkness: number[] = []
    for (let r = 0; r < across.count; r++) {
      const centre = across.start + (r + 0.5) * across.pitch
      const b = Math.min(d.bands - 1, Math.max(0, Math.floor(centre / BAND)))
      let sup = 0
      let darkCount = 0
      for (let k = 0; k < along.count; k++) {
        const line = clampIndex(along.start + k * along.pitch, n)
        const mid = clampIndex(along.start + (k + 0.5) * along.pitch, n)
        sup += d.ev[b * n + line] - d.ev[b * n + mid]
        if (pixel(along.start + (k + 0.5) * along.pitch, centre) < dark) darkCount++
      }
      support.push(sup)
      darkness.push(darkCount / along.count)
    }
    const sorted = support.slice().sort((a, b) => a - b)
    const floor = TRIM_SUPPORT * sorted[sorted.length >> 1]
    const keep = support.map((v, i) => v >= floor || darkness[i] >= 0.3)
    let a = 0
    while (a < keep.length && !keep[a]) a++
    let b = keep.length - 1
    while (b > a && !keep[b]) b--
    return [a, b] as const
  }
  const at = (px: number, py: number) => L[clampIndex(py, h) * w + clampIndex(px, w)]
  const [r0, r1] = profile(x, y, ev.x, w, at)
  const [c0, c1] = profile(y, x, ev.y, h, (py, px) => at(px, py))
  if (r1 - r0 + 1 < MIN_CELLS || c1 - c0 + 1 < MIN_CELLS) return null
  return [
    { ...x, start: x.start + c0 * x.pitch, count: c1 - c0 + 1 },
    { ...y, start: y.start + r0 * y.pitch, count: r1 - r0 + 1 },
  ]
}

/**
 * A straight, axis-aligned lattice in a luma image, or null. `gated` selects the line evidence of
 * blurred photos (see lineEvidence); `hint` is the expected pitch along both axes when it is known
 * (a rectified photo), which keeps moiré and half-pitch echoes from being taken for the lattice.
 */
export function detectStraight(L: Float32Array, w: number, h: number, gated: boolean, hint?: number): DetectedGrid | null {
  if (w < 16 || h < 16) return null
  const ev = computeEvidence(L, w, h, gated)
  let x = analyzeAxis(ev.x, 0, ev.x.bands, false, hint)
  let y = analyzeAxis(ev.y, 0, ev.y.bands, false, hint)
  if (!x || !y) return null
  for (let pass = 0; pass < 2; pass++) {
    const [r0, r1] = bandRange(y, ev.x.bands)
    x = analyzeAxis(ev.x, r0, r1, true, hint, gated)
    if (!x) return null
    const [c0, c1] = bandRange(x, ev.y.bands)
    y = analyzeAxis(ev.y, c0, c1, true, hint, gated)
    if (!y) return null
  }
  if (gated) {
    const trimmed = trimMargins(L, w, h, ev, x, y)
    if (!trimmed) return null
    ;[x, y] = trimmed
  }
  const confidence = Math.min(x.confidence, y.confidence)
  if (confidence < MIN_CONFIDENCE) return null
  // Chart cells are square or close to it; a lattice of much longer cells is text or texture.
  if (Math.max(x.pitch, y.pitch) > MAX_ASPECT * Math.min(x.pitch, y.pitch)) return null
  return {
    x: { start: x.start, pitch: x.pitch, count: x.count },
    y: { start: y.start, pitch: y.pitch, count: y.count },
    confidence,
  }
}
