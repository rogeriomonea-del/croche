import { describe, expect, it } from 'vitest'
import { emptyFileChart, fileChartFromTopFirst, rowReading, toFileDocument, type FileChart } from '../file'
import {
  HISTORY_LIMIT,
  STORAGE_KEY,
  deserializeFileStudio,
  fileStudioReducer as reduce,
  initialFileStudio,
  loadFileStudio,
  saveFileStudio,
  serializeFileStudio,
  type FileStudioAction,
  type FileStudioState,
} from './file-studio'

function run(state: FileStudioState, ...actions: FileStudioAction[]): FileStudioState {
  return actions.reduce(reduce, state)
}

/** 3 rows x 6 cols; row 1 (bottom) alternates, giving several segments. */
function sample(): FileChart {
  return fileChartFromTopFirst(
    [
      [true, true, true, true, true, true],
      [false, false, false, false, false, false],
      [true, false, true, true, false, false],
    ],
    { name: 'Amostra', colors: { filled: '#aa0000', open: '#ffffff' } },
  )
}

class MemoryStorage {
  data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
}

describe('initial state', () => {
  it('starts with an empty 20 x 10 chart in Editar, default reading and row 1', () => {
    const s = initialFileStudio()
    expect(s.chart.filled).toHaveLength(10)
    expect(s.chart.filled[0]).toHaveLength(20)
    expect(s.chart.filled.flat().some(Boolean)).toBe(false)
    expect(s.mode).toBe('editar')
    expect(s.reading).toEqual({ turning: true, firstRowFrom: 'right' })
    expect(s.progress).toEqual({ row: 1, segment: 0, doneRows: [] })
  })
})

describe('editing and history', () => {
  it('toggle flips a square and is one undo step', () => {
    const s = run(initialFileStudio(), { type: 'toggle', r: 2, c: 3 })
    expect(s.chart.filled[1][2]).toBe(true)
    expect(s.past).toHaveLength(1)
    const u = reduce(s, { type: 'undo' })
    expect(u.chart.filled[1][2]).toBe(false)
    const r = reduce(u, { type: 'redo' })
    expect(r.chart.filled[1][2]).toBe(true)
  })

  it('a stroke of many paints is a single undo step', () => {
    const s = run(
      initialFileStudio(),
      { type: 'strokeStart' },
      { type: 'paint', r: 1, c: 1, filled: true },
      { type: 'paint', r: 1, c: 2, filled: true },
      { type: 'paint', r: 1, c: 2, filled: true },
      { type: 'paint', r: 2, c: 2, filled: true },
      { type: 'strokeEnd' },
    )
    expect(s.past).toHaveLength(1)
    expect(s.chart.filled[0].slice(0, 2)).toEqual([true, true])
    expect(s.chart.filled[1][1]).toBe(true)
    const u = reduce(s, { type: 'undo' })
    expect(u.chart.filled.flat().some(Boolean)).toBe(false)
  })

  it('two strokes are two undo steps; a stroke that changes nothing records nothing', () => {
    const s = run(
      initialFileStudio(),
      { type: 'strokeStart' },
      { type: 'paint', r: 1, c: 1, filled: false },
      { type: 'strokeEnd' },
      { type: 'strokeStart' },
      { type: 'paint', r: 1, c: 1, filled: true },
      { type: 'strokeEnd' },
      { type: 'strokeStart' },
      { type: 'paint', r: 1, c: 2, filled: true },
      { type: 'strokeEnd' },
    )
    expect(s.past).toHaveLength(2)
  })

  it('ignores paints outside the chart', () => {
    const s0 = initialFileStudio()
    expect(reduce(s0, { type: 'paint', r: 0, c: 1, filled: true })).toBe(s0)
    expect(reduce(s0, { type: 'toggle', r: 11, c: 1 })).toBe(s0)
    expect(reduce(s0, { type: 'toggle', r: 1, c: 21 })).toBe(s0)
  })

  it('a new edit clears redo; history is bounded', () => {
    let s = run(initialFileStudio(), { type: 'toggle', r: 1, c: 1 }, { type: 'undo' })
    expect(s.future).toHaveLength(1)
    s = reduce(s, { type: 'toggle', r: 1, c: 2 })
    expect(s.future).toHaveLength(0)
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = reduce(s, { type: 'toggle', r: 1, c: 3 })
    expect(s.past).toHaveLength(HISTORY_LIMIT)
  })

  it('typing a name and dragging a colour are one step each', () => {
    const s = run(
      initialFileStudio(),
      { type: 'rename', name: 'T' },
      { type: 'rename', name: 'Tu' },
      { type: 'rename', name: 'Tulipa' },
      { type: 'setColor', key: 'filled', value: '#111111' },
      { type: 'setColor', key: 'filled', value: '#AA2233' },
    )
    expect(s.chart.name).toBe('Tulipa')
    expect(s.chart.colors.filled).toBe('#aa2233')
    expect(s.past).toHaveLength(2)
  })

  it('rejects invalid colours and sizes', () => {
    const s0 = initialFileStudio()
    expect(reduce(s0, { type: 'setColor', key: 'open', value: 'red' })).toBe(s0)
    expect(reduce(s0, { type: 'resize', rows: 0, cols: 5 })).toBe(s0)
    expect(reduce(s0, { type: 'resize', rows: 5, cols: 201 })).toBe(s0)
    expect(reduce(s0, { type: 'resize', rows: 2.5, cols: 5 })).toBe(s0)
  })

  it('resize keeps the bottom-left content and clamps the progress', () => {
    let s = run(
      initialFileStudio(sample()),
      { type: 'selectRow', row: 3 },
      { type: 'toggleDone', row: 3 },
      { type: 'toggleDone', row: 1 },
    )
    s = reduce(s, { type: 'resize', rows: 2, cols: 4 })
    expect(s.chart.filled).toHaveLength(2)
    expect(s.chart.filled[0]).toEqual([true, false, true, true])
    expect(s.progress.row).toBe(2)
    expect(s.progress.doneRows).toEqual([1])
  })

  it('replaceChart is undoable and resets the progress', () => {
    let s = run(initialFileStudio(), { type: 'selectRow', row: 5 }, { type: 'toggleDone', row: 5 })
    s = reduce(s, { type: 'replaceChart', chart: sample() })
    expect(s.chart.name).toBe('Amostra')
    expect(s.progress).toEqual({ row: 1, segment: 0, doneRows: [] })
    expect(reduce(s, { type: 'undo' }).chart.filled).toHaveLength(10)
  })
})

describe('reading progress', () => {
  it('selectRow clamps and restarts the segment', () => {
    const s0 = initialFileStudio(sample())
    expect(reduce(s0, { type: 'selectRow', row: 99 }).progress.row).toBe(3)
    expect(reduce(s0, { type: 'selectRow', row: -4 }).progress.row).toBe(1)
    const s = run(s0, { type: 'moveSegment', delta: 1 }, { type: 'selectRow', row: 2 })
    expect(s.progress).toEqual({ row: 2, segment: 0, doneRows: [] })
  })

  it('moveRow stays inside the chart', () => {
    const s0 = initialFileStudio(sample())
    expect(reduce(s0, { type: 'moveRow', delta: -1 })).toBe(s0)
    expect(run(s0, { type: 'moveRow', delta: 1 }, { type: 'moveRow', delta: 1 }, { type: 'moveRow', delta: 1 }).progress.row).toBe(3)
  })

  it('moveSegment walks the row and continues into the next and previous rows', () => {
    const s0 = initialFileStudio(sample())
    const count = rowReading(s0.chart, 1).segments.length
    expect(count).toBe(4) // row 1 from the right: 2 abertos, 2 fechados, 1 aberto, 1 fechado
    let s = s0
    for (let i = 1; i < count; i++) s = reduce(s, { type: 'moveSegment', delta: 1 })
    expect(s.progress).toMatchObject({ row: 1, segment: count - 1 })
    s = reduce(s, { type: 'moveSegment', delta: 1 })
    expect(s.progress).toMatchObject({ row: 2, segment: 0 })
    s = reduce(s, { type: 'moveSegment', delta: -1 })
    expect(s.progress).toMatchObject({ row: 1, segment: count - 1 })
    expect(reduce(s0, { type: 'moveSegment', delta: -1 })).toBe(s0)
    const top = reduce(s0, { type: 'selectRow', row: 3 })
    expect(reduce(top, { type: 'moveSegment', delta: 1 })).toBe(top)
  })

  it('selectSegment clamps to the row', () => {
    const s = reduce(initialFileStudio(sample()), { type: 'selectSegment', segment: 50 })
    expect(s.progress.segment).toBe(3)
  })

  it('toggleDone adds and removes rows, sorted', () => {
    const s = run(
      initialFileStudio(sample()),
      { type: 'toggleDone', row: 3 },
      { type: 'toggleDone', row: 1 },
      { type: 'toggleDone', row: 2 },
      { type: 'toggleDone', row: 3 },
      { type: 'toggleDone', row: 9 },
    )
    expect(s.progress.doneRows).toEqual([1, 2])
  })

  it('changing the reading restarts the segment and keeps the row', () => {
    const s = run(
      initialFileStudio(sample()),
      { type: 'moveSegment', delta: 2 },
      { type: 'setReading', firstRowFrom: 'left' },
    )
    expect(s.reading).toEqual({ turning: true, firstRowFrom: 'left' })
    expect(s.progress).toMatchObject({ row: 1, segment: 0 })
    expect(reduce(s, { type: 'setReading', turning: true })).toBe(s)
  })

  it('setMode switches between Editar and Tecer and ends a stroke', () => {
    const s = run(initialFileStudio(), { type: 'strokeStart' }, { type: 'setMode', mode: 'tecer' })
    expect(s.mode).toBe('tecer')
    expect(s.inStroke).toBe(false)
  })
})

describe('persistence', () => {
  it('round-trips chart, mode, reading and progress, but not the history', () => {
    const s = run(
      initialFileStudio(sample()),
      { type: 'toggle', r: 2, c: 2 },
      { type: 'setMode', mode: 'tecer' },
      { type: 'setReading', turning: false, firstRowFrom: 'left' },
      { type: 'selectRow', row: 2 },
      { type: 'moveSegment', delta: 1 },
      { type: 'toggleDone', row: 1 },
    )
    const back = deserializeFileStudio(serializeFileStudio(s))!
    expect(back.chart).toEqual(s.chart)
    expect(back.mode).toBe('tecer')
    expect(back.reading).toEqual({ turning: false, firstRowFrom: 'left' })
    expect(back.progress).toEqual(s.progress)
    expect(back.past).toEqual([])
  })

  it('ignores corrupt or foreign data', () => {
    expect(deserializeFileStudio(null)).toBeNull()
    expect(deserializeFileStudio('')).toBeNull()
    expect(deserializeFileStudio('{not json')).toBeNull()
    expect(deserializeFileStudio('[]')).toBeNull()
    expect(deserializeFileStudio(JSON.stringify({ version: 2, document: toFileDocument(sample()) }))).toBeNull()
    expect(deserializeFileStudio(JSON.stringify({ version: 1, document: { format: 'x' } }))).toBeNull()
  })

  it('repairs out-of-range progress and unknown options', () => {
    const text = JSON.stringify({
      version: 1,
      document: toFileDocument(sample()),
      mode: 'voar',
      reading: { turning: 'sim', firstRowFrom: 'cima' },
      progress: { row: 40, segment: 99, doneRows: [3, 3, 0, 7, 'x', 1.5, 2] },
    })
    const s = deserializeFileStudio(text)!
    expect(s.mode).toBe('editar')
    expect(s.reading).toEqual({ turning: true, firstRowFrom: 'right' })
    expect(s.progress.row).toBe(3)
    expect(s.progress.segment).toBe(rowReading(s.chart, 3).segments.length - 1)
    expect(s.progress.doneRows).toEqual([2, 3])
  })

  it('loads and saves through a storage object, tolerating failures', () => {
    const storage = new MemoryStorage()
    expect(loadFileStudio(storage).chart.filled).toHaveLength(10)
    const s = reduce(initialFileStudio(sample()), { type: 'toggleDone', row: 2 })
    expect(saveFileStudio(storage, s)).toBe(true)
    expect(storage.data.has(STORAGE_KEY)).toBe(true)
    expect(loadFileStudio(storage).progress.doneRows).toEqual([2])

    storage.data.set(STORAGE_KEY, '{"version":1,"document":null}')
    expect(loadFileStudio(storage).chart).toEqual(emptyFileChart(10, 20))

    const broken = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(loadFileStudio(broken).chart.filled).toHaveLength(10)
    expect(saveFileStudio(broken, s)).toBe(false)
    expect(saveFileStudio(null, s)).toBe(false)
  })
})
