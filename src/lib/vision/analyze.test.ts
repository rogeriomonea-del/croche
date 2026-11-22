import { describe, expect, it } from 'vitest'
import { analyzeChartImage, detectGrid, findContentBox, suggestCellCounts, type RgbaImage } from './index'
import { agreement, edgingTruth, randomTruth, renderChart, renderPicture } from './fixtures'

function solid(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i)
  return { width, height, data }
}

function paint(image: RgbaImage, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) image.data.set([...rgb, 255], (y * image.width + x) * 4)
}

describe('input validation', () => {
  it('rejects empty images and pixel data of the wrong length, in Portuguese', () => {
    expect(() => analyzeChartImage({ width: 0, height: 10, data: new Uint8ClampedArray(0) })).toThrow(/Imagem inválida/)
    expect(() => detectGrid({ width: 4, height: 4, data: new Uint8ClampedArray(63) })).toThrow(/não corresponde/)
    expect(() => findContentBox({ width: 2.5, height: 4, data: new Uint8ClampedArray(40) })).toThrow(/Imagem inválida/)
    expect(() => analyzeChartImage(solid(20, 20, [255, 255, 255, 255]), { cols: Number.NaN })).toThrow(/colunas inválido/)
  })

  it('clamps forced cell counts to 1..200', () => {
    const picture = renderPicture(300, 240).image
    const big = analyzeChartImage(picture, { cols: 500, rows: 0, forceResample: true })
    expect([big.cols, big.rows]).toEqual([200, 1])
    expect(big.ink).toHaveLength(1)
    expect(big.ink[0]).toHaveLength(200)
  })
})

describe('suggestCellCounts', () => {
  it('puts the target on the longest side and keeps the cells square', () => {
    expect(suggestCellCounts({ x: 0, y: 0, width: 300, height: 150 })).toEqual({ cols: 60, rows: 30 })
    expect(suggestCellCounts({ x: 5, y: 5, width: 100, height: 400 }, 80)).toEqual({ cols: 20, rows: 80 })
    expect(suggestCellCounts({ x: 0, y: 0, width: 1000, height: 2 })).toEqual({ cols: 60, rows: 1 })
    expect(suggestCellCounts({ x: 0, y: 0, width: 50, height: 50 }, 900)).toEqual({ cols: 200, rows: 200 })
  })
})

describe('findContentBox', () => {
  it('trims a uniform margin and ignores isolated specks', () => {
    const image = solid(200, 120, [240, 236, 228, 255])
    paint(image, 30, 20, 150, 90, [40, 40, 40])
    paint(image, 190, 5, 191, 6, [0, 0, 0])
    expect(findContentBox(image)).toEqual({ x: 30, y: 20, width: 120, height: 70 })
  })

  it('keeps the whole image when there is nothing but background', () => {
    expect(findContentBox(solid(40, 30, [255, 255, 255, 255]))).toEqual({ x: 0, y: 0, width: 40, height: 30 })
  })

  it('keeps the axis numbers of a chart inside the box', () => {
    const { image, grid } = renderChart(randomTruth(30, 20, 3), { cellSize: 12 })
    const box = findContentBox(image)
    expect(box.x).toBeLessThan(grid.x0 - 10)
    expect(box.y).toBeLessThan(grid.y0 - 10)
    expect(box.y + box.height).toBeGreaterThan(grid.y0 + grid.rows * grid.cellSize + 5)
  })
})

describe('analyzeChartImage options', () => {
  const truth = edgingTruth()
  const chart = renderChart(truth, { cellSize: 12.4, blur: true, seed: 9 })

  it('resamples the content box when asked to, ignoring the grid', () => {
    const result = analyzeChartImage(chart.image, { forceResample: true, cols: 70, rows: 30 })
    expect(result.mode).toBe('resample')
    expect(result.grid).toBeNull()
    expect([result.cols, result.rows]).toEqual([70, 30])
    expect(result.crop).toEqual(findContentBox(chart.image))
  })

  it('keeps grid mode when the forced counts match the grid', () => {
    const result = analyzeChartImage(chart.image, { cols: 90, rows: 31 })
    expect(result.mode).toBe('grid')
    expect(result.ink).toEqual(truth)
  })

  it('resamples the grid area, without its margins, when the forced counts differ from the grid', () => {
    const result = analyzeChartImage(chart.image, { cols: 45 })
    expect(result.mode).toBe('resample')
    expect(result.grid).not.toBeNull()
    expect(result.cols).toBe(45)
    expect(result.rows).toBe(15)
    expect(Math.abs(result.crop.x - chart.grid.x0)).toBeLessThanOrEqual(1)
    expect(Math.abs(result.crop.y - chart.grid.y0)).toBeLessThanOrEqual(1)
    expect(Math.abs(result.crop.width - 90 * 12.4)).toBeLessThanOrEqual(2)
  })

  it('moves the ink boundary with inkBias', () => {
    const picture = renderPicture(400, 300).image
    const count = (ink: boolean[][]) => ink.flat().filter(Boolean).length
    const less = count(analyzeChartImage(picture, { inkBias: -0.8 }).ink)
    const neutral = count(analyzeChartImage(picture).ink)
    const more = count(analyzeChartImage(picture, { inkBias: 0.8 }).ink)
    expect(less).toBeLessThan(neutral)
    expect(neutral).toBeLessThan(more)
  })

  it('reports per-cell certainty in 0..1, high for a clean chart', () => {
    const result = analyzeChartImage(chart.image)
    const values = result.certainty.flat()
    expect(values).toHaveLength(90 * 31)
    expect(values.every((v) => v >= 0 && v <= 1)).toBe(true)
    expect(Math.min(...values)).toBeGreaterThan(0.5)
    const edge = analyzeChartImage(renderPicture(400, 300).image).certainty.flat()
    expect(Math.min(...edge)).toBeLessThan(0.3)
  })

  it('composites transparent pixels onto white', () => {
    const image = solid(120, 90, [0, 0, 0, 0])
    paint(image, 30, 20, 90, 70, [20, 20, 20])
    const result = analyzeChartImage(image, { forceResample: true })
    expect(result.crop).toEqual({ x: 30, y: 20, width: 60, height: 50 })
    expect(result.ink.flat().every(Boolean)).toBe(true)
  })

  it('takes the more saturated colour as ink when both are equally light', () => {
    // CIELAB L*: 45 for the red, 42 for the grey, so the red is not the darker one.
    const image = solid(80, 40, [100, 100, 100, 255])
    paint(image, 0, 0, 40, 40, [190, 60, 70])
    const result = analyzeChartImage(image, { forceResample: true, cols: 2, rows: 1 })
    expect(result.ink).toEqual([[true, false]])
    expect(result.colors).toEqual({ ink: '#be3c46', paper: '#646464' })
  })

  it('reads a blank picture as paper', () => {
    const result = analyzeChartImage(solid(80, 60, [250, 250, 250, 255]))
    expect(result.mode).toBe('resample')
    expect(result.ink.flat().some(Boolean)).toBe(false)
  })

  it('still reads the chart in resample mode when its grid is forced away', () => {
    const tight = renderChart(truth, { cellSize: 12, labels: false, margins: { left: 0, top: 0, right: 0, bottom: 0 }, noise: 0 })
    const result = analyzeChartImage(tight.image, { forceResample: true, cols: 90, rows: 31 })
    expect(agreement(result.ink, truth)).toBeGreaterThan(0.97)
  })
})
