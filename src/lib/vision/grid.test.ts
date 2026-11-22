import { describe, expect, it } from 'vitest'
import { analyzeChartImage, detectGrid } from './index'
import {
  agreement, downsampleMask, edgingTruth, invert, iou, randomTruth, renderChart, renderPicture, renderTextPage,
  type ChartRenderOptions,
} from './fixtures'

/** The user's screenshot: 1179 x 481, dark red and white cells, grey lines, numbers, arrows and a watermark. */
const SCREENSHOT: ChartRenderOptions = {
  cellSize: 12.4,
  margins: { left: 45, top: 40, right: 18, bottom: 56 },
  inkColor: [139, 30, 30],
  paperColor: [255, 255, 255],
  lineColor: [184, 188, 196],
  blur: true,
  noise: 10,
}

describe('edging fixture', () => {
  it('has 1-cell motifs, isolated cells and an all-paper area under the scallops', () => {
    const truth = edgingTruth()
    expect([truth.length, truth[0].length]).toEqual([31, 90])
    for (let i = 20; i < 31; i++) expect(truth[i].every((v) => !v)).toBe(true)
    const isolated = truth.slice(1, 20).flatMap((row, r) =>
      row.filter((v, j) => v && j > 0 && j < 89 && !row[j - 1] && !row[j + 1] && !truth[r][j] && !truth[r + 2][j]),
    )
    expect(isolated.length).toBeGreaterThan(20)
  })
})

describe('G1: exact recovery of the user screenshot', () => {
  it('finds the 90 x 31 grid inside the numbers, arrows and watermark and reads every cell', () => {
    const truth = edgingTruth()
    const { image, grid } = renderChart(truth, SCREENSHOT)
    expect([image.width, image.height]).toEqual([1179, 481])
    const result = analyzeChartImage(image)
    expect(result.mode).toBe('grid')
    expect([result.cols, result.rows]).toEqual([90, 31])
    expect(result.ink).toEqual(truth)
    expect(result.grid!.x.start).toBeCloseTo(grid.x0, 0)
    expect(result.grid!.y.start).toBeCloseTo(grid.y0, 0)
    expect(Math.abs(result.grid!.x.pitch - 12.4)).toBeLessThan(0.02)
    expect(Math.abs(result.grid!.y.pitch - 12.4)).toBeLessThan(0.02)
    expect(result.colors).toEqual({ ink: expect.stringMatching(/^#8[a-c]1[d-f]1[d-f]$/), paper: expect.stringMatching(/^#f[c-f]f[c-f]f[c-f]$/) })
    expect(result.confidence).toBeGreaterThan(0.6)
  })
})

describe('G2: robustness', () => {
  it.each([6.5, 9.3, 17.8, 13.1])('reads every cell at cell size %s', (cellSize) => {
    const truth = edgingTruth()
    const { image } = renderChart(truth, { ...SCREENSHOT, margins: undefined, cellSize, seed: Math.round(cellSize * 10) })
    const result = analyzeChartImage(image)
    expect(result.mode).toBe('grid')
    expect([result.cols, result.rows]).toEqual([90, 31])
    expect(result.ink).toEqual(truth)
  })

  it.each([
    ['dark green on cream', [30, 90, 50], [245, 240, 220]],
    ['navy on white', [20, 30, 90], [255, 255, 255]],
    ['black on white', [0, 0, 0], [255, 255, 255]],
  ] as const)('reads every cell for %s', (_name, inkColor, paperColor) => {
    const truth = randomTruth(48, 36, inkColor[2] + 7)
    const { image } = renderChart(truth, { ...SCREENSHOT, margins: undefined, inkColor, paperColor, seed: inkColor[1] })
    const result = analyzeChartImage(image)
    expect(result.mode).toBe('grid')
    expect(result.ink).toEqual(truth)
    const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
    const near = (a: string, b: string) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 4)
    expect(near(result.colors.ink, hex(inkColor))).toBe(true)
    expect(near(result.colors.paper, hex(paperColor))).toBe(true)
  })

  it('keeps ink as the darker class when the chart draws light stitches on dark paper', () => {
    const truth = edgingTruth()
    const { image } = renderChart(truth, {
      ...SCREENSHOT,
      margins: undefined,
      inkColor: [245, 238, 215],
      paperColor: [28, 32, 64],
      lineColor: [90, 95, 110],
      majorLineColor: [140, 140, 150],
      pageColor: [250, 250, 250],
      seed: 21,
    })
    const result = analyzeChartImage(image)
    expect(result.mode).toBe('grid')
    expect(result.ink).toEqual(invert(truth))
    const lightness = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
    expect(lightness(result.colors.ink)).toBeLessThan(lightness(result.colors.paper))
    expect(result.colors.ink).toMatch(/^#[0-3][0-9a-f][0-3][0-9a-f][3-5][0-9a-f]$/)
  })

  it('reads a 5 x 5 chart', () => {
    const truth = randomTruth(5, 5, 21, 0.5)
    const result = analyzeChartImage(renderChart(truth, { ...SCREENSHOT, margins: undefined, seed: 5 }).image)
    expect(result.mode).toBe('grid')
    expect(result.ink).toEqual(truth)
  })

  it.each([1, 3, 4])('reads a 5 x 5 chart of 8 px cells inside wider margins (seed %s)', (seed) => {
    const truth = randomTruth(5, 5, seed + 30, 0.5)
    const result = analyzeChartImage(renderChart(truth, { cellSize: 8, blur: true, seed }).image)
    expect(result.mode).toBe('grid')
    expect(result.ink).toEqual(truth)
  })

  it('reads a 120 x 119 chart', () => {
    const truth = randomTruth(120, 119, 41)
    const result = analyzeChartImage(renderChart(truth, { ...SCREENSHOT, margins: undefined, cellSize: 7.3, seed: 6 }).image)
    expect(result.mode).toBe('grid')
    expect([result.cols, result.rows]).toEqual([120, 119])
    expect(result.ink).toEqual(truth)
  })

  it('reads at least 99.5% of the cells under heavy noise', () => {
    const truth = edgingTruth()
    const result = analyzeChartImage(renderChart(truth, { ...SCREENSHOT, noise: 25, seed: 4 }).image)
    expect(result.mode).toBe('grid')
    expect([result.cols, result.rows]).toEqual([90, 31])
    expect(agreement(result.ink, truth)).toBeGreaterThanOrEqual(0.995)
  })

  it('reads charts whose lines between two filled cells are faint', () => {
    const truth = edgingTruth()
    const result = analyzeChartImage(renderChart(truth, { ...SCREENSHOT, inkLineColor: [150, 60, 60], seed: 8 }).image)
    expect(result.mode).toBe('grid')
    expect(result.ink).toEqual(truth)
  })
})

describe('G3: no false grid', () => {
  it('finds no grid in a plain picture and resamples the silhouette faithfully', () => {
    const picture = renderPicture(900, 700)
    expect(detectGrid(picture.image)).toBeNull()
    const result = analyzeChartImage(picture.image)
    expect(result.mode).toBe('resample')
    expect(result.grid).toBeNull()
    const expected = downsampleMask(picture.mask, picture.image.width, result.crop, result.cols, result.rows)
    expect(iou(result.ink, expected)).toBeGreaterThanOrEqual(0.9)
  })

  it('finds no grid in noise, a smooth gradient or stripes', () => {
    const w = 400
    const h = 300
    const make = (pixel: (x: number, y: number) => number) => {
      const data = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = pixel(x, y)
          data.set([v, v, v, 255], (y * w + x) * 4)
        }
      }
      return { width: w, height: h, data }
    }
    let state = 7
    const random = () => ((state = (state * 1103515245 + 12345) >>> 0) / 4294967296)
    expect(detectGrid(make(() => 128 + (random() * 2 - 1) * 60))).toBeNull()
    expect(detectGrid(make((x, y) => x / 2 + y / 3 + random() * 10))).toBeNull()
    expect(detectGrid(make((_x, y) => (Math.floor(y / 9) % 2 ? 60 : 220)))).toBeNull()
  })

  it.each([1, 2, 3, 4])('finds no grid in a page of monospaced text (seed %s)', (seed) => {
    expect(detectGrid(renderTextPage(seed))).toBeNull()
  })
})
