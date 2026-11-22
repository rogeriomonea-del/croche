import { describe, expect, it } from 'vitest'
import {
  emptyFileChart,
  FILE_MAX_COLS,
  FILE_MAX_ROWS,
  fileChartFromTopFirst,
  fileCols,
  fileRows,
  paintFileCell,
  resizeFileChart,
  toggleFileCell,
  type FileChart,
} from '.'

const COLORS = { filled: '#112233', open: '#ffffff' }

function bits(chart: FileChart): string[] {
  return chart.filled.map((row) => row.map((v) => (v ? '1' : '0')).join(''))
}

describe('emptyFileChart', () => {
  it('builds an all-aberto chart of the given size', () => {
    const chart = emptyFileChart(3, 4, 'Toalha')
    expect(chart.name).toBe('Toalha')
    expect([fileRows(chart), fileCols(chart)]).toEqual([3, 4])
    expect(bits(chart)).toEqual(['0000', '0000', '0000'])
    expect(chart.colors.filled).toMatch(/^#[0-9a-f]{6}$/)
    expect(chart.colors.open).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('rejects sizes outside 1..200 or non-integers', () => {
    expect(() => emptyFileChart(0, 5)).toThrow(RangeError)
    expect(() => emptyFileChart(5, FILE_MAX_COLS + 1)).toThrow(RangeError)
    expect(() => emptyFileChart(FILE_MAX_ROWS + 1, 5)).toThrow(RangeError)
    expect(() => emptyFileChart(2.5, 5)).toThrow(RangeError)
    expect(fileRows(emptyFileChart(FILE_MAX_ROWS, FILE_MAX_COLS))).toBe(FILE_MAX_ROWS)
  })
})

describe('fileChartFromTopFirst (G4)', () => {
  // Picture top row first: the top row has a fechado on the left, the bottom row on the right.
  const picture = [
    [true, false, false],
    [false, true, false],
    [false, false, true],
    [false, false, false],
  ]

  it('flips vertically so row 1 is the bottom of the picture', () => {
    const chart = fileChartFromTopFirst(picture, { name: 'Foto', colors: COLORS })
    expect(bits(chart)).toEqual(['000', '001', '010', '100'])
    expect(chart.name).toBe('Foto')
    expect(chart.colors).toEqual(COLORS)
    expect(chart.colors).not.toBe(COLORS)
  })

  it('swaps fechado and aberto when inverted', () => {
    const chart = fileChartFromTopFirst(picture, { name: 'Foto', colors: COLORS, invert: true })
    expect(bits(chart)).toEqual(['111', '110', '101', '011'])
  })

  it('does not share rows with the input', () => {
    const chart = fileChartFromTopFirst(picture, { name: 'Foto', colors: COLORS })
    chart.filled[0][0] = true
    expect(picture[3][0]).toBe(false)
  })

  it('rejects empty, ragged or oversized input', () => {
    expect(() => fileChartFromTopFirst([], { name: 'x', colors: COLORS })).toThrow(RangeError)
    expect(() => fileChartFromTopFirst([[true], [true, false]], { name: 'x', colors: COLORS })).toThrow(RangeError)
    expect(() => fileChartFromTopFirst([new Array(FILE_MAX_COLS + 1).fill(false)], { name: 'x', colors: COLORS })).toThrow(RangeError)
  })
})

describe('toggleFileCell / paintFileCell (G4)', () => {
  it('toggles one square without touching the original', () => {
    const before = emptyFileChart(2, 3)
    const after = toggleFileCell(before, 2, 3)
    expect(bits(before)).toEqual(['000', '000'])
    expect(bits(after)).toEqual(['000', '001'])
    expect(bits(toggleFileCell(after, 2, 3))).toEqual(['000', '000'])
    // Untouched rows are shared, the touched one is a copy.
    expect(after.filled[0]).toBe(before.filled[0])
    expect(after.filled[1]).not.toBe(before.filled[1])
  })

  it('paints a square and returns the same object when nothing changes', () => {
    const before = emptyFileChart(2, 3)
    expect(paintFileCell(before, 1, 1, false)).toBe(before)
    const after = paintFileCell(before, 1, 1, true)
    expect(after).not.toBe(before)
    expect(bits(after)).toEqual(['100', '000'])
    expect(paintFileCell(after, 1, 1, true)).toBe(after)
    expect(bits(before)).toEqual(['000', '000'])
  })

  it('rejects squares outside the chart', () => {
    const chart = emptyFileChart(2, 3)
    expect(() => toggleFileCell(chart, 3, 1)).toThrow(RangeError)
    expect(() => paintFileCell(chart, 1, 0, true)).toThrow(RangeError)
  })
})

describe('resizeFileChart (G4)', () => {
  // Row 1 = '100', row 2 = '011'.
  const chart: FileChart = { name: 'R', filled: [[true, false, false], [false, true, true]], colors: COLORS }

  it('grows at the top and right with aberto squares', () => {
    const grown = resizeFileChart(chart, 3, 5)
    expect(bits(grown)).toEqual(['10000', '01100', '00000'])
    expect(grown.name).toBe('R')
    expect(grown.colors).toEqual(COLORS)
  })

  it('shrinks from the top and right, keeping the bottom-left content', () => {
    expect(bits(resizeFileChart(chart, 1, 2))).toEqual(['10'])
  })

  it('leaves the original untouched', () => {
    const resized = resizeFileChart(chart, 2, 3)
    resized.filled[0][0] = false
    expect(bits(chart)).toEqual(['100', '011'])
  })

  it('rejects sizes out of range', () => {
    expect(() => resizeFileChart(chart, 0, 3)).toThrow(RangeError)
    expect(() => resizeFileChart(chart, 2, FILE_MAX_COLS + 1)).toThrow(RangeError)
  })
})
