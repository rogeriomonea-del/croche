import type { Box, RgbaImage } from './image'

/** Test fixtures: deterministic renderings of charts and pictures with known ground truth. */

export type Rgb = readonly [number, number, number]

/** Deterministic PRNG (mulberry32), uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface ChartRenderOptions {
  /** Cell size in pixels; may be fractional. */
  cellSize: number
  lineWidth?: number
  lineColor?: Rgb
  /** Every this many cells (and at the border) the line is thicker and darker. */
  majorEvery?: number
  majorLineWidth?: number
  majorLineColor?: Rgb
  /** Colour of a line between two ink cells; defaults to lineColor. */
  inkLineColor?: Rgb
  inkColor?: Rgb
  paperColor?: Rgb
  pageColor?: Rgb
  margins?: { left: number; top: number; right: number; bottom: number }
  /** Axis numbers, arrow markers and a watermark line around the grid. */
  labels?: boolean
  labelColor?: Rgb
  watermarkColor?: Rgb
  /** Uniform per-channel noise amplitude (+-). */
  noise?: number
  /** 3x3 box blur before the noise. */
  blur?: boolean
  seed?: number
}

export interface RenderedChart {
  image: RgbaImage
  /** Where the grid was drawn: line k sits at x0 + k * cellSize. */
  grid: { x0: number; y0: number; cellSize: number; cols: number; rows: number }
}

/** 3x5 bitmap digits, rows top to bottom. */
const DIGITS = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111',
]

interface Canvas {
  w: number
  h: number
  rgb: Float32Array
}

/** Paints a rectangle with exact fractional pixel coverage. */
function fillRect(cv: Canvas, x0: number, y0: number, x1: number, y1: number, color: Rgb): void {
  const ax = Math.max(0, Math.floor(x0))
  const bx = Math.min(cv.w, Math.ceil(x1))
  const ay = Math.max(0, Math.floor(y0))
  const by = Math.min(cv.h, Math.ceil(y1))
  for (let y = ay; y < by; y++) {
    const cy = Math.min(y1, y + 1) - Math.max(y0, y)
    if (cy <= 0) continue
    for (let x = ax; x < bx; x++) {
      const cx = Math.min(x1, x + 1) - Math.max(x0, x)
      if (cx <= 0) continue
      const a = cx * cy
      const o = (y * cv.w + x) * 3
      for (let c = 0; c < 3; c++) cv.rgb[o + c] = cv.rgb[o + c] * (1 - a) + color[c] * a
    }
  }
}

/** Draws a 3x5 bitmap glyph with its top-left corner at (x, y), each bit `px` pixels wide. */
function drawGlyph(cv: Canvas, bits: string, x: number, y: number, px: number, color: Rgb): void {
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) {
      if (bits[r * 3 + c] === '1') fillRect(cv, x + c * px, y + r * px, x + (c + 1) * px, y + (r + 1) * px, color)
    }
  }
}

function drawNumber(cv: Canvas, value: number, cx: number, cy: number, px: number, color: Rgb, align: 'center' | 'right'): void {
  const text = String(value)
  const advance = 4 * px
  const width = text.length * advance - px
  const left = align === 'center' ? cx - width / 2 : cx - width
  for (let i = 0; i < text.length; i++) drawGlyph(cv, DIGITS[Number(text[i])], left + i * advance, cy - 2.5 * px, px, color)
}

/** A filled triangle pointing right, rasterised with 4x4 supersampling. */
function drawArrow(cv: Canvas, x0: number, yc: number, size: number, color: Rgb): void {
  const ax = Math.floor(x0)
  const bx = Math.ceil(x0 + size)
  const ay = Math.floor(yc - size / 2)
  const by = Math.ceil(yc + size / 2)
  for (let y = Math.max(0, ay); y < Math.min(cv.h, by); y++) {
    for (let x = Math.max(0, ax); x < Math.min(cv.w, bx); x++) {
      let hits = 0
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4
          const py = y + (sy + 0.5) / 4
          const t = (px - x0) / size
          if (t >= 0 && t <= 1 && Math.abs(py - yc) <= (size / 2) * (1 - t)) hits++
        }
      }
      if (!hits) continue
      const a = hits / 16
      const o = (y * cv.w + x) * 3
      for (let c = 0; c < 3; c++) cv.rgb[o + c] = cv.rgb[o + c] * (1 - a) + color[c] * a
    }
  }
}

function finish(cv: Canvas, blur: boolean, noise: number, seed: number): RgbaImage {
  let rgb = cv.rgb
  if (blur) {
    const out = new Float32Array(rgb.length)
    for (let y = 0; y < cv.h; y++) {
      for (let x = 0; x < cv.w; x++) {
        for (let c = 0; c < 3; c++) {
          let s = 0
          for (let dy = -1; dy <= 1; dy++) {
            const yy = Math.min(cv.h - 1, Math.max(0, y + dy))
            for (let dx = -1; dx <= 1; dx++) {
              const xx = Math.min(cv.w - 1, Math.max(0, x + dx))
              s += rgb[(yy * cv.w + xx) * 3 + c]
            }
          }
          out[(y * cv.w + x) * 3 + c] = s / 9
        }
      }
    }
    rgb = out
  }
  const random = seededRandom(seed)
  const data = new Uint8ClampedArray(cv.w * cv.h * 4)
  for (let p = 0; p < cv.w * cv.h; p++) {
    for (let c = 0; c < 3; c++) {
      const n = noise ? Math.round((random() * 2 - 1) * noise) : 0
      data[p * 4 + c] = Math.round(rgb[p * 3 + c] + n)
    }
    data[p * 4 + 3] = 255
  }
  return { width: cv.w, height: cv.h, data }
}

/**
 * Renders `truth` (rows top to bottom, true = ink) as a chart: cells separated by grid lines, a
 * thicker darker line every `majorEvery` cells and at the border, and (with `labels`) column numbers
 * above, row numbers at the left, arrow markers and a watermark line below, on an off-white page.
 */
export function renderChart(truth: boolean[][], options: ChartRenderOptions): RenderedChart {
  const rows = truth.length
  const cols = truth[0].length
  const cs = options.cellSize
  const lineWidth = options.lineWidth ?? 1
  const lineColor = options.lineColor ?? [184, 188, 196]
  const majorEvery = options.majorEvery ?? 10
  const majorWidth = options.majorLineWidth ?? 2
  const majorColor = options.majorLineColor ?? [112, 116, 124]
  const inkLineColor = options.inkLineColor ?? lineColor
  const inkColor = options.inkColor ?? [139, 30, 30]
  const paperColor = options.paperColor ?? [255, 255, 255]
  const pageColor = options.pageColor ?? [248, 246, 241]
  const labels = options.labels ?? true
  const labelColor = options.labelColor ?? [45, 45, 50]
  const watermarkColor = options.watermarkColor ?? [150, 150, 155]
  const m = options.margins ?? {
    left: Math.max(40, 3.5 * cs),
    top: Math.max(30, 3 * cs),
    right: Math.max(16, 1.5 * cs),
    bottom: Math.max(40, 4 * cs),
  }
  const w = Math.ceil(m.left + cols * cs + m.right)
  const h = Math.ceil(m.top + rows * cs + m.bottom)
  const x0 = m.left
  const y0 = m.top
  const cv: Canvas = { w, h, rgb: new Float32Array(w * h * 3) }

  const isMajorX = (k: number) => k === 0 || k === cols || k % majorEvery === 0
  const isMajorY = (k: number) => k === 0 || k === rows || (rows - k) % majorEvery === 0
  const S = 3
  // Per sub-sample position along one axis: the line it falls on (-1 for none), the cell it falls in
  // (-1 outside the grid) and whether it lies within the grid's span (borders included).
  const axis = (pixels: number, origin: number, cells: number, major: (k: number) => boolean) => {
    const line = new Int32Array(pixels * S).fill(-1)
    const cell = new Int32Array(pixels * S).fill(-1)
    const span = new Uint8Array(pixels * S)
    for (let i = 0; i < pixels * S; i++) {
      const v = (i + 0.5) / S
      const g = (v - origin) / cs
      const k = Math.round(g)
      if (k >= 0 && k <= cells && Math.abs(v - (origin + k * cs)) <= (major(k) ? majorWidth : lineWidth) / 2) line[i] = k
      if (g >= 0 && g < cells) cell[i] = Math.floor(g)
      span[i] = v >= origin - majorWidth / 2 && v <= origin + cells * cs + majorWidth / 2 ? 1 : 0
    }
    return { line, cell, span }
  }
  const ax = axis(w, x0, cols, isMajorX)
  const ay = axis(h, y0, rows, isMajorY)
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < S; sy++) {
        const iy = py * S + sy
        const ky = ay.line[iy]
        const cy = ay.cell[iy]
        for (let sx = 0; sx < S; sx++) {
          const ix = px * S + sx
          const kx = ax.line[ix]
          const cx = ax.cell[ix]
          const onV = kx >= 0 && ay.span[iy] === 1
          const onH = ky >= 0 && ax.span[ix] === 1
          let color: Rgb = pageColor
          if (onV || onH) {
            if ((onV && isMajorX(kx)) || (onH && isMajorY(ky))) color = majorColor
            else {
              let bothInk = false
              if (onV && cy >= 0) bothInk = kx > 0 && kx < cols && truth[cy][kx - 1] && truth[cy][kx]
              else if (onH && cx >= 0) bothInk = ky > 0 && ky < rows && truth[ky - 1][cx] && truth[ky][cx]
              color = bothInk ? inkLineColor : lineColor
            }
          } else if (cx >= 0 && cy >= 0) {
            color = truth[cy][cx] ? inkColor : paperColor
          }
          r += color[0]
          g += color[1]
          b += color[2]
        }
      }
      const o = (py * w + px) * 3
      cv.rgb[o] = r / (S * S)
      cv.rgb[o + 1] = g / (S * S)
      cv.rgb[o + 2] = b / (S * S)
    }
  }

  if (labels) {
    const fp = Math.max(1.6, cs * 0.2)
    for (let c = 10; c <= cols; c += 10) drawNumber(cv, c, x0 + (c - 0.5) * cs, y0 - 0.6 * cs - 3 * fp, fp, labelColor, 'center')
    for (let r = 10; r <= rows; r += 10) drawNumber(cv, r, x0 - 0.6 * cs, y0 + (rows - r + 0.5) * cs, fp, labelColor, 'right')
    const arrow = Math.max(6, 0.8 * cs)
    drawArrow(cv, x0 - 0.6 * cs - arrow - 4 * fp * 2.5, y0 + 0.5 * cs, arrow, labelColor)
    drawArrow(cv, x0 - 0.6 * cs - arrow - 4 * fp * 2.5, y0 + (rows - 0.5) * cs, arrow, labelColor)
    // Watermark: a centred line of pseudo-letters under the grid.
    const random = seededRandom((options.seed ?? 1) + 77)
    const letters = Math.max(3, Math.round((cols * cs * 0.35) / (4 * fp)))
    const left = x0 + (cols * cs - letters * 4 * fp) / 2
    const top = y0 + rows * cs + Math.max(0.9 * cs, 6)
    for (let i = 0; i < letters; i++) {
      if (i % 7 === 6) continue
      const bits = Array.from({ length: 15 }, () => (random() < 0.55 ? '1' : '0')).join('')
      drawGlyph(cv, bits, left + i * 4 * fp, top, fp, watermarkColor)
    }
  }

  return {
    image: finish(cv, options.blur ?? false, options.noise ?? 10, options.seed ?? 1),
    grid: { x0, y0, cellSize: cs, cols, rows },
  }
}

/**
 * A 90 x 31 filet lace edging, rows top to bottom: a solid band, an open mesh row and another solid
 * band at the top; six scallops below with diamond outlines (1-cell diagonals), a solid diamond with a
 * single open "eye", checkered mesh of isolated single cells, a 1-cell vertical bar between scallops
 * and a stepped (staircase) lower edge; all paper under the scallops.
 */
export function edgingTruth(): boolean[][] {
  const cols = 90
  const rows = 31
  const period = 15
  const t = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))
  for (let j = 0; j < cols; j++) {
    t[0][j] = true
    t[1][j] = j % 2 === 0
    t[2][j] = true
    const u = j % period
    const depth = 4 + Math.round(13 * Math.sin((Math.PI * (u + 0.5)) / period))
    const bottom = 3 + depth - 1
    for (let i = 3; i <= bottom; i++) {
      const dist = Math.abs(i - 9) + Math.abs(u - 7)
      let ink: boolean
      if (i === bottom || u === 0) ink = true
      else if (dist === 4) ink = true
      else if (dist < 4) ink = !(i === 9 && u === 7) && dist !== 3
      else ink = i < bottom - 1 && (i + j) % 2 === 0
      t[i][j] = ink
    }
  }
  return t
}

/** Random cells (each ink with probability `density`), seeded. */
export function randomTruth(cols: number, rows: number, seed: number, density = 0.45): boolean[][] {
  const random = seededRandom(seed)
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => random() < density))
}

export interface RenderedPicture {
  image: RgbaImage
  /** Silhouette coverage per pixel, 0..1. */
  mask: Float32Array
}

/** A dark irregular silhouette on a light, slightly graded, noisy background. No grid. */
export function renderPicture(width: number, height: number, seed = 3, noise = 12): RenderedPicture {
  const random = seededRandom(seed)
  const p1 = random() * Math.PI * 2
  const p2 = random() * Math.PI * 2
  const cx = width * 0.5
  const cy = height * 0.55
  const R = Math.min(width, height) * 0.32
  const inside = (x: number, y: number) => {
    const dx = x - cx
    const dy = y - cy
    const theta = Math.atan2(dy, dx)
    const r = R * (1 + 0.22 * Math.sin(3 * theta + p1) + 0.12 * Math.cos(5 * theta + p2) + 0.06 * Math.sin(9 * theta))
    if (dx * dx + dy * dy <= r * r) return true
    // A smaller round "head" above.
    const hx = x - cx - R * 0.35
    const hy = y - (cy - R * 1.15)
    return hx * hx + hy * hy <= (R * 0.38) ** 2
  }
  const mask = new Float32Array(width * height)
  const cv: Canvas = { w: width, h: height, rgb: new Float32Array(width * height * 3) }
  const S = 3
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hits = 0
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) if (inside(x + (sx + 0.5) / S, y + (sy + 0.5) / S)) hits++
      const a = hits / (S * S)
      mask[y * width + x] = a
      const grade = 8 * (x / width) - 6 * (y / height)
      const shade = 10 * Math.sin(x / 23) * Math.cos(y / 31)
      const bg = [232 + grade, 226 + grade, 214 + grade]
      const fg = [52 + shade, 42 + shade, 48 + shade]
      const o = (y * width + x) * 3
      for (let c = 0; c < 3; c++) cv.rgb[o + c] = bg[c] * (1 - a) + fg[c] * a
    }
  }
  return { image: finish(cv, false, noise, seed + 1), mask }
}

/** Area-averages `mask` over `box` into cols x rows and thresholds at one half. */
export function downsampleMask(mask: Float32Array, width: number, box: Box, cols: number, rows: number): boolean[][] {
  const out: boolean[][] = []
  for (let i = 0; i < rows; i++) {
    const ylo = box.y + (i * box.height) / rows
    const yhi = box.y + ((i + 1) * box.height) / rows
    const row: boolean[] = []
    for (let j = 0; j < cols; j++) {
      const xlo = box.x + (j * box.width) / cols
      const xhi = box.x + ((j + 1) * box.width) / cols
      let sum = 0
      let area = 0
      for (let y = Math.floor(ylo); y < Math.ceil(yhi); y++) {
        const cy = Math.min(yhi, y + 1) - Math.max(ylo, y)
        for (let x = Math.floor(xlo); x < Math.ceil(xhi); x++) {
          const a = cy * (Math.min(xhi, x + 1) - Math.max(xlo, x))
          sum += a * mask[y * width + x]
          area += a
        }
      }
      row.push(sum / area >= 0.5)
    }
    out.push(row)
  }
  return out
}

/** Fraction of cells where the two matrices agree (0 when the shapes differ). */
export function agreement(a: boolean[][], b: boolean[][]): number {
  if (a.length !== b.length || a[0]?.length !== b[0]?.length) return 0
  let same = 0
  let total = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a[i].length; j++) {
      total++
      if (a[i][j] === b[i][j]) same++
    }
  }
  return total ? same / total : 0
}

/** Intersection over union of the true cells. */
export function iou(a: boolean[][], b: boolean[][]): number {
  let inter = 0
  let union = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a[i].length; j++) {
      if (a[i][j] && b[i][j]) inter++
      if (a[i][j] || b[i][j]) union++
    }
  }
  return union ? inter / union : 1
}

export function invert(truth: boolean[][]): boolean[][] {
  return truth.map((row) => row.map((v) => !v))
}

/** The pixels [x0, x1) x [y0, y1) of `image` (a screenshot cut by the screen edges). */
export function cropImage(image: RgbaImage, x0: number, y0: number, x1: number, y1: number): RgbaImage {
  const width = x1 - x0
  const height = y1 - y0
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) data.set(image.data.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x1) * 4), y * width * 4)
  return { width, height, data }
}

/**
 * `truth` drawn as a full-bleed checkerboard-like weave: cells of `cellWidth` x `cellHeight` filling
 * the whole image, no grid lines and no margin, each cell with a faint woven texture.
 */
export function renderBleed(truth: boolean[][], cellWidth: number, cellHeight: number, seed = 1): RgbaImage {
  const rows = truth.length
  const cols = truth[0].length
  const width = Math.round(cols * cellWidth)
  const height = Math.round(rows * cellHeight)
  const random = seededRandom(seed)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ink = truth[Math.min(rows - 1, Math.floor(y / cellHeight))][Math.min(cols - 1, Math.floor(x / cellWidth))]
      const texture = ((x + y) % 4 < 2 ? 6 : -6) + (random() * 2 - 1) * 5
      const v = (ink ? 38 : 226) + texture
      data.set([v, v, v, 255], (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

/** A page of monospaced "text": rows of letter-sized blobs on a 9 x 23 px lattice, no grid lines. */
export function renderTextPage(seed: number, width = 700, height = 500): RgbaImage {
  const random = seededRandom(seed)
  const data = new Uint8ClampedArray(width * height * 4).fill(250)
  for (let line = 0; line < 20; line++) {
    for (let ch = 0; ch < 70; ch++) {
      if (random() < 0.15) continue
      const x0 = 20 + ch * 9
      const y0 = 20 + line * 23
      const cw = 5 + Math.floor(random() * 3)
      const chh = 7 + Math.floor(random() * 5)
      for (let y = y0; y < Math.min(height, y0 + chh); y++) {
        for (let x = x0; x < Math.min(width, x0 + cw); x++) if (random() < 0.7) data.set([30, 30, 30], (y * width + x) * 4)
      }
    }
  }
  return { width, height, data }
}

export interface PhotoOptions {
  /** Inverse warp: the source point shown at output pixel centre (x, y). Identity by default. */
  warp?: (x: number, y: number) => readonly [number, number]
  /** Gaussian blur, standard deviation in pixels. */
  blur?: number
  /** Horizontal banding added to every channel: amplitude (+-) and period in pixels, per component. */
  moire?: readonly { amplitude: number; period: number }[]
  /** Brightness lost at the corners (0..1), falling off with the squared distance from the centre. */
  vignette?: number
  /** Uniform per-channel noise amplitude (+-), standing in for sensor and JPEG noise. */
  noise?: number
  seed?: number
}

/** Bilinear RGB sample at a continuous point (pixel centres at +0.5), edges replicated. */
function sampleRgb(image: RgbaImage, x: number, y: number, out: Float32Array, o: number): void {
  const { width: w, height: h, data } = image
  const fx = Math.max(0, Math.min(w - 1, x - 0.5))
  const fy = Math.max(0, Math.min(h - 1, y - 0.5))
  const x0 = Math.min(w - 2, Math.floor(fx))
  const y0 = Math.min(h - 2, Math.floor(fy))
  const ax = fx - x0
  const ay = fy - y0
  for (let c = 0; c < 3; c++) {
    const p = (y0 * w + x0) * 4 + c
    out[o + c] = (1 - ay) * ((1 - ax) * data[p] + ax * data[p + 4]) + ay * ((1 - ax) * data[p + w * 4] + ax * data[p + w * 4 + 4])
  }
}

function gaussianBlur(rgb: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma)
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)))
  const sum = k.reduce((a, b) => a + b, 0)
  const kernel = k.map((v) => v / sum)
  const tmp = new Float32Array(rgb.length)
  const out = new Float32Array(rgb.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0
        for (let i = -r; i <= r; i++) s += kernel[i + r] * rgb[(y * w + Math.min(w - 1, Math.max(0, x + i))) * 3 + c]
        tmp[(y * w + x) * 3 + c] = s
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0
        for (let i = -r; i <= r; i++) s += kernel[i + r] * tmp[(Math.min(h - 1, Math.max(0, y + i)) * w + x) * 3 + c]
        out[(y * w + x) * 3 + c] = s
      }
    }
  }
  return out
}

/** A phone photo of `image`: warped, blurred, banded, vignetted and noisy, same size. */
export function photograph(image: RgbaImage, options: PhotoOptions): RgbaImage {
  const { width: w, height: h } = image
  let rgb: Float32Array<ArrayBufferLike> = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = options.warp ? options.warp(x + 0.5, y + 0.5) : [x + 0.5, y + 0.5]
      sampleRgb(image, sx, sy, rgb, (y * w + x) * 3)
    }
  }
  if (options.blur) rgb = gaussianBlur(rgb, w, h, options.blur)
  const random = seededRandom(options.seed ?? 1)
  const cx = w / 2
  const cy = h / 2
  const rr = cx * cx + cy * cy
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    let band = 0
    for (const m of options.moire ?? []) band += m.amplitude * Math.sin((2 * Math.PI * y) / m.period)
    for (let x = 0; x < w; x++) {
      const gain = 1 - (options.vignette ?? 0) * (((x - cx) ** 2 + (y - cy) ** 2) / rr)
      for (let c = 0; c < 3; c++) {
        const n = options.noise ? (random() * 2 - 1) * options.noise : 0
        data[(y * w + x) * 4 + c] = Math.round(rgb[(y * w + x) * 3 + c] * gain + band + n)
      }
      data[(y * w + x) * 4 + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

/** Inverse warp of a rotation by `degrees` (clockwise on screen) about the centre of a w x h image. */
export function rotation(w: number, h: number, degrees: number): (x: number, y: number) => readonly [number, number] {
  const t = (-degrees * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  return (x, y) => [w / 2 + (x - w / 2) * cos - (y - h / 2) * sin, h / 2 + (x - w / 2) * sin + (y - h / 2) * cos]
}

/**
 * Inverse warp of a mild perspective: the shown pitch changes by -+`amount` from left to right and
 * from top to bottom, and the horizontal lines converge slightly towards the right (keystone).
 */
export function perspective(w: number, h: number, amount: number): (x: number, y: number) => readonly [number, number] {
  return (x, y) => {
    const u = x - w / 2
    const v = y - h / 2
    return [x + (amount * u * u) / w, y + (amount * v * v) / h + (0.5 * amount * u * v) / w]
  }
}
