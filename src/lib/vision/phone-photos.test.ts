import { describe, expect, it } from 'vitest'
import { analyzeChartImage } from './index'
import { agreement, edgingTruth, photograph, randomTruth, renderChart, rotation } from './fixtures'

/**
 * Phone photos of the two 90 x 31 charts (with axis numbers, arrows and watermark) over the range of
 * screen sizes and small tilts a photo of a screen shows: the full grid, every row and column, and
 * its cells. A straight lattice that drifts with the tilt loses a row at no cost in confidence; blur
 * lets the axis numbers pass for a row and hides the faint lines of plain paper rows.
 */
const charts = [
  ['edging', edgingTruth()],
  ['random', randomTruth(90, 31, 1)],
] as const

describe('tilted phone photos of a 90 x 31 chart', () => {
  const cases = charts.flatMap(([name, truth]) =>
    [8, 9.3, 10, 11.5, 12.4, 13.1].flatMap((cellSize) => [0, 1, -1, 3].map((tilt) => [name, cellSize, tilt, truth] as const)),
  )
  it.each(cases)('%s chart, %s px cells, tilted %s degrees, blur 1, noise 8', (_name, cellSize, tilt, truth) => {
    const { image } = renderChart(truth, { cellSize })
    const photo = photograph(image, { warp: tilt ? rotation(image.width, image.height, tilt) : undefined, blur: 1, noise: 8, seed: 4 })
    const result = analyzeChartImage(photo)
    expect(result.mode).toBe('grid')
    expect([result.cols, result.rows]).toEqual([90, 31])
    expect(agreement(result.ink, truth)).toBeGreaterThanOrEqual(0.98)
  })
})

describe('blurred phone photos of a 90 x 31 chart', () => {
  const cases = charts.flatMap(([name, truth]) =>
    [9.3, 10].flatMap((cellSize) => [true, false].map((labels) => [name, cellSize, labels, truth] as const)),
  )
  it.each(cases)('%s chart, %s px cells, axis numbers %s, blur 1.5, noise 8', (_name, cellSize, labels, truth) => {
    const { image } = renderChart(truth, { cellSize, labels })
    const result = analyzeChartImage(photograph(image, { blur: 1.5, noise: 8, seed: 4 }))
    expect(result.mode).toBe('grid')
    expect([result.cols, result.rows]).toEqual([90, 31])
    expect(agreement(result.ink, truth)).toBeGreaterThanOrEqual(0.98)
  })
})

describe('correcting the size of a misread photo', () => {
  it('fits the given counts to the chart instead of resampling the box of the wrong grid', () => {
    // Horizontal moiré carries the rows into the margins: the grid found has more rows than the chart.
    const truth = edgingTruth()
    const { image } = renderChart(truth, { cellSize: 12.4, noise: 0, margins: { left: 70, top: 70, right: 70, bottom: 80 } })
    const photo = photograph(image, { moire: [{ amplitude: 14, period: 5.3 }, { amplitude: 10, period: 37 }], blur: 1, noise: 8, seed: 2 })
    const detected = analyzeChartImage(photo)
    expect([detected.cols, detected.rows]).not.toEqual([90, 31])
    const corrected = analyzeChartImage(photo, { cols: 90, rows: 31 })
    expect(corrected.mode).toBe('grid')
    expect([corrected.cols, corrected.rows]).toEqual([90, 31])
    expect(agreement(corrected.ink, truth)).toBeGreaterThanOrEqual(0.98)
  })
})
