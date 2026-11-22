import { describe, expect, it } from 'vitest'
import { analyzeChartImage } from './index'
import { randomTruth, renderChart } from './fixtures'

describe('G4: performance', () => {
  it('analyses an 1800 x 700 chart in under 400 ms', () => {
    const truth = randomTruth(120, 42, 5)
    const { image } = renderChart(truth, { cellSize: 14, blur: true, margins: { left: 70, top: 60, right: 50, bottom: 52 } })
    expect([image.width, image.height]).toEqual([1800, 700])
    const started = performance.now()
    const result = analyzeChartImage(image)
    const elapsed = performance.now() - started
    expect(result.mode).toBe('grid')
    expect(result.ink).toEqual(truth)
    expect(elapsed).toBeLessThan(process.env.CI ? 1200 : 400)
  })
})
