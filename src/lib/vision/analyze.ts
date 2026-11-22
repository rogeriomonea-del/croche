import { classifyCells } from './classify'
import { fitKnownCounts } from './counts'
import { detectGridOpaque } from './detect'
import { type DetectedGrid, type GridMesh } from './grid'
import { assertImage, findContentBox, luminance, opaque, type Box, type RgbaImage } from './image'

export interface AnalyzeOptions {
  /**
   * Force the cell counts. With both counts and no grid detected, a lattice of exactly these counts is
   * fitted to the picture's line evidence (grid mode when it fits clearly, area resample otherwise).
   */
  cols?: number
  rows?: number
  /** Ignore any grid and resample the content box to cols x rows. */
  forceResample?: boolean
  /** -1..1, shifts the ink/paper decision boundary along the axis between the two colour clusters; 0 = midpoint, positive = more cells become ink. */
  inkBias?: number
}

export interface ChartAnalysis {
  mode: 'grid' | 'resample'
  rows: number
  cols: number
  /** ink[i][j]: cell in image row i counted from the TOP, column j from the LEFT. true = the "ink" class (the darker class; if the two clusters have near-equal lightness, the more saturated one). */
  ink: boolean[][]
  /** 0..1 per cell: how far from the decision boundary (useful as a weight downstream). */
  certainty: number[][]
  /** '#rrggbb' cluster centres */
  colors: { paper: string; ink: string }
  grid: DetectedGrid | null
  /** Region actually sampled. */
  crop: Box
  /** Grid confidence in grid mode; a contrast/separation score in resample mode. */
  confidence: number
}

const MIN_COUNT = 1
const MAX_COUNT = 200
/** Fraction of each cell's width and height sampled in grid mode, centred, to stay clear of the lines. */
const INNER = 0.5
/** At most this many pixels per axis are read inside a cell. */
const MAX_SAMPLES = 7

function clampCount(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`Número de ${label} inválido.`)
  return Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round(value)))
}

/** Default cell counts for resample mode: longest side ~ target cells, square cells, aspect from the content box. */
export function suggestCellCounts(box: Box, target = 60): { cols: number; rows: number } {
  const t = clampCount(target, 'células')
  const w = Math.max(1, box.width)
  const h = Math.max(1, box.height)
  if (w >= h) return { cols: t, rows: Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round((t * h) / w))) }
  return { cols: Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round((t * w) / h))), rows: t }
}

/** Median of the first `n` values of `buf`, sorting them in place (insertion sort: at most 81 values). */
function medianInPlace(buf: Float64Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const v = buf[i]
    let j = i - 1
    while (j >= 0 && buf[j] > v) {
      buf[j + 1] = buf[j]
      j--
    }
    buf[j + 1] = v
  }
  return n % 2 ? buf[n >> 1] : 0.5 * (buf[(n >> 1) - 1] + buf[n >> 1])
}

/** Per-channel median of the central part of every cell of a mesh grid (a photo), corners interpolated bilinearly. */
function sampleMesh(image: RgbaImage, grid: DetectedGrid, mesh: GridMesh): Float32Array {
  const { width: w, height: h, data } = image
  const cols = grid.x.count
  const rows = grid.y.count
  const out = new Float32Array(cols * rows * 3)
  const n = 5
  const buf = [new Float64Array(n * n), new Float64Array(n * n), new Float64Array(n * n)]
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j
      const b = a + cols + 1
      let m = 0
      for (let sy = 0; sy < n; sy++) {
        const v = (1 - INNER) / 2 + (INNER * (sy + 0.5)) / n
        for (let sx = 0; sx < n; sx++) {
          const u = (1 - INNER) / 2 + (INNER * (sx + 0.5)) / n
          const x = (1 - v) * ((1 - u) * mesh.x[a] + u * mesh.x[a + 1]) + v * ((1 - u) * mesh.x[b] + u * mesh.x[b + 1])
          const y = (1 - v) * ((1 - u) * mesh.y[a] + u * mesh.y[a + 1]) + v * ((1 - u) * mesh.y[b] + u * mesh.y[b + 1])
          const px = Math.max(0, Math.min(w - 1, Math.round(x - 0.5)))
          const py = Math.max(0, Math.min(h - 1, Math.round(y - 0.5)))
          const o = (py * w + px) * 4
          buf[0][m] = data[o]
          buf[1][m] = data[o + 1]
          buf[2][m] = data[o + 2]
          m++
        }
      }
      for (let c = 0; c < 3; c++) out[(i * cols + j) * 3 + c] = medianInPlace(buf[c], m)
    }
  }
  return out
}

/** Per-channel median of the central part of every cell of a detected grid. */
function sampleGrid(image: RgbaImage, grid: DetectedGrid): Float32Array {
  if (grid.mesh) return sampleMesh(image, grid, grid.mesh)
  const { width: w, height: h, data } = image
  const cols = grid.x.count
  const rows = grid.y.count
  const out = new Float32Array(cols * rows * 3)
  const span = (start: number, pitch: number, index: number, limit: number): number[] => {
    const lo = start + (index + (1 - INNER) / 2) * pitch
    const hi = start + (index + (1 + INNER) / 2) * pitch
    let a = Math.ceil(lo - 0.5)
    let b = Math.floor(hi - 0.5)
    if (b < a) a = b = Math.round(start + (index + 0.5) * pitch - 0.5)
    a = Math.max(0, Math.min(limit - 1, a))
    b = Math.max(0, Math.min(limit - 1, b))
    const n = b - a + 1
    const step = n > MAX_SAMPLES ? n / MAX_SAMPLES : 1
    const picks: number[] = []
    for (let t = 0; t < Math.min(n, MAX_SAMPLES); t++) picks.push(a + Math.floor(t * step + (step - 1) / 2))
    return picks
  }
  const xs = Array.from({ length: cols }, (_, j) => span(grid.x.start, grid.x.pitch, j, w))
  const ys = Array.from({ length: rows }, (_, i) => span(grid.y.start, grid.y.pitch, i, h))
  const buf = [new Float64Array(MAX_SAMPLES * MAX_SAMPLES), new Float64Array(MAX_SAMPLES * MAX_SAMPLES), new Float64Array(MAX_SAMPLES * MAX_SAMPLES)]
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let n = 0
      for (const py of ys[i]) {
        for (const px of xs[j]) {
          const o = (py * w + px) * 4
          buf[0][n] = data[o]
          buf[1][n] = data[o + 1]
          buf[2][n] = data[o + 2]
          n++
        }
      }
      for (let c = 0; c < 3; c++) out[(i * cols + j) * 3 + c] = medianInPlace(buf[c], n)
    }
  }
  return out
}

/** Exact fractional coverage of source pixels by the output cells along one axis. */
function coverage(start: number, length: number, cells: number): { first: Int32Array; weights: Float64Array[] } {
  const scale = length / cells
  const first = new Int32Array(cells)
  const weights: Float64Array[] = []
  for (let j = 0; j < cells; j++) {
    const lo = start + j * scale
    const hi = start + (j + 1) * scale
    const a = Math.floor(lo)
    const b = Math.ceil(hi)
    const wts = new Float64Array(b - a)
    for (let p = a; p < b; p++) wts[p - a] = (Math.min(hi, p + 1) - Math.max(lo, p)) / scale
    first[j] = a
    weights.push(wts)
  }
  return { first, weights }
}

/** Box-filter (area average) of `crop` into cols x rows cells. */
function areaAverage(image: RgbaImage, crop: Box, cols: number, rows: number): Float32Array {
  const { width: w, data } = image
  const hx = coverage(crop.x, crop.width, cols)
  const vy = coverage(crop.y, crop.height, rows)
  const tmp = new Float64Array(crop.height * cols * 3)
  for (let y = 0; y < crop.height; y++) {
    const rowOff = (crop.y + y) * w
    for (let j = 0; j < cols; j++) {
      const wts = hx.weights[j]
      const a = hx.first[j]
      let r = 0
      let g = 0
      let b = 0
      for (let k = 0; k < wts.length; k++) {
        const o = (rowOff + a + k) * 4
        r += wts[k] * data[o]
        g += wts[k] * data[o + 1]
        b += wts[k] * data[o + 2]
      }
      const t = (y * cols + j) * 3
      tmp[t] = r
      tmp[t + 1] = g
      tmp[t + 2] = b
    }
  }
  const out = new Float32Array(cols * rows * 3)
  for (let i = 0; i < rows; i++) {
    const wts = vy.weights[i]
    const a = vy.first[i] - crop.y
    for (let j = 0; j < cols; j++) {
      let r = 0
      let g = 0
      let b = 0
      for (let k = 0; k < wts.length; k++) {
        const t = ((a + k) * cols + j) * 3
        r += wts[k] * tmp[t]
        g += wts[k] * tmp[t + 1]
        b += wts[k] * tmp[t + 2]
      }
      const o = (i * cols + j) * 3
      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
    }
  }
  return out
}

function toMatrices(ink: Uint8Array, certainty: Float32Array, cols: number, rows: number) {
  const inkRows: boolean[][] = []
  const certRows: number[][] = []
  for (let i = 0; i < rows; i++) {
    const a: boolean[] = []
    const c: number[] = []
    for (let j = 0; j < cols; j++) {
      a.push(ink[i * cols + j] === 1)
      c.push(certainty[i * cols + j])
    }
    inkRows.push(a)
    certRows.push(c)
  }
  return { ink: inkRows, certainty: certRows }
}

function gridBox(grid: DetectedGrid, image: RgbaImage): Box {
  if (grid.mesh) {
    const x0 = Math.max(0, Math.floor(Math.min(...grid.mesh.x)))
    const y0 = Math.max(0, Math.floor(Math.min(...grid.mesh.y)))
    const x1 = Math.min(image.width, Math.ceil(Math.max(...grid.mesh.x)))
    const y1 = Math.min(image.height, Math.ceil(Math.max(...grid.mesh.y)))
    return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }
  }
  const x0 = Math.max(0, Math.round(grid.x.start))
  const y0 = Math.max(0, Math.round(grid.y.start))
  const x1 = Math.min(image.width, Math.round(grid.x.start + grid.x.count * grid.x.pitch))
  const y1 = Math.min(image.height, Math.round(grid.y.start + grid.y.count * grid.y.pitch))
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }
}

export function analyzeChartImage(image: RgbaImage, options: AnalyzeOptions = {}): ChartAnalysis {
  assertImage(image)
  const flat = opaque(image)
  const bias = options.inkBias === undefined ? 0 : options.inkBias
  if (!Number.isFinite(bias)) throw new Error('Ajuste de tinta inválido: use um valor entre -1 e 1.')
  const forcedCols = options.cols === undefined ? undefined : clampCount(options.cols, 'colunas')
  const forcedRows = options.rows === undefined ? undefined : clampCount(options.rows, 'carreiras')

  const gridResult = (found: DetectedGrid): ChartAnalysis => {
    const cells = classifyCells(sampleGrid(flat, found), bias)
    return {
      mode: 'grid',
      cols: found.x.count,
      rows: found.y.count,
      ...toMatrices(cells.ink, cells.certainty, found.x.count, found.y.count),
      colors: cells.colors,
      grid: found,
      crop: gridBox(found, flat),
      confidence: found.confidence,
    }
  }

  const grid = options.forceResample ? null : detectGridOpaque(flat)
  if (grid) {
    const fits =
      (forcedCols === undefined || forcedCols === grid.x.count) &&
      (forcedRows === undefined || forcedRows === grid.y.count) &&
      grid.x.count <= MAX_COUNT &&
      grid.y.count <= MAX_COUNT
    if (fits) return gridResult(grid)
  } else if (!options.forceResample && forcedCols !== undefined && forcedRows !== undefined) {
    // Known counts, no grid found: fit a lattice of exactly those counts to the line evidence.
    const fitted = fitKnownCounts(luminance(flat), flat.width, flat.height, findContentBox(flat), forcedCols, forcedRows)
    if (fitted && fitted.confidence > 0) return gridResult(fitted)
  }

  // No grid, a forced resample, or counts that disagree with the grid found: average the content
  // (the grid itself when there is one, so its margins stay out) into the requested cells.
  const crop = grid ? gridBox(grid, flat) : findContentBox(flat)
  let cols: number
  let rows: number
  if (forcedCols !== undefined && forcedRows !== undefined) {
    cols = forcedCols
    rows = forcedRows
  } else if (forcedCols !== undefined) {
    cols = forcedCols
    rows = clampCount((forcedCols * crop.height) / crop.width, 'carreiras')
  } else if (forcedRows !== undefined) {
    rows = forcedRows
    cols = clampCount((forcedRows * crop.width) / crop.height, 'colunas')
  } else if (grid) {
    cols = Math.min(MAX_COUNT, grid.x.count)
    rows = Math.min(MAX_COUNT, grid.y.count)
  } else {
    ;({ cols, rows } = suggestCellCounts(crop, 60))
  }
  const cells = classifyCells(areaAverage(flat, crop, cols, rows), bias)
  return {
    mode: 'resample',
    cols,
    rows,
    ...toMatrices(cells.ink, cells.certainty, cols, rows),
    colors: cells.colors,
    grid,
    crop,
    confidence: cells.separation,
  }
}
