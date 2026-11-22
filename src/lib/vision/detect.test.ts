import { describe, expect, it, vi } from 'vitest'
import { analyzeChartImage, detectGrid } from './index'
import { photograph, randomTruth, renderChart, rotation } from './fixtures'
import { detectStraight } from './grid'
import { luminance, opaque } from './image'
import * as warp from './warp'

vi.mock('./warp', async (original) => {
  const actual = await original<typeof import('./warp')>()
  return { ...actual, detectWarped: vi.fn(actual.detectWarped) }
})

/** A crisp chart whose lines sit up to 1.5 px off the lattice (a rescaled screenshot), optionally tilted. */
function jittered(degrees: number) {
  const truth = randomTruth(50, 26, 9)
  const { image } = renderChart(truth, { cellSize: 19.7, labels: false, margins: { left: 30, top: 30, right: 30, bottom: 30 }, lineColor: [40, 40, 40], noise: 4 })
  const rotate = rotation(image.width, image.height, degrees)
  const jitter = (x: number, y: number) => rotate(x + 1.5 * Math.sin(x / 7), y + 1.5 * Math.sin(y / 7))
  return { truth, image: photograph(image, { warp: jitter, noise: 4, seed: 2 }) }
}

describe('straight lattices skip the photo model when they fit exactly', () => {
  it('takes a complete, straight lattice below the confidence cutoff as is', () => {
    const { truth, image } = jittered(0)
    vi.mocked(warp.detectWarped).mockClear()
    const grid = detectGrid(image)
    expect(grid?.confidence).toBeLessThan(0.75)
    expect(grid?.fit).toMatchObject({ lines: 1 })
    expect(grid!.fit!.skew).toBeLessThan(0.02)
    expect(warp.detectWarped).not.toHaveBeenCalled()
    expect(analyzeChartImage(image).ink).toEqual(truth)
  })

  it('still tries the photo model when the lines drift along their length (a slight tilt)', () => {
    const { truth, image } = jittered(0.2)
    const flat = opaque(image)
    expect(detectStraight(luminance(flat), flat.width, flat.height, false)?.fit?.skew).toBeGreaterThan(0.1)
    vi.mocked(warp.detectWarped).mockClear()
    const grid = detectGrid(image)
    expect(warp.detectWarped).toHaveBeenCalled()
    // A skewed straight lattice never wins over the photo model.
    expect(grid?.mesh).toBeDefined()
    expect(analyzeChartImage(image).ink).toEqual(truth)
  })
})
