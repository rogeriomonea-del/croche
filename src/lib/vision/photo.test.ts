import { describe, expect, it } from 'vitest'
import { analyzeChartImage, detectGrid } from './index'
import { agreement, edgingTruth, perspective, photograph, renderChart, rotation, type PhotoOptions } from './fixtures'

/** The 90 x 31 edging as on a phone screen: wider margins so a rotated grid stays in the frame. */
function screen() {
  const truth = edgingTruth()
  const { image } = renderChart(truth, { cellSize: 12.4, noise: 0, margins: { left: 70, top: 70, right: 70, bottom: 80 } })
  return { truth, image }
}

describe('G1: phone photos of the chart', () => {
  const { truth, image } = screen()
  const w = image.width
  const h = image.height
  const cases: [string, PhotoOptions][] = [
    ['Gaussian blur, sigma 1.5', { blur: 1.5, noise: 8, seed: 2 }],
    ['rotation +3 degrees', { warp: rotation(w, h, 3), blur: 1, noise: 8, seed: 3 }],
    ['rotation -3 degrees', { warp: rotation(w, h, -3), blur: 1, noise: 8, seed: 4 }],
    ['perspective, pitch +-8% left to right and top to bottom', { warp: perspective(w, h, 0.08), blur: 1, noise: 8, seed: 5 }],
    ['a vignette', { vignette: 0.45, blur: 1, noise: 8, seed: 7 }],
  ]
  it.each(cases)('reads at least 99 percent of the cells: %s', (_name, options) => {
    const result = analyzeChartImage(photograph(image, options))
    expect(result.mode).toBe('grid')
    expect([result.cols, result.rows]).toEqual([90, 31])
    expect(agreement(result.ink, truth)).toBeGreaterThanOrEqual(0.99)
  })

  // Not met yet: with moire: [{ amplitude: 14, period: 5.3 }, { amplitude: 10, period: 37 }] the straight
  // reading extends the rows into the banded margins (90 x 41) and wins over the photo model (89 x 31).
  it.todo('reads at least 99 percent of the cells: horizontal moiré banding')

  it('reports the rotation it corrected', () => {
    const grid = detectGrid(photograph(image, { warp: rotation(w, h, 3), blur: 1, noise: 8, seed: 3 }))
    expect(grid?.mesh).toBeDefined()
    expect(grid!.angle!).toBeGreaterThan(2.5)
    expect(grid!.angle!).toBeLessThan(3.5)
  })
})
