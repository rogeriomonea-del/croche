import { describe, expect, it } from 'vitest'
import {
  FILE_FORMAT,
  FILE_MAX_COLS,
  FILE_MAX_ROWS,
  FILE_VERSION,
  parseFileDocument,
  toFileDocument,
  type FileChart,
  type FileDocument,
} from '.'

function chart(): FileChart {
  return {
    name: 'Toalha de mesa',
    // Row 1 = '10010', row 2 = '01100', row 3 = '11111'.
    filled: [
      [true, false, false, true, false],
      [false, true, true, false, false],
      [true, true, true, true, true],
    ],
    colors: { filled: '#1a2b3c', open: '#ffffff' },
  }
}

const validDoc = (): FileDocument => toFileDocument(chart())

function withFields(fields: Record<string, unknown>): Record<string, unknown> {
  return { ...validDoc(), ...fields }
}

function withCell(i: number, row: unknown): Record<string, unknown> {
  const cells: unknown[] = validDoc().cells
  cells[i] = row
  return withFields({ cells })
}

function errorsOf(input: unknown): string[] {
  const result = parseFileDocument(input)
  return result.ok ? [] : result.errors
}

describe('toFileDocument (G3)', () => {
  it('encodes cells[0] as row 1 and character j as column j + 1, 1 = fechado', () => {
    expect(validDoc()).toEqual({
      format: 'crochet-file-pattern',
      version: 1,
      name: 'Toalha de mesa',
      rows: 3,
      cols: 5,
      colors: { filled: '#1a2b3c', open: '#ffffff' },
      cells: ['10010', '01100', '11111'],
    })
    expect([FILE_FORMAT, FILE_VERSION]).toEqual(['crochet-file-pattern', 1])
  })

  it('round-trips through JSON', () => {
    const result = parseFileDocument(JSON.parse(JSON.stringify(toFileDocument(chart()))))
    expect(result).toEqual({ ok: true, chart: chart() })
  })
})

describe('parseFileDocument (G3)', () => {
  it('rejects a non-object', () => {
    expect(errorsOf(null)).toEqual(['documento: esperado um objeto'])
    expect(errorsOf([])).toEqual(['documento: esperado um objeto'])
    expect(errorsOf('x')).toEqual(['documento: esperado um objeto'])
  })

  it('checks format and version exactly', () => {
    expect(errorsOf(withFields({ format: 'mosaic-crochet-pattern' }))).toEqual(['format: esperado "crochet-file-pattern"'])
    expect(errorsOf(withFields({ version: 2 }))).toEqual(['version: versão não suportada, esperado 1'])
    expect(errorsOf(withFields({ version: '1' }))).toEqual(['version: versão não suportada, esperado 1'])
  })

  it('checks the name', () => {
    expect(errorsOf(withFields({ name: 7 }))).toEqual(['name: esperado um texto'])
    expect(errorsOf(withFields({ name: '   ' }))).toEqual(['name: não pode ser vazio'])
    expect(errorsOf(withFields({ name: 'a'.repeat(101) }))).toEqual(['name: no máximo 100 caracteres'])
    expect(errorsOf(withFields({ name: 'a\u0007b' }))).toEqual(['name: não pode conter caracteres de controle'])
    expect(errorsOf(withFields({ name: 'a\u0085b' }))).toEqual(['name: não pode conter caracteres de controle'])
    expect(errorsOf(withFields({ name: 'a\ud800b' }))).toEqual(['name: não pode conter caracteres inválidos (surrogates isolados)'])
  })

  it('counts the name in code points and trims it', () => {
    const name = '😀'.repeat(100)
    const result = parseFileDocument(withFields({ name: `  ${name}  ` }))
    expect(result.ok && result.chart.name).toBe(name)
    expect(errorsOf(withFields({ name: '😀'.repeat(101) }))).toEqual(['name: no máximo 100 caracteres'])
  })

  it('checks rows and cols', () => {
    expect(errorsOf(withFields({ rows: 0 }))).toEqual([`rows: deve estar entre 1 e ${FILE_MAX_ROWS}`])
    expect(errorsOf(withFields({ rows: FILE_MAX_ROWS + 1 }))).toEqual([`rows: deve estar entre 1 e ${FILE_MAX_ROWS}`])
    expect(errorsOf(withFields({ rows: 2.5 }))).toEqual(['rows: esperado um número inteiro'])
    expect(errorsOf(withFields({ rows: '3' }))).toEqual(['rows: esperado um número inteiro'])
    expect(errorsOf(withFields({ cols: 0 }))).toEqual([`cols: deve estar entre 1 e ${FILE_MAX_COLS}`])
    expect(errorsOf(withFields({ cols: FILE_MAX_COLS + 1 }))).toEqual([`cols: deve estar entre 1 e ${FILE_MAX_COLS}`])
    expect(errorsOf(withFields({ cols: 4.5 }))).toEqual(['cols: esperado um número inteiro'])
  })

  it('checks colours and lowercases them', () => {
    expect(errorsOf(withFields({ colors: '#000000' }))).toEqual(['colors: esperado um objeto'])
    expect(errorsOf(withFields({ colors: { filled: '#12345', open: 'white' } }))).toEqual([
      'colors.filled: esperada uma cor hexadecimal #rrggbb',
      'colors.open: esperada uma cor hexadecimal #rrggbb',
    ])
    const result = parseFileDocument(withFields({ colors: { filled: '#ABCDEF', open: '#FfFfFf' } }))
    expect(result.ok && result.chart.colors).toEqual({ filled: '#abcdef', open: '#ffffff' })
  })

  it('checks the cells', () => {
    expect(errorsOf(withFields({ cells: 'nope' }))).toEqual(['cells: esperada uma lista de textos'])
    expect(errorsOf(withFields({ cells: ['10010', '01100'] }))).toEqual(['cells: esperadas 3 carreiras, recebidas 2'])
    expect(errorsOf(withCell(1, '0110'))).toEqual(['cells[1]: esperado 5 caracteres, recebido 4'])
    expect(errorsOf(withCell(2, '11x11'))).toEqual(["cells[2]: só são permitidos '0' e '1'"])
    expect(errorsOf(withCell(0, 10010))).toEqual(['cells[0]: esperado um texto'])
    // A hole in a sparse array is a missing row, not a skipped one.
    const sparse: unknown[] = new Array(3)
    sparse[0] = '10010'
    sparse[2] = '11111'
    expect(errorsOf(withFields({ cells: sparse }))).toEqual(['cells[1]: esperado um texto'])
  })

  it('reports several errors and caps the list at 20', () => {
    expect(errorsOf(withFields({ format: 'x', version: 0, name: '' }))).toHaveLength(3)
    const cells = new Array(30).fill('2')
    const errors = errorsOf(withFields({ rows: 30, cells }))
    expect(errors).toHaveLength(20)
    expect(errors[0]).toBe('cells[0]: esperado 5 caracteres, recebido 1')
  })

  it('ignores unknown keys', () => {
    const result = parseFileDocument(withFields({ extra: 1, derived: { anything: true } }))
    expect(result).toEqual({ ok: true, chart: chart() })
  })

  it('reads each field once and never throws', () => {
    let reads = 0
    const doc = validDoc()
    const tricky = {
      ...doc,
      get name() {
        reads++
        return reads === 1 ? 'Primeiro' : ''
      },
    }
    const result = parseFileDocument(tricky)
    expect(reads).toBe(1)
    expect(result.ok && result.chart.name).toBe('Primeiro')

    const throwing = Object.defineProperty({ ...doc }, 'cells', {
      get() {
        throw new Error('boom')
      },
    })
    expect(errorsOf(throwing)).toEqual(['documento: não foi possível ler'])
  })
})
