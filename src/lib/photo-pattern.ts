import {
  COL_OPTIONS, ROW_OPTIONS, cellsOf, conflicts, deriveX, emptyMatrix, fromDocument,
  instructions, parseDocument, toDocument, type DesignData, type Yarn,
} from '../core'

export interface PhotoPixels {
  width: number
  height: number
  /** Pixels are in the standard canvas order: top to bottom, left to right, RGBA. */
  data: Uint8ClampedArray
}

export interface PhotoPatternOptions {
  threshold: number
  invert: boolean
  colors: Record<Yarn, string>
  name: string
}

export interface PhotoPatternResult {
  design: DesignData
  instructions: string[]
  doubleCrochets: number
  singleCrochets: number
  adaptedCells: number
  conflictCount: number
}

function validatePixels(pixels: PhotoPixels): void {
  if (!ROW_OPTIONS.includes(pixels.height) || !COL_OPTIONS.includes(pixels.width)) {
    throw new Error('Escolha de 5 a 119 carreiras ímpares e de 5 a 120 pontos por carreira.')
  }
  if (!(pixels.data instanceof Uint8ClampedArray) || pixels.data.length !== pixels.width * pixels.height * 4) {
    throw new Error('Os pixels da imagem não correspondem às dimensões do gráfico.')
  }
}

/** Transparent photographs are composited onto white, exactly like the sampling canvas. */
function luminance(data: Uint8ClampedArray, offset: number): number {
  const alpha = data[offset + 3] / 255
  return (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) * alpha + 255 * (1 - alpha)
}

/** Otsu's two-class threshold, using the same luminance/alpha treatment as conversion. */
export function automaticPhotoThreshold(pixels: PhotoPixels): number {
  validatePixels(pixels)
  const histogram = new Uint32Array(256)
  let sum = 0
  const count = pixels.width * pixels.height
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = Math.round(luminance(pixels.data, i))
    histogram[value]++
    sum += value
  }
  let lowCount = 0
  let lowSum = 0
  let best = 0
  let first = 128
  let last = 128
  for (let value = 0; value < 255; value++) {
    lowCount += histogram[value]
    lowSum += histogram[value] * value
    if (lowCount === 0 || lowCount === count) continue
    const highCount = count - lowCount
    const distance = lowSum / lowCount - (sum - lowSum) / highCount
    const variance = lowCount * highCount * distance * distance
    if (variance > best) {
      best = variance
      first = last = value
    } else if (variance === best) {
      last = value
    }
  }
  return Math.min(255, Math.round((first + last) / 2) + (best > 0 ? 1 : 0))
}

/**
 * Approximate a sampled picture with a valid, two-yarn overlay mosaic. Each column is a
 * two-state shortest path: an ordinary cell may follow either state; a deviation may only
 * follow an ordinary cell. The first/last rows are fixed. This minimizes weighted threshold
 * error globally per column, rather than greedily erasing double crochets after conversion.
 * There is still only one stored boolean per cell; all stitches come from the existing core.
 */
export function convertPhotoPixels(pixels: PhotoPixels, options: PhotoPatternOptions): PhotoPatternResult {
  validatePixels(pixels)
  if (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 255) {
    throw new Error('O contraste deve estar entre 0 e 255.')
  }
  const rows = pixels.height
  const cols = pixels.width
  const delta = emptyMatrix(rows, cols)
  let adaptedCells = 0

  for (let c = 0; c < cols; c++) {
    const desired = new Uint8Array(rows)
    const weights = new Float64Array(rows)
    const previousForOrdinary = new Uint8Array(rows)
    for (let r = 0; r < rows; r++) {
      // Canvas row zero is the TOP; crochet row zero is the BOTTOM. Never mirror columns.
      const value = luminance(pixels.data, ((rows - 1 - r) * cols + c) * 4)
      desired[r] = Number((value < options.threshold) !== options.invert)
      weights[r] = 1 + Math.abs(value - options.threshold)
    }
    let ordinary = desired[0] ? weights[0] : 0
    let deviation = Infinity
    for (let r = 1; r < rows; r++) {
      const stripeIsPattern = r % 2 === 1
      const ordinaryError = Number(stripeIsPattern) === desired[r] ? 0 : weights[r]
      const deviationError = Number(!stripeIsPattern) === desired[r] ? 0 : weights[r]
      // Deterministic ties prefer an ordinary predecessor.
      previousForOrdinary[r] = Number(deviation < ordinary)
      const nextOrdinary = Math.min(ordinary, deviation) + ordinaryError
      const nextDeviation = r === rows - 1 ? Infinity : ordinary + deviationError
      ordinary = nextOrdinary
      deviation = nextDeviation
    }
    let state = 0 // Top row is locked to its stripe.
    for (let r = rows - 1; r >= 0; r--) {
      delta[r][c] = state === 1
      if (Number((r % 2 === 1) !== (state === 1)) !== desired[r]) adaptedCells++
      state = state === 1 ? 0 : previousForOrdinary[r]
    }
  }

  const name = [...options.name.replace(/[\p{Cc}\p{Cs}]/gu, '').trim()].slice(0, 100).join('') || 'Estudo a partir de fotografia'
  const parsed = parseDocument(toDocument({ name, delta, colors: { ...options.colors } }))
  if (!parsed.ok) throw new Error('Não foi possível criar um documento válido com as cores selecionadas.')
  const design = fromDocument(parsed.document)
  const chart = deriveX(design.delta)
  const doubleCrochets = cellsOf(chart).length
  return {
    design,
    instructions: instructions(chart),
    doubleCrochets,
    singleCrochets: rows * cols - doubleCrochets,
    adaptedCells,
    conflictCount: cellsOf(conflicts(chart)).length,
  }
}

export type PhotoFit = 'contain' | 'cover'

/** Center a photo without stretching; negative offsets are the intentional center crop. */
export function photoPlacement(width: number, height: number, cols: number, rows: number, fit: PhotoFit) {
  if (![width, height, cols, rows].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error('A imagem precisa ter dimensões válidas.')
  }
  const scale = fit === 'cover' ? Math.max(cols / width, rows / height) : Math.min(cols / width, rows / height)
  return { x: (cols - width * scale) / 2, y: (rows - height * scale) / 2, width: width * scale, height: height * scale }
}
