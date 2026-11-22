import { describe, expect, it } from 'vitest'
import { stitchLine, zoomAt } from './canvas'

describe('continuous canvas strokes', () => {
  it('fills skipped horizontal stitches in either direction', () => {
    expect(stitchLine({ r: 4, c: 1 }, { r: 4, c: 5 })).toEqual([
      { r: 4, c: 1 },
      { r: 4, c: 2 },
      { r: 4, c: 3 },
      { r: 4, c: 4 },
      { r: 4, c: 5 },
    ])
    expect(stitchLine({ r: 4, c: 5 }, { r: 4, c: 1 })).toEqual(
      stitchLine({ r: 4, c: 1 }, { r: 4, c: 5 }).reverse(),
    )
  })
  it('creates a connected stroke through steep and diagonal moves', () => {
    for (const end of [
      { r: 9, c: 3 },
      { r: 2, c: 9 },
      { r: 1, c: 1 },
    ]) {
      const cells = stitchLine({ r: 5, c: 5 }, end)
      expect(cells[0]).toEqual({ r: 5, c: 5 })
      expect(cells.at(-1)).toEqual(end)
      for (let i = 1; i < cells.length; i++) {
        expect(Math.abs(cells[i].r - cells[i - 1].r)).toBeLessThanOrEqual(1)
        expect(Math.abs(cells[i].c - cells[i - 1].c)).toBeLessThanOrEqual(1)
      }
    }
  })
  it('emits a single cell for a stationary pointer', () => {
    expect(stitchLine({ r: 5, c: 5 }, { r: 5, c: 5 })).toEqual([{ r: 5, c: 5 }])
  })
})

describe('pointer anchored zoom', () => {
  it('keeps the same fabric point under the pointer', () => {
    const point = { x: 380, y: 240 }
    const offset = { x: 40, y: -60 }
    const next = zoomAt(point, offset, 0.75, 1.5)
    expect((point.x - next.x) / 1.5).toBe((point.x - offset.x) / 0.75)
    expect((point.y - next.y) / 1.5).toBe((point.y - offset.y) / 0.75)
  })
})
