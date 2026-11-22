import {
  COL_OPTIONS, ROW_OPTIONS, cellsOf, conflicts, deriveX, emptyMatrix, fromDocument,
  instructions, parseDocument, toDocument, type DesignData, type Matrix, type Yarn,
} from '../core'
import type { ChartAnalysis } from './vision'

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

/** Overlay-mosaic adaptation of a two-yarn target, chosen column by column. */
export interface MosaicFit {
  /** delta[r-1][c-1]: true = the cell deviates from its row's stripe (a double crochet is dropped onto it). */
  delta: Matrix
  /** Cells whose visible yarn differs from the desired one. */
  adaptedCells: number
}

/**
 * Approximate a desired two-yarn picture with a valid overlay mosaic. Each column is a two-state
 * shortest path: an ordinary cell may follow either state; a deviation may only follow an
 * ordinary cell. The first/last rows are fixed. This minimizes the weighted error globally per
 * column, rather than greedily erasing double crochets after conversion.
 *
 * desired[r-1][c-1] (row 1 = bottom, column 1 = left): true = the cell should show yarn B.
 * weights has the same shape: the cost of missing each cell (finite, >= 0).
 */
export function fitMosaic(desired: boolean[][], weights: number[][]): MosaicFit {
  const rows = desired.length
  const cols = desired[0]?.length ?? 0
  if (!ROW_OPTIONS.includes(rows) || !COL_OPTIONS.includes(cols)) {
    throw new Error('Escolha de 5 a 119 carreiras ímpares e de 5 a 120 pontos por carreira.')
  }
  if (
    weights.length !== rows ||
    desired.some((row) => row.length !== cols) ||
    weights.some((row) => row.length !== cols || row.some((w) => !Number.isFinite(w) || w < 0))
  ) {
    throw new Error('Os pesos da conversão não correspondem ao gráfico.')
  }
  const delta = emptyMatrix(rows, cols)
  let adaptedCells = 0
  const previousForOrdinary = new Uint8Array(rows)
  for (let c = 0; c < cols; c++) {
    let ordinary = desired[0][c] ? weights[0][c] : 0
    let deviation = Infinity
    for (let r = 1; r < rows; r++) {
      const stripeIsPattern = r % 2 === 1
      const ordinaryError = stripeIsPattern === desired[r][c] ? 0 : weights[r][c]
      const deviationError = !stripeIsPattern === desired[r][c] ? 0 : weights[r][c]
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
      if (((r % 2 === 1) !== (state === 1)) !== desired[r][c]) adaptedCells++
      state = state === 1 ? 0 : previousForOrdinary[r]
    }
  }
  return { delta, adaptedCells }
}

function cleanName(name: string, fallback: string): string {
  return [...name.replace(/[\p{Cc}\p{Cs}]/gu, '').trim()].slice(0, 100).join('') || fallback
}

/** Builds the document through the existing contract and derives every stitch from the core. */
function mosaicResult(fit: MosaicFit, name: string, colors: Record<Yarn, string>): PhotoPatternResult {
  const parsed = parseDocument(toDocument({ name, delta: fit.delta, colors: { ...colors } }))
  if (!parsed.ok) throw new Error('Não foi possível criar um documento válido com as cores selecionadas.')
  const design = fromDocument(parsed.document)
  const chart = deriveX(design.delta)
  const doubleCrochets = cellsOf(chart).length
  return {
    design,
    instructions: instructions(chart),
    doubleCrochets,
    singleCrochets: design.delta.length * design.delta[0].length - doubleCrochets,
    adaptedCells: fit.adaptedCells,
    conflictCount: cellsOf(conflicts(chart)).length,
  }
}

/** A sampled picture to a valid, two-yarn overlay mosaic (one stored boolean per cell). */
export function convertPhotoPixels(pixels: PhotoPixels, options: PhotoPatternOptions): PhotoPatternResult {
  validatePixels(pixels)
  if (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 255) {
    throw new Error('O contraste deve estar entre 0 e 255.')
  }
  const rows = pixels.height
  const cols = pixels.width
  const desired: boolean[][] = []
  const weights: number[][] = []
  for (let r = 0; r < rows; r++) {
    const wants: boolean[] = []
    const costs: number[] = []
    for (let c = 0; c < cols; c++) {
      // Canvas row zero is the TOP; crochet row zero is the BOTTOM. Never mirror columns.
      const value = luminance(pixels.data, ((rows - 1 - r) * cols + c) * 4)
      wants.push((value < options.threshold) !== options.invert)
      costs.push(1 + Math.abs(value - options.threshold))
    }
    desired.push(wants)
    weights.push(costs)
  }
  return mosaicResult(fitMosaic(desired, weights), cleanName(options.name, 'Estudo a partir de fotografia'), options.colors)
}

export interface ChartTargetOptions {
  /** Mosaic rows per chart row. Two rows give the stripes room to follow vertical changes. */
  rowsPerChartRow: 1 | 2
  /** Swap which chart class shows yarn B. */
  invert: boolean
}

export interface ChartMosaicOptions extends ChartTargetOptions {
  colors: Record<Yarn, string>
  name: string
}

export interface ChartMosaicTarget {
  /** desired[r-1][c-1], row 1 = bottom: true = shows yarn B. */
  desired: boolean[][]
  weights: number[][]
}

const MIN_MOSAIC_ROWS = ROW_OPTIONS[0]
const MAX_MOSAIC_ROWS = ROW_OPTIONS[ROW_OPTIONS.length - 1]
const MIN_MOSAIC_COLS = COL_OPTIONS[0]
const MAX_MOSAIC_COLS = COL_OPTIONS[COL_OPTIONS.length - 1]
/** Weight of a chart cell: 1 when its class was a coin toss, up to 5 when it was clear-cut. */
const CERTAINTY_WEIGHT = 4
/** Border rows are locked to yarn A anyway; an extra top row that is not locked yields to the chart. */
const PAPER_WEIGHT = 1

/**
 * Lays a read chart out as a mosaic target: one yarn-A border row at the bottom and at the top
 * (rows 1 and the last are locked in mosaic), chart row 0 (the top of the picture) ending at the
 * top, every chart row repeated `rowsPerChartRow` times, and one more yarn-A row at the top when
 * needed to make the total odd. Ink shows yarn B unless inverted. Null when the result would
 * exceed 119 rows or 120 columns (or fall below the 5 x 5 minimum).
 */
export function chartToMosaicTarget(analysis: ChartAnalysis, options: ChartTargetOptions): ChartMosaicTarget | null {
  const k = options.rowsPerChartRow
  if (k !== 1 && k !== 2) throw new RangeError('Use 1 ou 2 carreiras por linha do gráfico.')
  const chartRows = analysis.ink.length
  const cols = analysis.ink[0]?.length ?? 0
  if (
    chartRows < 1 ||
    analysis.ink.some((row) => row.length !== cols) ||
    analysis.certainty.length !== chartRows ||
    analysis.certainty.some((row) => row.length !== cols)
  ) {
    throw new RangeError('A leitura do gráfico está incompleta.')
  }
  let rows = chartRows * k + 2
  if (rows % 2 === 0) rows++
  if (rows < MIN_MOSAIC_ROWS || rows > MAX_MOSAIC_ROWS || cols < MIN_MOSAIC_COLS || cols > MAX_MOSAIC_COLS) return null
  const desired: boolean[][] = []
  const weights: number[][] = []
  const paper = () => {
    desired.push(Array<boolean>(cols).fill(false))
    weights.push(Array<number>(cols).fill(PAPER_WEIGHT))
  }
  paper()
  for (let i = chartRows - 1; i >= 0; i--) {
    const wants = analysis.ink[i].map((ink) => ink !== options.invert)
    const costs = analysis.certainty[i].map((certainty) => 1 + CERTAINTY_WEIGHT * (Number.isFinite(certainty) ? Math.min(1, Math.max(0, certainty)) : 0))
    for (let repeat = 0; repeat < k; repeat++) {
      desired.push([...wants])
      weights.push([...costs])
    }
  }
  while (desired.length < rows) paper()
  return { desired, weights }
}

/** A read chart (src/lib/vision) to a valid overlay mosaic, weighted by the certainty of each cell. */
export function convertChartAnalysis(analysis: ChartAnalysis, options: ChartMosaicOptions): PhotoPatternResult {
  const target = chartToMosaicTarget(analysis, options)
  if (!target) {
    throw new Error(`O gráfico tem ${analysis.cols} × ${analysis.rows} quadradinhos e não cabe no mosaico (de 5 a 120 pontos, até 119 carreiras). Escolha um tamanho manual.`)
  }
  return mosaicResult(fitMosaic(target.desired, target.weights), cleanName(options.name, 'Estudo a partir de gráfico'), options.colors)
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
