import { describe, expect, it } from 'vitest'
import { cellYarn, cellsOf, conflicts, deriveX, emptyMatrix, instructions, parseDocument, toDocument, type Matrix } from '../core'
import { automaticPhotoThreshold, chartToMosaicTarget, convertChartAnalysis, convertPhotoPixels, fitMosaic, photoPlacement, type PhotoPixels } from './photo-pattern'
import type { ChartAnalysis } from './vision'

const settings = { threshold: 128, invert: false, name: 'Minha fotografia', colors: { main: '#f3ead8', pattern: '#52384e' } }

function pixels(width = 5, height = 7, value = 255): PhotoPixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([value, value, value, 255], i)
  return { width, height, data }
}

function render(delta: Matrix): PhotoPixels {
  const picture = pixels(delta[0].length, delta.length)
  for (let y = 0; y < picture.height; y++) {
    for (let c = 0; c < picture.width; c++) {
      const value = cellYarn(delta, picture.height - y, c + 1) === 'pattern' ? 0 : 255
      picture.data.set([value, value, value, 255], (y * picture.width + c) * 4)
    }
  }
  return picture
}

describe('photograph to valid overlay mosaic', () => {
  it('preserves asymmetric geometry, bottom-first row orientation, and left-to-right columns', () => {
    const expected = emptyMatrix(7, 5)
    expected[1][0] = true
    expected[3][3] = true
    expected[5][1] = true
    const result = convertPhotoPixels(render(expected), settings)
    expect(result.design.delta).toEqual(expected)
    expect(result.adaptedCells).toBe(0)
    expect(result.instructions).toEqual(instructions(deriveX(expected)))
    expect(result.instructions[2]).toBe('Row 3: 4 sc and 1 dc')
    expect(result.doubleCrochets).toBe(3)
    expect(result.singleCrochets).toBe(32)
  })

  it('keeps one boolean per cell and produces a valid round-trippable document', () => {
    const result = convertPhotoPixels(pixels(), settings)
    expect(Object.keys(result.design).sort()).toEqual(['colors', 'delta', 'name'])
    expect(result.design.delta.flat().every((cell) => typeof cell === 'boolean')).toBe(true)
    expect(parseDocument(toDocument(result.design)).ok).toBe(true)
    expect(result.instructions.length).toBe(7)
  })

  it('holds the base and top rows in yarn A even when the whole photograph wants yarn B', () => {
    const result = convertPhotoPixels(pixels(5, 7, 0), settings)
    expect(result.design.delta[0]).toEqual(Array(5).fill(false))
    expect(result.design.delta[6]).toEqual(Array(5).fill(false))
    expect(result.adaptedCells).toBe(10)
    expect(cellsOf(deriveX(result.design.delta)).every(([row]) => row >= 3)).toBe(true)
  })

  it('handles the maximum 119 × 120 size without consecutive deviations or stitch conflicts', () => {
    const input = pixels(120, 119)
    for (let i = 0; i < input.data.length; i += 4) {
      const value = (i * 17 + (i % 23) * 51) % 256
      input.data.set([value, value, value, 255], i)
    }
    const result = convertPhotoPixels(input, settings)
    expect(result.design.delta).toHaveLength(119)
    expect(result.design.delta[0]).toHaveLength(120)
    expect(result.conflictCount).toBe(0)
    expect(cellsOf(conflicts(deriveX(result.design.delta)))).toEqual([])
    expect(parseDocument(toDocument(result.design)).ok).toBe(true)
    for (let r = 1; r < 119; r++) {
      for (let c = 0; c < 120; c++) expect(result.design.delta[r][c] && result.design.delta[r - 1][c]).toBe(false)
    }
  })

  it('chooses a minimum-error valid column, matching an exhaustive small-pattern oracle', () => {
    const input = pixels(5, 7)
    const gray = [0, 42, 90, 128, 170, 210, 255]
    for (let y = 0; y < 7; y++) {
      for (let c = 0; c < 5; c++) {
        const value = gray[(y * 3 + c * 4) % gray.length]
        input.data.set([value, value, value, 255], (y * 5 + c) * 4)
      }
    }
    for (const threshold of [35, 128, 221]) {
      for (const invert of [false, true]) {
        const result = convertPhotoPixels(input, { ...settings, threshold, invert })
        for (let c = 0; c < 5; c++) {
          const cost = (column: boolean[]) => column.reduce((sum, deviation, r) => {
            const value = input.data[((6 - r) * 5 + c) * 4]
            const wantsPattern = (value < threshold) !== invert
            const isPattern = (r % 2 === 1) !== deviation
            return sum + (isPattern === wantsPattern ? 0 : 1 + Math.abs(value - threshold))
          }, 0)
          let optimum = Infinity
          for (let mask = 0; mask < 32; mask++) {
            const column = [false, ...Array.from({ length: 5 }, (_, index) => Boolean(mask & (1 << index))), false]
            if (column.some((value, r) => value && column[r - 1])) continue
            optimum = Math.min(optimum, cost(column))
          }
          expect(cost(result.design.delta.map((row) => row[c]))).toBeCloseTo(optimum, 8)
        }
      }
    }
  })

  it('composites fully transparent pixels to white instead of interpreting their hidden black RGB', () => {
    const transparent = pixels(5, 7, 0)
    for (let i = 3; i < transparent.data.length; i += 4) transparent.data[i] = 0
    expect(convertPhotoPixels(transparent, settings).design.delta).toEqual(convertPhotoPixels(pixels(), settings).design.delta)
    expect(convertPhotoPixels(transparent, { ...settings, invert: true }).design.delta)
      .toEqual(convertPhotoPixels(pixels(), { ...settings, invert: true }).design.delta)
  })

  it('composites partially transparent pixels before thresholding', () => {
    const transparent = pixels(5, 7, 0)
    for (let i = 3; i < transparent.data.length; i += 4) transparent.data[i] = 128
    const result = convertPhotoPixels(transparent, { ...settings, threshold: 100 })
    expect(result.design.delta).toEqual(convertPhotoPixels(pixels(5, 7, 127), { ...settings, threshold: 100 }).design.delta)
  })

  it('inverts the desired motif without inverting the protected rows', () => {
    const normal = convertPhotoPixels(pixels(), settings)
    const inverted = convertPhotoPixels(pixels(), { ...settings, invert: true })
    expect(normal.design.delta).not.toEqual(inverted.design.delta)
    expect(inverted.design.delta[0].some(Boolean)).toBe(false)
    expect(inverted.design.delta[6].some(Boolean)).toBe(false)
    expect(inverted.adaptedCells).toBe(10)
  })

  it('responds to a changed threshold and permits the extreme endpoints', () => {
    const source = pixels(5, 7, 130)
    expect(convertPhotoPixels(source, { ...settings, threshold: 128 }).design.delta)
      .not.toEqual(convertPhotoPixels(source, { ...settings, threshold: 150 }).design.delta)
    expect(convertPhotoPixels(source, { ...settings, threshold: 0 }).conflictCount).toBe(0)
    expect(convertPhotoPixels(source, { ...settings, threshold: 255 }).conflictCount).toBe(0)
  })

  it('normalizes names and colors through the existing document contract without mutating input', () => {
    const input = pixels()
    const before = input.data.slice()
    const options = { ...settings, name: '  Olá\n\uD800  ', colors: { main: '#FFFFFF', pattern: '#000000' } }
    const result = convertPhotoPixels(input, options)
    expect(result.design.name).toBe('Olá')
    expect(result.design.colors).toEqual({ main: '#ffffff', pattern: '#000000' })
    expect(options.colors.main).toBe('#FFFFFF')
    expect(input.data).toEqual(before)
    expect(convertPhotoPixels(input, { ...settings, name: '' }).design.name).toBe('Estudo a partir de fotografia')
    expect([...convertPhotoPixels(input, { ...settings, name: '🧶'.repeat(120) }).design.name]).toHaveLength(100)
  })

  it.each([[4, 5], [121, 5], [5, 4], [5, 6], [5, 121], [5.5, 5], [NaN, 5]])('rejects dimensions %s × %s', (width, height) => {
    expect(() => convertPhotoPixels({ width, height, data: new Uint8ClampedArray(0) }, settings)).toThrow('Escolha')
  })

  it.each([-1, 256, NaN, Infinity])('rejects threshold %s', (threshold) => {
    expect(() => convertPhotoPixels(pixels(), { ...settings, threshold })).toThrow('contraste')
  })

  it('rejects truncated pixels and invalid yarn colors', () => {
    expect(() => convertPhotoPixels({ width: 5, height: 7, data: new Uint8ClampedArray(12) }, settings)).toThrow('pixels')
    expect(() => convertPhotoPixels(pixels(), { ...settings, colors: { main: 'linen', pattern: '#52384e' } })).toThrow('cores')
  })
})

describe('photo preparation', () => {
  it('selects a stable midpoint threshold for a clearly separated black and white photo', () => {
    const source = pixels()
    for (let i = 0; i < 60; i += 4) source.data.set([0, 0, 0, 255], i)
    expect(automaticPhotoThreshold(source)).toBe(128)
    expect(automaticPhotoThreshold(pixels())).toBe(128)
  })

  it('fits a photo without distortion and centers letterboxing', () => {
    expect(photoPlacement(200, 100, 20, 20, 'contain')).toEqual({ x: 0, y: 5, width: 20, height: 10 })
    expect(photoPlacement(100, 200, 20, 20, 'contain')).toEqual({ x: 5, y: 0, width: 10, height: 20 })
  })

  it('crops the center without distorting the photograph', () => {
    expect(photoPlacement(200, 100, 20, 20, 'cover')).toEqual({ x: -10, y: 0, width: 40, height: 20 })
    expect(photoPlacement(100, 200, 20, 20, 'cover')).toEqual({ x: 0, y: -10, width: 20, height: 40 })
  })

  it('rejects invalid source sizes', () => {
    expect(() => photoPlacement(0, 200, 20, 20, 'cover')).toThrow('dimensões')
    expect(() => photoPlacement(100, NaN, 20, 20, 'contain')).toThrow('dimensões')
  })
})

/** Visible yarn per cell, [r-1][c-1] with row 1 at the bottom: true = yarn B. */
function visible(delta: Matrix): boolean[][] {
  return delta.map((row, r) => row.map((_, c) => cellYarn(delta, r + 1, c + 1) === 'pattern'))
}

function chartAnalysis(ink: boolean[][], certainty?: number[][]): ChartAnalysis {
  const rows = ink.length
  const cols = ink[0].length
  return {
    mode: 'grid', rows, cols, ink,
    certainty: certainty ?? ink.map((row) => row.map(() => 1)),
    colors: { paper: '#ffffff', ink: '#b01c2e' },
    grid: null,
    crop: { x: 0, y: 0, width: cols * 10, height: rows * 10 },
    confidence: 1,
  }
}

const chartSettings = { rowsPerChartRow: 1 as const, invert: false, name: 'Gráfico de filé', colors: { main: '#f3ead8', pattern: '#52384e' } }

/** Horizontal bands 3 chart rows tall, phased so every band edge lands on the wrong stripe at 1 row per chart row. */
const bandsOfThree = (cols: number, rows: number) =>
  Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, () => (((rows - 2 - i) % 6) + 6) % 6 < 3))

describe('fitMosaic', () => {
  it('reproduces any reachable target exactly, without mutating its inputs', () => {
    const delta = emptyMatrix(9, 6)
    delta[1][0] = delta[3][0] = delta[5][2] = delta[2][4] = delta[7][5] = true
    const desired = visible(delta)
    const weights = desired.map((row) => row.map(() => 2))
    const before = JSON.stringify([desired, weights])
    const fit = fitMosaic(desired, weights)
    expect(fit.delta).toEqual(delta)
    expect(fit.adaptedCells).toBe(0)
    expect(JSON.stringify([desired, weights])).toBe(before)
  })

  it('finds the minimum weighted error per column, matching an exhaustive oracle', () => {
    const rows = 9
    const cols = 6
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const desired = Array.from({ length: rows }, () => Array.from({ length: cols }, () => random() < 0.5))
    const weights = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.round(random() * 40) / 8))
    const fit = fitMosaic(desired, weights)
    for (let c = 0; c < cols; c++) {
      const cost = (column: boolean[]) => column.reduce((sum, deviation, r) => sum + (((r % 2 === 1) !== deviation) === desired[r][c] ? 0 : weights[r][c]), 0)
      let optimum = Infinity
      for (let mask = 0; mask < 1 << (rows - 2); mask++) {
        const column = [false, ...Array.from({ length: rows - 2 }, (_, i) => Boolean(mask & (1 << i))), false]
        if (column.some((value, r) => value && column[r - 1])) continue
        optimum = Math.min(optimum, cost(column))
      }
      expect(cost(fit.delta.map((row) => row[c]))).toBeCloseTo(optimum, 9)
    }
    expect(cellsOf(conflicts(deriveX(fit.delta)))).toEqual([])
  })

  it('rejects sizes outside the mosaic and weights that do not match', () => {
    const ok = Array.from({ length: 5 }, () => Array<boolean>(5).fill(false))
    const ones = Array.from({ length: 5 }, () => Array<number>(5).fill(1))
    expect(() => fitMosaic(ok.slice(1), ones.slice(1))).toThrow('Escolha')
    expect(() => fitMosaic(ok.map((row) => row.slice(1)), ones.map((row) => row.slice(1)))).toThrow('Escolha')
    expect(() => fitMosaic(ok, ones.slice(1))).toThrow('pesos')
    expect(() => fitMosaic(ok, ones.map((row, r) => (r === 2 ? [1, 1, -1, 1, 1] : row)))).toThrow('pesos')
    expect(() => fitMosaic(ok, ones.map((row, r) => (r === 2 ? [1, 1, NaN, 1, 1] : row)))).toThrow('pesos')
  })
})

describe('chartToMosaicTarget', () => {
  const none = () => Array<boolean>(5).fill(false)
  // Chart rows from the top: [ink, paper, paper, paper, ink], all paper, all ink.
  const ink = [[true, false, false, false, true], none(), Array<boolean>(5).fill(true)]
  const certainty = [[1, 0.5, 0, 0.25, 1], Array<number>(5).fill(0.75), Array<number>(5).fill(0)]

  it('adds one yarn-A border row below and above, with chart row 0 at the top', () => {
    const target = chartToMosaicTarget(chartAnalysis(ink, certainty), { rowsPerChartRow: 1, invert: false })!
    expect(target.desired).toEqual([none(), ink[2], ink[1], ink[0], none()])
    expect(target.weights).toEqual([Array(5).fill(1), Array(5).fill(1), Array(5).fill(4), [5, 3, 1, 2, 5], Array(5).fill(1)])
  })

  it('repeats every chart row and pads the top so the total stays odd', () => {
    const target = chartToMosaicTarget(chartAnalysis(ink, certainty), { rowsPerChartRow: 2, invert: false })!
    expect(target.desired).toEqual([none(), ink[2], ink[2], ink[1], ink[1], ink[0], ink[0], none(), none()])
    expect(target.weights[5]).toEqual([5, 3, 1, 2, 5])
    expect(target.weights[6]).toEqual([5, 3, 1, 2, 5])
    expect(target.weights[8]).toEqual(Array(5).fill(1))
  })

  it('inverts the chart cells but keeps the border rows in yarn A', () => {
    const target = chartToMosaicTarget(chartAnalysis(ink), { rowsPerChartRow: 1, invert: true })!
    expect(target.desired[0]).toEqual(none())
    expect(target.desired[4]).toEqual(none())
    expect(target.desired[3]).toEqual([false, true, true, true, false])
    expect(target.desired[1]).toEqual(none())
  })

  it('returns null when the mosaic would exceed 119 rows or 120 columns, or fall below 5', () => {
    const blank = (cols: number, rows: number) => chartAnalysis(Array.from({ length: rows }, () => Array<boolean>(cols).fill(false)))
    expect(chartToMosaicTarget(blank(120, 117), { rowsPerChartRow: 1, invert: false })?.desired).toHaveLength(119)
    expect(chartToMosaicTarget(blank(5, 118), { rowsPerChartRow: 1, invert: false })).toBeNull()
    expect(chartToMosaicTarget(blank(5, 58), { rowsPerChartRow: 2, invert: false })?.desired).toHaveLength(119)
    expect(chartToMosaicTarget(blank(5, 59), { rowsPerChartRow: 2, invert: false })).toBeNull()
    expect(chartToMosaicTarget(blank(121, 10), { rowsPerChartRow: 1, invert: false })).toBeNull()
    expect(chartToMosaicTarget(blank(4, 10), { rowsPerChartRow: 1, invert: false })).toBeNull()
    expect(chartToMosaicTarget(blank(5, 3), { rowsPerChartRow: 1, invert: false })?.desired).toHaveLength(5)
  })
})

describe('convertChartAnalysis', () => {
  it('turns a hand-built 90 × 31 chart into a conflict-free 90 × 33 mosaic, or 90 × 65 with 2 rows per chart row', () => {
    const analysis = chartAnalysis(bandsOfThree(90, 31))
    const single = convertChartAnalysis(analysis, chartSettings)
    const double = convertChartAnalysis(analysis, { ...chartSettings, rowsPerChartRow: 2 })
    for (const [result, rows] of [[single, 33], [double, 65]] as const) {
      expect(result.design.delta).toHaveLength(rows)
      expect(result.design.delta.every((row) => row.length === 90)).toBe(true)
      expect(result.conflictCount).toBe(0)
      expect(cellsOf(conflicts(deriveX(result.design.delta)))).toEqual([])
      expect(parseDocument(toDocument(result.design)).ok).toBe(true)
      expect(result.instructions).toHaveLength(rows)
      expect(result.doubleCrochets + result.singleCrochets).toBe(rows * 90)
    }
    expect(single.adaptedCells).toBeGreaterThan(0)
    expect(double.adaptedCells).toBeLessThan(single.adaptedCells)
  })

  it('reproduces a chart the mosaic can hold, row 0 at the top and columns left to right', () => {
    // Solid vertical bars are free in overlay mosaic, and so is one cell on a yarn-B stripe.
    const ink = Array.from({ length: 7 }, () => Array.from({ length: 6 }, (_, j) => j === 1 || j === 4))
    ink[0][5] = true
    const result = convertChartAnalysis(chartAnalysis(ink), chartSettings)
    expect(result.adaptedCells).toBe(0)
    const shown = visible(result.design.delta)
    expect(shown).toHaveLength(9)
    expect(shown[0].some(Boolean)).toBe(false)
    expect(shown[8].some(Boolean)).toBe(false)
    for (let i = 0; i < 7; i++) expect(shown[7 - i]).toEqual(ink[i])
  })

  it('sacrifices the less certain cell when the rules force a choice', () => {
    // Chart (top to bottom): ink, ink, paper. Mosaic rows 2 (paper) and 3 (ink) cannot both match.
    const ink = [Array<boolean>(5).fill(true), Array<boolean>(5).fill(true), Array<boolean>(5).fill(false)]
    const doubtAbove = [Array(5).fill(1), Array(5).fill(0.1), Array(5).fill(1)]
    const doubtBelow = [Array(5).fill(1), Array(5).fill(1), Array(5).fill(0.1)]
    const above = convertChartAnalysis(chartAnalysis(ink, doubtAbove), chartSettings)
    const below = convertChartAnalysis(chartAnalysis(ink, doubtBelow), chartSettings)
    expect([above.adaptedCells, below.adaptedCells]).toEqual([5, 5])
    expect(visible(above.design.delta).slice(1, 3)).toEqual([Array(5).fill(false), Array(5).fill(false)])
    expect(visible(below.design.delta).slice(1, 3)).toEqual([Array(5).fill(true), Array(5).fill(true)])
  })

  it('names, colours and validates through the document contract', () => {
    const analysis = chartAnalysis(bandsOfThree(8, 5))
    const result = convertChartAnalysis(analysis, { ...chartSettings, name: '  ', colors: { main: '#FFFFFF', pattern: '#000000' } })
    expect(result.design.name).toBe('Estudo a partir de gráfico')
    expect(result.design.colors).toEqual({ main: '#ffffff', pattern: '#000000' })
    expect(() => convertChartAnalysis(chartAnalysis(bandsOfThree(121, 5)), chartSettings)).toThrow('121 × 5 quadradinhos')
    expect(() => convertChartAnalysis(analysis, { ...chartSettings, colors: { main: 'linen', pattern: '#000000' } })).toThrow('cores')
  })
})
