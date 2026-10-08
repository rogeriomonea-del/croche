import { describe, expect, it } from 'vitest'
import { at, cellsOf, conflictOutline, conflicts, deriveX, emptyMatrix, instructions, toggle } from '.'

// SPEC §5: real output of the original app on a 15×20 grid. Mandatory.
const ROWS = 15
const COLS = 20

function draw(toggles: Array<[number, number]>) {
  return toggles.reduce((d, [r, c]) => toggle(d, r, c), emptyMatrix(ROWS, COLS))
}

function expected(special: Record<number, string>): string[] {
  return Array.from({ length: ROWS }, (_, i) => special[i + 1] ?? `Row ${i + 1}: ${COLS} sc`)
}

const CASE_A: Array<[number, number]> = [[5, 5], [5, 8], [10, 8]]
const CASE_B: Array<[number, number]> = [...CASE_A, [6, 5], [3, 12], [4, 12], [5, 12], [15, 10]]

describe('§5 golden vectors', () => {
  it('Case A', () => {
    const X = deriveX(draw(CASE_A))
    expect(instructions(X)).toEqual(
      expected({
        6: 'Row 6: 12 sc, 1 dc, 2 sc, 1 dc and 4 sc',
        11: 'Row 11: 12 sc, 1 dc and 7 sc',
      }),
    )
    expect(cellsOf(conflicts(X))).toEqual([])
  })

  it('Case B', () => {
    const delta = draw(CASE_B)
    const X = deriveX(delta)
    expect(instructions(X)).toEqual(
      expected({
        4: 'Row 4: 8 sc, 1 dc and 11 sc',
        5: 'Row 5: 8 sc, 1 dc and 11 sc',
        6: 'Row 6: 8 sc, 1 dc, 3 sc, 1 dc, 2 sc, 1 dc and 4 sc',
        7: 'Row 7: 15 sc, 1 dc and 4 sc',
        11: 'Row 11: 12 sc, 1 dc and 7 sc',
      }),
    )
    // Column 5 rows 6–7, column 12 rows 4–6.
    expect(cellsOf(conflicts(X))).toEqual([[4, 12], [5, 12], [6, 5], [6, 12], [7, 5]])
    // Outlined as drawn: on the X cells in schematic, on the covered cells (one row lower) in simulation.
    expect(cellsOf(conflictOutline('schematic', conflicts(X)))).toEqual([[4, 12], [5, 12], [6, 5], [6, 12], [7, 5]])
    expect(cellsOf(conflictOutline('simulation', conflicts(X)))).toEqual([[3, 12], [4, 12], [5, 5], [5, 12], [6, 5]])
    // (15, 10) is the top row: no dc, and the new app refuses the toggle outright (§4).
    expect(at(delta, 15, 10)).toBe(false)
  })
})
