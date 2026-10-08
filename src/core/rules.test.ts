import { describe, expect, it } from 'vitest'
import {
  at,
  canToggle,
  cellsOf,
  cellYarn,
  conflicts,
  deriveX,
  emptyMatrix,
  instructions,
  rowInstruction,
  stripe,
  toggle,
  type Matrix,
} from '.'

function withCells(rows: number, cols: number, cells: Array<[number, number]>): Matrix {
  const m = emptyMatrix(rows, cols)
  for (const [r, c] of cells) m[r - 1][c - 1] = true
  return m
}

describe('§3.1 stripe', () => {
  it('works odd rows in main and even rows in pattern', () => {
    expect([1, 2, 3, 14, 15].map(stripe)).toEqual(['main', 'pattern', 'main', 'pattern', 'main'])
  })
})

describe('§3.2 toggle', () => {
  it('flips the cell colour relative to its stripe', () => {
    const d = toggle(emptyMatrix(15, 20), 5, 8)
    expect(cellsOf(d)).toEqual([[5, 8]])
    expect(cellYarn(d, 5, 8)).toBe('pattern')
    expect(cellYarn(d, 5, 9)).toBe('main')
    const e = toggle(emptyMatrix(15, 20), 6, 8)
    expect(cellYarn(e, 6, 8)).toBe('main')
  })

  it('toggling twice restores the cell and never mutates its input', () => {
    const empty = emptyMatrix(15, 20)
    const once = toggle(empty, 5, 8)
    expect(cellsOf(empty)).toEqual([])
    expect(cellsOf(toggle(once, 5, 8))).toEqual([])
  })
})

describe('§3.3 dc placement', () => {
  it('puts the dc on the row above the deviation, same column', () => {
    const X = deriveX(withCells(15, 20, [[5, 8], [2, 1]]))
    expect(cellsOf(X)).toEqual([[3, 1], [6, 8]])
  })
})

describe('§3.4 conflicts', () => {
  it('flags dc on consecutive rows of the same column, and only those', () => {
    const X = withCells(15, 20, [[4, 3], [5, 3], [9, 7], [11, 7], [9, 8]])
    expect(cellsOf(conflicts(X))).toEqual([[4, 3], [5, 3]])
  })
})

describe('§3.5 and §4 locked rows', () => {
  it('locks the base row and the top row only', () => {
    expect([1, 2, 14, 15].map((r) => canToggle(r, 15))).toEqual([false, true, true, false])
  })

  it('a toggle on row 1 changes nothing (original bug: it produced a dc on row 2)', () => {
    const empty = emptyMatrix(15, 20)
    const after = toggle(empty, 1, 3)
    expect(after).toBe(empty)
    expect(rowInstruction(deriveX(after), 2)).toBe('Row 2: 20 sc')
  })

  it('a toggle on the top row changes nothing', () => {
    const empty = emptyMatrix(15, 20)
    expect(toggle(empty, 15, 10)).toBe(empty)
  })

  it('a deviation on the top row yields no dc', () => {
    expect(cellsOf(deriveX(withCells(15, 20, [[15, 10]])))).toEqual([])
  })
})

describe('§3.6 instructions', () => {
  it('a row without dc is a single sc run', () => {
    expect(rowInstruction(emptyMatrix(15, 20), 7)).toBe('Row 7: 20 sc')
  })

  it('reads right to left: column `cols` is the first stitch', () => {
    expect(rowInstruction(withCells(3, 20, [[2, 20]]), 2)).toBe('Row 2: 1 dc and 19 sc')
    expect(rowInstruction(withCells(3, 20, [[2, 1]]), 2)).toBe('Row 2: 19 sc and 1 dc')
  })

  it('groups runs with commas and "and" before the last group', () => {
    expect(rowInstruction(withCells(3, 10, [[2, 9], [2, 8], [2, 2]]), 2)).toBe('Row 2: 1 sc, 2 dc, 5 sc, 1 dc and 1 sc')
  })

  it('emits one line per row, row 1 first', () => {
    const lines = instructions(emptyMatrix(5, 6))
    expect(lines).toEqual(['Row 1: 6 sc', 'Row 2: 6 sc', 'Row 3: 6 sc', 'Row 4: 6 sc', 'Row 5: 6 sc'])
  })

  it('at() reads outside the grid as false', () => {
    const m = withCells(5, 5, [[1, 1]])
    expect([at(m, 0, 1), at(m, 6, 1), at(m, 1, 0), at(m, 1, 6), at(m, 1, 1)]).toEqual([false, false, false, false, true])
  })
})
