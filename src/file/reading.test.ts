import { describe, expect, it } from 'vitest'
import {
  compressRuns,
  DEFAULT_READING,
  emptyFileChart,
  formatCount,
  formatRuns,
  formatSegments,
  rowReading,
  rowRuns,
  rowStartSide,
  speechChunks,
  speechText,
  type FileChart,
  type Run,
} from '.'

/** rows[0] is row 1 (bottom); character j is column j + 1; '1' = fechado. */
function chartOf(rows: string[]): FileChart {
  return {
    name: 'Teste',
    filled: rows.map((row) => Array.from(row, (ch) => ch === '1')),
    colors: { filled: '#000000', open: '#ffffff' },
  }
}

/** Runs from a compact spec such as "a2 f1 a1": a = aberto, f = fechado. Positions are not checked by compression. */
function runsOf(spec: string): Run[] {
  let start = 1
  return spec.split(' ').map((token) => {
    const count = Number(token.slice(1))
    const run: Run = { kind: token[0] === 'f' ? 'fechado' : 'aberto', count, start, fromCol: start, toCol: start + count - 1 }
    start += count
    return run
  })
}

// G1 chart: row 1 = [aberto, fechado, fechado, aberto, aberto] from column 1 to 5.
const G1 = chartOf(['01100', '01100', '10000'])

describe('rowStartSide', () => {
  it('alternates when the work is turned, starting from the chosen side', () => {
    expect([1, 2, 3, 4].map((r) => rowStartSide(r))).toEqual(['right', 'left', 'right', 'left'])
    expect([1, 2, 3].map((r) => rowStartSide(r, { turning: true, firstRowFrom: 'left' }))).toEqual(['left', 'right', 'left'])
  })

  it('keeps the first side on every row without turning', () => {
    expect([1, 2, 3].map((r) => rowStartSide(r, { turning: false, firstRowFrom: 'right' }))).toEqual(['right', 'right', 'right'])
    expect([1, 2].map((r) => rowStartSide(r, { turning: false, firstRowFrom: 'left' }))).toEqual(['left', 'left'])
  })

  it('defaults to turning, row 1 from the right', () => {
    expect(DEFAULT_READING).toEqual({ turning: true, firstRowFrom: 'right' })
  })
})

describe('rowReading (G1)', () => {
  it('reads row 1 right to left by default', () => {
    const reading = rowReading(G1, 1)
    expect(reading.text).toBe('Carreira 1 (da direita para a esquerda): 2 abertos, 2 fechados e 1 aberto')
    expect(reading.side).toBe('right')
    expect(reading.direction).toBe('da direita para a esquerda')
    expect(reading.runs).toEqual([
      { kind: 'aberto', count: 2, start: 1, fromCol: 4, toCol: 5 },
      { kind: 'fechado', count: 2, start: 3, fromCol: 2, toCol: 3 },
      { kind: 'aberto', count: 1, start: 5, fromCol: 1, toCol: 1 },
    ])
  })

  it('reads row 2 left to right when turning', () => {
    const reading = rowReading(G1, 2)
    expect(reading.text).toBe('Carreira 2 (da esquerda para a direita): 1 aberto, 2 fechados e 2 abertos')
    expect(reading.runs).toEqual([
      { kind: 'aberto', count: 1, start: 1, fromCol: 1, toCol: 1 },
      { kind: 'fechado', count: 2, start: 2, fromCol: 2, toCol: 3 },
      { kind: 'aberto', count: 2, start: 4, fromCol: 4, toCol: 5 },
    ])
  })

  it('reads every row right to left without turning', () => {
    const options = { turning: false, firstRowFrom: 'right' as const }
    expect(rowReading(G1, 2, options).text).toBe('Carreira 2 (da direita para a esquerda): 2 abertos, 2 fechados e 1 aberto')
    expect(rowReading(G1, 3, options).text).toBe('Carreira 3 (da direita para a esquerda): 4 abertos e 1 fechado')
  })

  it('reads row 1 left to right when it starts from the left', () => {
    const reading = rowReading(G1, 1, { turning: true, firstRowFrom: 'left' })
    expect(reading.text).toBe('Carreira 1 (da esquerda para a direita): 1 aberto, 2 fechados e 2 abertos')
    expect(reading.runs[0]).toEqual({ kind: 'aberto', count: 1, start: 1, fromCol: 1, toCol: 1 })
    expect(rowReading(G1, 2, { turning: true, firstRowFrom: 'left' }).side).toBe('right')
  })

  it('reads a one-run row as a single count', () => {
    const chart = emptyFileChart(2, 5)
    expect(rowReading(chart, 1).text).toBe('Carreira 1 (da direita para a esquerda): 5 abertos')
    expect(rowRuns(chart, 2)).toEqual([{ kind: 'aberto', count: 5, start: 1, fromCol: 1, toCol: 5 }])
  })

  it('counts squares and filet stitches for a mixed row', () => {
    const reading = rowReading(G1, 1)
    expect(reading).toMatchObject({ row: 1, filled: 2, open: 3, total: 5 })
    // 1 starting pa + 3 per fechado + 1 per aberto; 2 correntes per aberto.
    expect(reading.stitches).toEqual({ pa: 1 + 3 * 2 + 3, correntes: 2 * 3 })
  })

  it('rejects a row outside the chart', () => {
    expect(() => rowReading(G1, 0)).toThrow(RangeError)
    expect(() => rowReading(G1, 4)).toThrow(RangeError)
  })
})

describe('formatting', () => {
  it('pluralises counts', () => {
    expect([formatCount('fechado', 1), formatCount('fechado', 3), formatCount('aberto', 1), formatCount('aberto', 10)]).toEqual([
      '1 fechado',
      '3 fechados',
      '1 aberto',
      '10 abertos',
    ])
  })

  it('joins a Portuguese list with commas and " e " before the last item', () => {
    expect(formatRuns(runsOf('a90'))).toBe('90 abertos')
    expect(formatRuns(runsOf('a2 f1'))).toBe('2 abertos e 1 fechado')
    expect(formatRuns(runsOf('a10 f1 a1 f3 a2'))).toBe('10 abertos, 1 fechado, 1 aberto, 3 fechados e 2 abertos')
    expect(formatRuns([])).toBe('')
  })
})

describe('compressRuns (G2)', () => {
  it('folds a block repeated three times', () => {
    // Columns 1..12, read right to left: 2 abertos, then (1 fechado, 1 aberto) three times, then 4 fechados.
    const chart = chartOf(['111101010100'])
    const reading = rowReading(chart, 1)
    expect(reading.text).toBe('Carreira 1 (da direita para a esquerda): 2 abertos, 1 fechado, 1 aberto, 1 fechado, 1 aberto, 1 fechado, 1 aberto e 4 fechados')
    expect(reading.compactText).toBe('Carreira 1 (da direita para a esquerda): 2 abertos, 3× (1 fechado, 1 aberto) e 4 fechados')
    expect(formatSegments(reading.segments)).toBe('2 abertos, 3× (1 fechado, 1 aberto) e 4 fechados')
    expect(reading.segments[1]).toEqual({
      type: 'repeat',
      times: 3,
      runs: [
        { kind: 'fechado', count: 1, start: 3, fromCol: 10, toCol: 10 },
        { kind: 'aberto', count: 1, start: 4, fromCol: 9, toCol: 9 },
      ],
    })
  })

  it('does not fold a block repeated only twice', () => {
    const segments = compressRuns(runsOf('a2 f1 a1 f1 a1 f4'))
    expect(segments.every((s) => s.type === 'run')).toBe(true)
    expect(formatSegments(segments)).toBe('2 abertos, 1 fechado, 1 aberto, 1 fechado, 1 aberto e 4 fechados')
  })

  it('folds blocks of up to four runs but not longer ones', () => {
    expect(formatSegments(compressRuns(runsOf('f1 a2 f3 a1 f1 a2 f3 a1 f1 a2 f3 a1 f5')))).toBe(
      '3× (1 fechado, 2 abertos, 3 fechados, 1 aberto) e 5 fechados',
    )
    const six = 'f1 a2 f3 a1 f2 a3'
    const segments = compressRuns(runsOf(`${six} ${six} ${six}`))
    expect(segments).toHaveLength(18)
    expect(segments.every((s) => s.type === 'run')).toBe(true)
  })

  it('prefers the shorter block when two cover the same squares', () => {
    // (f1 a1) six times is also (f1 a1 f1 a1) three times.
    expect(formatSegments(compressRuns(runsOf('f1 a1 f1 a1 f1 a1 f1 a1 f1 a1 f1 a1')))).toBe('6× (1 fechado, 1 aberto)')
  })

  it('keeps going after a repeat', () => {
    expect(formatSegments(compressRuns(runsOf('f2 a1 f2 a1 f2 a1 f9 a3 f1 a3 f1 a3 f1')))).toBe(
      '3× (2 fechados, 1 aberto), 9 fechados e 3× (3 abertos, 1 fechado)',
    )
  })
})

describe('speech (G2)', () => {
  const reading = rowReading(chartOf(['111101010100']), 1)

  it('gives one phrase per segment', () => {
    expect(speechChunks(reading)).toEqual(['2 abertos', '3 vezes: 1 fechado, 1 aberto', '4 fechados'])
  })

  it('speaks the row header and the compact segments', () => {
    expect(speechText(reading)).toBe('Carreira 1, da direita para a esquerda. 2 abertos. 3 vezes: 1 fechado, 1 aberto. 4 fechados.')
  })
})
