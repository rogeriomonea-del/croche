import { describe, expect, it } from 'vitest'
import { cellsOf, COL_OPTIONS, emptyMatrix, resize, resolveClick, ROW_OPTIONS, stitchNumber, toCsv, toggle } from '.'

describe('dimensions (§2)', () => {
  it('offers odd row counts 5–119 and column counts 5–120 (SPEC v0.2)', () => {
    expect(ROW_OPTIONS[0]).toBe(5)
    expect(ROW_OPTIONS[ROW_OPTIONS.length - 1]).toBe(119)
    expect(ROW_OPTIONS.every((n) => n % 2 === 1)).toBe(true)
    expect([COL_OPTIONS[0], COL_OPTIONS[COL_OPTIONS.length - 1], COL_OPTIONS.length]).toEqual([5, 120, 116])
  })

  it('numbers chart columns from the right', () => {
    expect([1, 8, 20].map((c) => stitchNumber(c, 20))).toEqual([20, 13, 1])
  })
})

describe('resize (§4: keeps the drawing)', () => {
  const drawn = [[3, 2], [9, 4], [13, 18]] as Array<[number, number]>
  const delta = drawn.reduce((d, [r, c]) => toggle(d, r, c), emptyMatrix(15, 20))

  it('keeps every cell when growing, anchored bottom-left', () => {
    const bigger = resize(delta, 21, 30)
    expect([bigger.length, bigger[0].length]).toEqual([21, 30])
    expect(cellsOf(bigger)).toEqual(drawn)
  })

  it('drops cells past the new edge and on the new top row', () => {
    // 9 rows: (9, 4) becomes the top row, which cannot deviate. 17 cols: (13, 18) is gone anyway.
    expect(cellsOf(resize(delta, 9, 17))).toEqual([[3, 2]])
  })
})

describe('resolveClick (handleCellClick)', () => {
  it('simulation: toggles the clicked cell, locks rows 1 and `rows`', () => {
    expect(resolveClick('simulation', 5, 8, 15)).toEqual({ ok: true, r: 5, c: 8 })
    expect(resolveClick('simulation', 1, 8, 15)).toEqual({ ok: false, reason: 'base-row' })
    expect(resolveClick('simulation', 15, 8, 15)).toEqual({ ok: false, reason: 'top-row' })
  })

  it('schematic: an X on row r is the deviation on row r-1', () => {
    expect(resolveClick('schematic', 6, 8, 15)).toEqual({ ok: true, r: 5, c: 8 })
    expect(resolveClick('schematic', 15, 8, 15)).toEqual({ ok: true, r: 14, c: 8 })
    expect(resolveClick('schematic', 3, 8, 15)).toEqual({ ok: true, r: 2, c: 8 })
  })

  it('schematic: rows 1 and 2 have no row r-2 for the dc to drop into', () => {
    expect(resolveClick('schematic', 1, 8, 15)).toEqual({ ok: false, reason: 'no-anchor' })
    expect(resolveClick('schematic', 2, 8, 15)).toEqual({ ok: false, reason: 'no-anchor' })
  })
})

describe('toCsv', () => {
  it('writes the X chart top row first, 1 = dc, under stitch numbers, plain RFC 4180 (§9)', () => {
    const X = emptyMatrix(5, 5)
    X[2][0] = true // row 3, column 1 (stitch 5)
    expect(toCsv(X).split('\r\n')).toEqual([
      'Row,Yarn,5,4,3,2,1',
      '5,A,0,0,0,0,0',
      '4,B,0,0,0,0,0',
      '3,A,1,0,0,0,0',
      '2,B,0,0,0,0,0',
      '1,A,0,0,0,0,0',
      '',
    ])
  })
})
