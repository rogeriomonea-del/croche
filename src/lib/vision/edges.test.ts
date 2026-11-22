import { describe, expect, it } from 'vitest'
import { analyzeChartImage, detectGrid } from './index'
import { cropImage, randomTruth, renderBleed, renderChart, type ChartRenderOptions } from './fixtures'

/** A crisp two-colour chart without labels; the margins are cut away by cropImage. */
const STYLE: ChartRenderOptions = {
  cellSize: 12.4,
  labels: false,
  margins: { left: 20, top: 20, right: 20, bottom: 20 },
  inkColor: [139, 30, 30],
  blur: true,
  noise: 10,
}

/** The chart cut by the image border so that each outer cell keeps `visible` of its width or height. */
function cutChart(truth: boolean[][], visible: number, style: ChartRenderOptions = STYLE) {
  const { image, grid } = renderChart(truth, style)
  const cs = grid.cellSize
  const cut = (1 - visible) * cs
  const x0 = Math.round(grid.x0 + cut)
  const y0 = Math.round(grid.y0 + cut)
  const x1 = Math.round(grid.x0 + grid.cols * cs - cut)
  const y1 = Math.round(grid.y0 + grid.rows * cs - cut)
  return cropImage(image, x0, y0, x1, y1)
}

describe('edge cells cut off by the image border', () => {
  it.each([
    ['dark red, 12.4 px cells', STYLE],
    ['dark red, 17.8 px cells', { ...STYLE, cellSize: 17.8, seed: 4 }],
    ['black on white, 9.3 px cells', { ...STYLE, cellSize: 9.3, inkColor: [0, 0, 0] as const, seed: 7 }],
  ])('reads the outer cells when 85 percent of them is in the picture: %s', (_name, style) => {
    const truth = randomTruth(40, 24, 12)
    const result = analyzeChartImage(cutChart(truth, 0.85, style))
    expect(result.mode).toBe('grid')
    expect([result.cols, result.rows]).toEqual([40, 24])
    expect(result.ink).toEqual(truth)
  })

  it('leaves out outer cells of which only 40% is in the picture', () => {
    const truth = randomTruth(40, 24, 13)
    const result = analyzeChartImage(cutChart(truth, 0.4))
    expect(result.mode).toBe('grid')
    expect([result.cols, result.rows]).toEqual([38, 22])
    expect(result.ink).toEqual(truth.slice(1, -1).map((row) => row.slice(1, -1)))
  })

  it('does not take a plain page margin one cell wide for a row or column of cells', () => {
    const truth = randomTruth(40, 24, 14)
    const cs = 12.4
    const { image } = renderChart(truth, { ...STYLE, margins: { left: cs, top: cs, right: cs, bottom: cs } })
    const result = analyzeChartImage(image)
    expect([result.cols, result.rows]).toEqual([40, 24])
    expect(result.ink).toEqual(truth)
  })

  it('reads every cell of a full-bleed 8 x 8 weave', () => {
    const truth = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => (i + j) % 2 === 0))
    const image = renderBleed(truth, 40, 30)
    const grid = detectGrid(image)
    expect([grid?.x.count, grid?.y.count]).toEqual([8, 8])
    const result = analyzeChartImage(image)
    expect(result.mode).toBe('grid')
    expect(result.ink).toEqual(truth)
  })
})
