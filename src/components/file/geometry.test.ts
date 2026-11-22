import { describe, expect, it } from 'vitest'
import { fileChartFromTopFirst, rowReading, type ReadingOptions } from '../../file'
import {
  cellsBetween,
  chartLayout,
  colLeft,
  fitCell,
  hitTest,
  maxCell,
  rowTop,
  segmentColumns,
  segmentLabel,
  totalsText,
  zoomStep,
} from './geometry'

const colors = { filled: '#000000', open: '#ffffff' }
const chartOf = (topFirst: string[]) =>
  fileChartFromTopFirst(topFirst.map((row) => [...row].map((ch) => ch === '#')), { name: 't', colors })

describe('layout and hit testing', () => {
  const layout = chartLayout(4, 5, 10)

  it('places row 1 at the bottom and column 1 at the left', () => {
    expect(rowTop(layout, 1)).toBe(layout.top + 30)
    expect(rowTop(layout, 4)).toBe(layout.top)
    expect(colLeft(layout, 1)).toBe(layout.gutter)
    expect(layout.width).toBe(layout.gutter * 2 + 50)
  })

  it('maps points to cells, row-number gutters, or nothing', () => {
    expect(hitTest(layout, layout.gutter + 1, layout.top + 1)).toEqual({ kind: 'cell', r: 4, c: 1 })
    expect(hitTest(layout, layout.gutter + 49, layout.top + 39)).toEqual({ kind: 'cell', r: 1, c: 5 })
    expect(hitTest(layout, 3, layout.top + 15)).toEqual({ kind: 'row', r: 3 })
    expect(hitTest(layout, layout.width - 2, layout.top + 15)).toEqual({ kind: 'row', r: 3 })
    expect(hitTest(layout, layout.gutter + 5, layout.top + 40)).toBeNull()
    expect(hitTest(layout, layout.gutter + 5, 2)).toBeNull()
  })

  it('fits, zooms and caps the square size', () => {
    expect(fitCell(80 + 50 * 7, 10, 50)).toBe(7)
    expect(fitCell(100, 10, 200)).toBe(3)
    expect(maxCell(200, 200)).toBeLessThanOrEqual(20)
    expect(maxCell(10, 10)).toBe(40)
    expect(zoomStep(8, 1, 10, 10)).toBe(10)
    expect(zoomStep(8, -1, 10, 10)).toBe(6)
    expect(zoomStep(7, 1, 10, 10)).toBe(8)
    expect(zoomStep(3, -1, 10, 10)).toBe(3)
    expect(zoomStep(20, 1, 200, 200)).toBeLessThanOrEqual(maxCell(200, 200))
  })

  it('fills the gaps of a fast drag', () => {
    expect(cellsBetween({ r: 1, c: 1 }, { r: 1, c: 4 })).toHaveLength(4)
    const diagonal = cellsBetween({ r: 5, c: 1 }, { r: 1, c: 3 })
    expect(diagonal[0]).toEqual({ r: 5, c: 1 })
    expect(diagonal.at(-1)).toEqual({ r: 1, c: 3 })
    expect(diagonal).toHaveLength(5)
  })
})

describe('segments on the chart', () => {
  // Row 1 = bottom: "#.#.#.##"
  const chart = chartOf(['........', '#.#.#.##'])

  it('maps right-to-left segments, including repeats, to chart columns', () => {
    const reading = rowReading(chart, 1)
    // From the right: 2 fechados (8,7), then 3x (1 aberto, 1 fechado) (6..1)
    expect(reading.segments.map(segmentLabel)).toEqual(['2 fechados', '3× (1 aberto, 1 fechado)'])
    expect(segmentColumns(reading, 8)).toEqual([
      { from: 7, to: 8 },
      { from: 1, to: 6 },
    ])
  })

  it('maps left-to-right segments to chart columns', () => {
    const options: ReadingOptions = { turning: true, firstRowFrom: 'left' }
    const reading = rowReading(chart, 1, options)
    const spans = segmentColumns(reading, 8)
    expect(spans[0]).toEqual({ from: 1, to: 6 })
    expect(spans.at(-1)).toEqual({ from: 7, to: 8 })
  })

  it('writes the row totals with stitch counts', () => {
    expect(totalsText(rowReading(chart, 1))).toBe('8 quadradinhos · 5 fechados · 3 abertos · 19 pa e 6 correntes')
    const one = chartOf(['#'])
    expect(totalsText(rowReading(one, 1))).toBe('1 quadradinho · 1 fechado · 0 abertos · 4 pa e 0 correntes')
    const open = chartOf(['.'])
    expect(totalsText(rowReading(open, 1))).toBe('1 quadradinho · 0 fechados · 1 aberto · 2 pa e 2 correntes')
  })
})
