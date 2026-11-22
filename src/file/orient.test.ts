import { describe, expect, it } from 'vitest'
import { orientMatrix } from './orient'

const M = [
  [1, 2, 3],
  [4, 5, 6],
]

describe('orientMatrix', () => {
  it('leaves the matrix as it is without an orientation, as a copy', () => {
    const out = orientMatrix(M, {})
    expect(out).toEqual(M)
    expect(out).not.toBe(M)
    expect(out[0]).not.toBe(M[0])
  })

  it('rotate 180° reverses the rows and each row', () => {
    expect(orientMatrix(M, { rotate180: true })).toEqual([
      [6, 5, 4],
      [3, 2, 1],
    ])
  })

  it('mirror reverses each row only', () => {
    expect(orientMatrix(M, { mirror: true })).toEqual([
      [3, 2, 1],
      [6, 5, 4],
    ])
  })

  it('both together flip top to bottom', () => {
    expect(orientMatrix(M, { rotate180: true, mirror: true })).toEqual([
      [4, 5, 6],
      [1, 2, 3],
    ])
  })

  it('applying the same orientation twice gives the original back, and never mutates the input', () => {
    const ink = [
      [true, false, false, true, true],
      [false, false, true, false, true],
      [true, true, true, false, false],
    ]
    const before = JSON.stringify(ink)
    for (const o of [{ rotate180: true }, { mirror: true }, { rotate180: true, mirror: true }]) {
      expect(orientMatrix(orientMatrix(ink, o), o)).toEqual(ink)
    }
    expect(JSON.stringify(ink)).toBe(before)
  })

  it('handles an empty matrix and a single cell', () => {
    expect(orientMatrix([], { rotate180: true, mirror: true })).toEqual([])
    expect(orientMatrix([[7]], { rotate180: true })).toEqual([[7]])
  })
})
