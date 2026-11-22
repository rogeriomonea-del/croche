// Pure layout maths for the filet chart canvas: where cells, row numbers and column numbers sit,
// which cell a point hits, and which chart columns each reading segment covers.

import type { RowReading, Segment } from '../../file'

export interface ChartLayout {
  rows: number
  cols: number
  /** CSS pixels per square */
  cell: number
  /** Width of the row-number gutter on each side */
  gutter: number
  top: number
  /** Height of the column-number band under the grid */
  bottom: number
  width: number
  height: number
}

export const ZOOM_STEPS = [3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40] as const
/** Keeps the backing store under iOS Safari's canvas area limit even at 1x. */
const MAX_CSS_AREA = 16_000_000

export function chartLayout(rows: number, cols: number, cell: number): ChartLayout {
  const gutter = 40
  const top = 10
  const bottom = 24
  return { rows, cols, cell, gutter, top, bottom, width: gutter * 2 + cols * cell, height: top + rows * cell + bottom }
}

/** Largest square size the canvas may use for this chart. */
export function maxCell(rows: number, cols: number): number {
  const fit = Math.floor(Math.sqrt(MAX_CSS_AREA / Math.max(1, rows * cols))) - 1
  return Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], fit))
}

/** The square size that fits `width` CSS pixels, bounded by [min, max]. */
export function fitCell(width: number, rows: number, cols: number, min: number = ZOOM_STEPS[0], max: number = maxCell(rows, cols)): number {
  const raw = Math.floor((width - 2 * chartLayout(rows, cols, 1).gutter) / Math.max(1, cols))
  return Math.max(min, Math.min(max, Math.min(maxCell(rows, cols), raw)))
}

export function zoomStep(cell: number, direction: 1 | -1, rows: number, cols: number): number {
  const limit = maxCell(rows, cols)
  if (direction > 0) return Math.min(limit, ZOOM_STEPS.find((s) => s > cell) ?? cell)
  return [...ZOOM_STEPS].reverse().find((s) => s < cell) ?? cell
}

/** Top edge of chart row r (row 1 is drawn at the bottom). */
export function rowTop(layout: ChartLayout, r: number): number {
  return layout.top + (layout.rows - r) * layout.cell
}

export function colLeft(layout: ChartLayout, c: number): number {
  return layout.gutter + (c - 1) * layout.cell
}

export type Hit = { kind: 'cell'; r: number; c: number } | { kind: 'row'; r: number } | null

/** What lies under a point given in CSS pixels relative to the canvas. */
export function hitTest(layout: ChartLayout, x: number, y: number): Hit {
  const gridBottom = layout.top + layout.rows * layout.cell
  if (y < layout.top || y >= gridBottom) return null
  const r = layout.rows - Math.floor((y - layout.top) / layout.cell)
  const gridRight = layout.gutter + layout.cols * layout.cell
  if (x >= layout.gutter && x < gridRight) return { kind: 'cell', r, c: Math.floor((x - layout.gutter) / layout.cell) + 1 }
  if (x >= 0 && x < layout.width) return { kind: 'row', r }
  return null
}

/** Cells on the straight line between two cells (inclusive), so a fast drag leaves no gaps. */
export function cellsBetween(a: { r: number; c: number }, b: { r: number; c: number }): { r: number; c: number }[] {
  const out: { r: number; c: number }[] = []
  let r = a.r
  let c = a.c
  const dr = Math.abs(b.r - a.r)
  const dc = Math.abs(b.c - a.c)
  const sr = a.r < b.r ? 1 : -1
  const sc = a.c < b.c ? 1 : -1
  let err = dc - dr
  for (;;) {
    out.push({ r, c })
    if (r === b.r && c === b.c) break
    const e2 = 2 * err
    if (e2 > -dr) {
      err -= dr
      c += sc
    }
    if (e2 < dc) {
      err += dc
      r += sr
    }
  }
  return out
}

/** Show every n-th number so labels never overlap at this square size. */
export function labelStep(cell: number): number {
  if (cell >= 16) return 1
  if (cell >= 10) return 2
  if (cell >= 6) return 5
  return 10
}

function segmentSquares(segment: Segment): number {
  if (segment.type === 'run') return segment.run.count
  return segment.times * segment.runs.reduce((sum, run) => sum + run.count, 0)
}

/** Chart columns (ascending, inclusive) covered by each segment of a row reading. */
export function segmentColumns(reading: RowReading, cols: number): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = []
  let position = 1 // working order, 1-based
  for (const segment of reading.segments) {
    const squares = segmentSquares(segment)
    const first = position
    const last = position + squares - 1
    position += squares
    if (reading.side === 'right') spans.push({ from: cols - last + 1, to: cols - first + 1 })
    else spans.push({ from: first, to: last })
  }
  return spans
}

/** Text for a reading chip: "10 abertos" or "3× (1 fechado, 1 aberto)". */
export function segmentLabel(segment: Segment): string {
  const run = (kind: string, count: number) => `${count} ${kind}${count === 1 ? '' : 's'}`
  if (segment.type === 'run') return run(segment.run.kind, segment.run.count)
  return `${segment.times}× (${segment.runs.map((r) => run(r.kind, r.count)).join(', ')})`
}

/** "90 quadradinhos · 42 fechados · 48 abertos · 169 pa e 96 correntes" */
export function totalsText(reading: RowReading): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  return [
    plural(reading.total, 'quadradinho', 'quadradinhos'),
    plural(reading.filled, 'fechado', 'fechados'),
    plural(reading.open, 'aberto', 'abertos'),
    `${reading.stitches.pa} pa e ${plural(reading.stitches.correntes, 'corrente', 'correntes')}`,
  ].join(' · ')
}
