import { describe, expect, it } from 'vitest'
import { analyzeChartImage } from './index'
import { agreement, edgingTruth, photograph, randomTruth, renderChart, rotation } from './fixtures'

/**
 * Seeded sweeps over the photo conditions where a reading lost or gained an outer row or column, or
 * shifted a corrected size by a column. Every case must read the exact counts and >= 98% of the cells.
 */

const charts = [
  ['edging', edgingTruth()],
  ['random', randomTruth(90, 31, 1)],
] as const

describe('slightly tilted phone photos of a 90 x 31 chart: a skewed straight lattice vs the photo model', () => {
  // Representative subset of the full sweep (2 charts x 3 sizes x 8 tilts x seeds 1-5, 240 cases, all
  // passing): every chart, size and tilt, the seed cycling through 1-5 across the cases.
  const cases = charts.flatMap(([name, truth], c) =>
    [11.5, 12.4, 13.1].flatMap((cellSize, s) =>
      [-0.15, 0.15, -0.25, 0.25, -0.4, 0.4, -0.6, 0.6].map((tilt, t) => [name, cellSize, tilt, 1 + ((c * 24 + s * 8 + t) % 5), truth] as const),
    ),
  )
  it.each(cases)('%s chart, %s px cells, tilted %s degrees, seed %s, blur 1, noise 8', (_name, cellSize, tilt, seed, truth) => {
    const { image } = renderChart(truth, { cellSize })
    const photo = photograph(image, { warp: rotation(image.width, image.height, tilt), blur: 1, noise: 8, seed })
    const result = analyzeChartImage(photo)
    expect([result.cols, result.rows]).toEqual([90, 31])
    expect(agreement(result.ink, truth)).toBeGreaterThanOrEqual(0.98)
  })

  it.each([
    [12.4, -0.2, 1],
    [12.4, 0.25, 4],
    [12.4, -0.15, 5],
    [12.4, 0.6, 4],
    [11.5, -0.25, 3],
  ])('edging chart, %s px cells, tilted %s degrees, seed %s: pale lower rows are kept', (cellSize, tilt, seed) => {
    const truth = edgingTruth()
    const { image } = renderChart(truth, { cellSize })
    const photo = photograph(image, { warp: rotation(image.width, image.height, tilt), blur: 1, noise: 8, seed })
    const result = analyzeChartImage(photo)
    expect([result.cols, result.rows]).toEqual([90, 31])
    expect(agreement(result.ink, truth)).toBeGreaterThanOrEqual(0.98)
  })
})

describe('blurred phone photos with 7-8 px cells: axis numbers a pitch away are not an outer row or column', () => {
  const cases = (
    [
      [90, 31],
      [60, 20],
      [40, 40],
    ] as const
  ).flatMap(([cols, rows]) =>
    (
      [
        [8, 2],
        [7, 1.5],
        [7, 1],
      ] as const
    ).flatMap(([cellSize, blur]) => [1, 2, 3, 4, 5, 6].map((seed) => [cols, rows, cellSize, blur, seed] as const)),
  )
  it.each(cases)('random %s x %s chart, %s px cells, blur %s, seed %s, noise 8', (cols, rows, cellSize, blur, seed) => {
    const truth = randomTruth(cols, rows, seed)
    const { image } = renderChart(truth, { cellSize })
    const result = analyzeChartImage(photograph(image, { blur, noise: 8, seed }))
    expect([result.cols, result.rows]).toEqual([cols, rows])
    expect(agreement(result.ink, truth)).toBeGreaterThanOrEqual(0.98)
  })

  it.each([
    [7, 1.5, 3],
    [8, 2, 1],
  ])('random 60 x 20 chart with a mostly paper last column, %s px cells, blur %s, seed %s', (cellSize, blur, seed) => {
    const truth = randomTruth(60, 20, 1)
    const { image } = renderChart(truth, { cellSize })
    const result = analyzeChartImage(photograph(image, { blur, noise: 8, seed }))
    expect([result.cols, result.rows]).toEqual([60, 20])
    expect(agreement(result.ink, truth)).toBeGreaterThanOrEqual(0.98)
  })
})

describe('correcting the size keeps a detected axis that already has the requested count', () => {
  const moire = [
    { amplitude: 14, period: 5.3 },
    { amplitude: 10, period: 37 },
  ]
  const margins = { left: 70, top: 70, right: 70, bottom: 80 }
  it.each([
    [120, 50, 9.3, 2],
    [120, 50, 9.3, 3],
    [120, 50, 10, 2],
    [120, 50, 10, 3],
    [150, 40, 8, 2],
  ])('random %s x %s chart, %s px cells, moiré, seed %s', (cols, rows, cellSize, seed) => {
    const truth = randomTruth(cols, rows, 3)
    const { image } = renderChart(truth, { cellSize, noise: 0, margins })
    const photo = photograph(image, { moire, blur: 1, noise: 8, seed })
    const corrected = analyzeChartImage(photo, { cols, rows })
    expect(corrected.mode).toBe('grid')
    expect([corrected.cols, corrected.rows]).toEqual([cols, rows])
    expect(agreement(corrected.ink, truth)).toBeGreaterThanOrEqual(0.98)
  })

  it('edging chart tilted 0.6 degrees, 12.4 px cells, seed 4, corrected to 90 x 31', () => {
    const truth = edgingTruth()
    const { image } = renderChart(truth, { cellSize: 12.4 })
    const photo = photograph(image, { warp: rotation(image.width, image.height, 0.6), blur: 1, noise: 8, seed: 4 })
    const corrected = analyzeChartImage(photo, { cols: 90, rows: 31 })
    expect(corrected.mode).toBe('grid')
    expect(agreement(corrected.ink, truth)).toBeGreaterThanOrEqual(0.98)
  })
})
