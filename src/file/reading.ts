// Row-by-row reading of a filet chart: what to crochet on each row, in working order, as text for
// the screen and phrases for speech synthesis.

import { checkFileCell, type FileChart } from './chart'

export type Side = 'right' | 'left'

export interface ReadingOptions {
  /** true: the work is turned after each row, so the reading direction alternates. */
  turning: boolean
  /** The side row 1 starts from. */
  firstRowFrom: Side
}

export const DEFAULT_READING: ReadingOptions = { turning: true, firstRowFrom: 'right' }

export type SquareKind = 'fechado' | 'aberto'

export interface Run {
  kind: SquareKind
  count: number
  /** 1-based position of the run's first square in WORKING order */
  start: number
  /** chart columns covered, ascending */
  fromCol: number
  toCol: number
}

export type Segment = { type: 'run'; run: Run } | { type: 'repeat'; times: number; runs: Run[] }

export type Direction = 'da direita para a esquerda' | 'da esquerda para a direita'

export interface RowReading {
  row: number
  side: Side
  direction: Direction
  runs: Run[]
  segments: Segment[]
  filled: number
  open: number
  total: number
  text: string
  compactText: string
  /** Standard filet stitch counts: the row starts with 1 pa (or its turning chain); each fechado adds 3 pa; each aberto adds 2 correntes + 1 pa. */
  stitches: { pa: number; correntes: number }
}

const OTHER_SIDE: Record<Side, Side> = { right: 'left', left: 'right' }

export function rowStartSide(r: number, options: ReadingOptions = DEFAULT_READING): Side {
  if (!options.turning) return options.firstRowFrom
  return r % 2 === 1 ? options.firstRowFrom : OTHER_SIDE[options.firstRowFrom]
}

/** The row's maximal runs of equal squares, in working order. */
export function rowRuns(chart: FileChart, r: number, options: ReadingOptions = DEFAULT_READING): Run[] {
  checkFileCell(chart, r, 1)
  const row = chart.filled[r - 1]
  const cols = row.length
  const fromRight = rowStartSide(r, options) === 'right'
  const runs: Run[] = []
  for (let i = 0; i < cols; i++) {
    const col = fromRight ? cols - i : i + 1
    const kind: SquareKind = row[col - 1] ? 'fechado' : 'aberto'
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) {
      last.count++
      if (fromRight) last.fromCol = col
      else last.toCol = col
    } else {
      runs.push({ kind, count: 1, start: i + 1, fromCol: col, toCol: col })
    }
  }
  return runs
}

const MAX_BLOCK_RUNS = 4
const MIN_REPEATS = 3

function sameRun(a: Run, b: Run): boolean {
  return a.kind === b.kind && a.count === b.count
}

/** How many consecutive copies of runs[i, i + k) start at i (at least 1). */
function copiesAt(runs: Run[], i: number, k: number): number {
  let times = 1
  while (i + (times + 1) * k <= runs.length) {
    const next = i + times * k
    let equal = true
    for (let j = 0; j < k && equal; j++) equal = sameRun(runs[i + j], runs[next + j])
    if (!equal) break
    times++
  }
  return times
}

/** Folds consecutive repetitions of a block of 1..4 runs repeated >= 3 times into one repeat segment (greedy, left to right in working order, prefer the block that covers the most squares). A single run is never a "repeat" of itself. */
export function compressRuns(runs: Run[]): Segment[] {
  const segments: Segment[] = []
  let i = 0
  while (i < runs.length) {
    let best: { k: number; times: number; squares: number } | null = null
    // Blocks start at 2 runs: a one-run block would be a run "repeated" next to itself.
    for (let k = 2; k <= MAX_BLOCK_RUNS && i + k * MIN_REPEATS <= runs.length; k++) {
      const times = copiesAt(runs, i, k)
      if (times < MIN_REPEATS) continue
      let squares = 0
      for (let j = 0; j < k; j++) squares += runs[i + j].count
      squares *= times
      // Strictly more squares: on a tie the shorter block (tried first) wins, it reads more simply.
      if (!best || squares > best.squares) best = { k, times, squares }
    }
    if (best) {
      // The segment carries the first copy of the block, with its own positions.
      segments.push({ type: 'repeat', times: best.times, runs: runs.slice(i, i + best.k) })
      i += best.k * best.times
    } else {
      segments.push({ type: 'run', run: runs[i] })
      i++
    }
  }
  return segments
}

export function formatCount(kind: SquareKind, count: number): string {
  return `${count} ${kind}${count === 1 ? '' : 's'}`
}

/** Portuguese list: "a", "a e b", "a, b e c". */
function listPt(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

function runText(run: Run): string {
  return formatCount(run.kind, run.count)
}

function blockText(runs: Run[]): string {
  return runs.map(runText).join(', ')
}

/** "10 abertos, 1 fechado, 1 aberto, 3 fechados e 2 abertos"; one run -> "90 abertos"; Portuguese list: commas and " e " before the last item. */
export function formatRuns(runs: Run[]): string {
  return listPt(runs.map(runText))
}

/** Same with repeats: "2 abertos, 3× (1 fechado, 1 aberto) e 4 fechados" */
export function formatSegments(segments: Segment[]): string {
  return listPt(
    segments.map((s) => (s.type === 'run' ? runText(s.run) : `${s.times}× (${blockText(s.runs)})`)),
  )
}

const DIRECTION: Record<Side, Direction> = {
  right: 'da direita para a esquerda',
  left: 'da esquerda para a direita',
}

export function rowReading(chart: FileChart, r: number, options: ReadingOptions = DEFAULT_READING): RowReading {
  const runs = rowRuns(chart, r, options)
  const segments = compressRuns(runs)
  const side = rowStartSide(r, options)
  const direction = DIRECTION[side]
  let filled = 0
  let open = 0
  for (const run of runs) {
    if (run.kind === 'fechado') filled += run.count
    else open += run.count
  }
  const header = `Carreira ${r} (${direction}): `
  return {
    row: r,
    side,
    direction,
    runs,
    segments,
    filled,
    open,
    total: filled + open,
    text: header + formatRuns(runs),
    compactText: header + formatSegments(segments),
    stitches: { pa: 1 + 3 * filled + open, correntes: 2 * open },
  }
}

/** Phrases to dictate one at a time: one per segment. */
export function speechChunks(reading: RowReading): string[] {
  return reading.segments.map((s) =>
    s.type === 'run' ? runText(s.run) : `${s.times} vezes: ${blockText(s.runs)}`,
  )
}

/** Text for speech synthesis: "Carreira 5, da direita para a esquerda. 10 abertos. 1 fechado. …" — numbers as digits are fine; use compact segments, "3 vezes: 1 fechado, 1 aberto". */
export function speechText(reading: RowReading): string {
  return [`Carreira ${reading.row}, ${reading.direction}`, ...speechChunks(reading)].map((p) => `${p}.`).join(' ')
}
