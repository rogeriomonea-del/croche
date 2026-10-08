import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import {
  emptyMatrix,
  exportDocument,
  fromDocument,
  MAX_COLS,
  MAX_ROWS,
  MIN_COLS,
  MIN_ROWS,
  parseDocument,
  PATTERN_DOCUMENT_SCHEMA,
  toDocument,
  toggle,
  type DesignData,
  type PatternDocument,
} from '.'

// SPEC §5 Case B on 15×20, drawn with the same toggles as golden.test.ts.
const CASE_B: Array<[number, number]> = [[5, 5], [5, 8], [10, 8], [6, 5], [3, 12], [4, 12], [5, 12], [15, 10]]

function design(rows = 15, cols = 20, toggles: Array<[number, number]> = CASE_B): DesignData {
  return {
    name: 'Losangos',
    delta: toggles.reduce((d, [r, c]) => toggle(d, r, c), emptyMatrix(rows, cols)),
    colors: { main: '#f3ead8', pattern: '#0f766e' },
  }
}

const validDoc = (): PatternDocument => toDocument(design())

/** A canonical document with some fields replaced, as untyped JSON input. */
function withFields(fields: Record<string, unknown>): Record<string, unknown> {
  return { ...validDoc(), ...fields }
}

function withCell(i: number, row: unknown): Record<string, unknown> {
  const cells: unknown[] = validDoc().cells
  cells[i] = row
  return withFields({ cells })
}

function errorsOf(input: unknown): string[] {
  const result = parseDocument(input)
  return result.ok ? [] : result.errors
}

describe('toDocument / fromDocument', () => {
  it('encodes cells[0] as row 1 and character j as column j + 1, 1 = deviation', () => {
    const doc = toDocument(design(5, 6, [[2, 1], [4, 6]]))
    expect(doc).toEqual({
      format: 'mosaic-crochet-pattern',
      version: 1,
      name: 'Losangos',
      rows: 5,
      cols: 6,
      colors: { A: '#f3ead8', B: '#0f766e' },
      cells: ['000000', '100000', '000000', '000001', '000000'],
    })
  })

  it('round trips', () => {
    expect(fromDocument(toDocument(design()))).toEqual(design())
    expect(toDocument(fromDocument(validDoc()))).toEqual(validDoc())
  })
})

describe('parseDocument accepts (SPEC §10)', () => {
  it('a canonical document, returning a new object', () => {
    const doc = validDoc()
    const result = parseDocument(doc)
    expect(result).toEqual({ ok: true, document: doc })
    if (!result.ok) return
    expect(result.document).not.toBe(doc)
    expect(result.document.cells).not.toBe(doc.cells)
    expect(result.document.colors).not.toBe(doc.colors)
  })

  it('the smallest and largest grids', () => {
    expect(parseDocument(toDocument(design(MIN_ROWS, MIN_COLS, [[2, 1]]))).ok).toBe(true)
    expect(parseDocument(toDocument(design(MAX_ROWS, MAX_COLS, [[2, 1], [MAX_ROWS - 1, MAX_COLS]]))).ok).toBe(true)
  })

  it('trims the name and lowercases the colors', () => {
    const result = parseDocument(withFields({ name: '  Losangos\n', colors: { A: '#F3EAD8', B: '#0F766e' } }))
    expect(result).toEqual({ ok: true, document: validDoc() })
  })

  it('names of up to 100 characters after trimming, counted in code points', () => {
    expect(parseDocument(withFields({ name: ` ${'x'.repeat(100)} ` })).ok).toBe(true)
    expect(parseDocument(withFields({ name: '🧶'.repeat(100) })).ok).toBe(true)
    expect(parseDocument(withFields({ name: 'Ninho de abelha — azul' })).ok).toBe(true)
  })

  it('drops unknown keys and derived, at every level', () => {
    const input = { ...exportDocument(validDoc()), extra: 1, colors: { A: '#f3ead8', B: '#0f766e', C: '#000000' } }
    // JSON.parse turns "__proto__" into an own key; it must not reach the result either.
    const json = JSON.stringify(input).replace('{', '{"__proto__":{"polluted":true},')
    const result = parseDocument(JSON.parse(json))
    expect(result).toEqual({ ok: true, document: validDoc() })
    if (!result.ok) return
    expect(Object.keys(result.document)).toEqual(['format', 'version', 'name', 'rows', 'cols', 'colors', 'cells'])
    expect(Object.keys(result.document.colors)).toEqual(['A', 'B'])
    expect(Object.getPrototypeOf(result.document)).toBe(Object.prototype)
    expect('polluted' in result.document).toBe(false)
  })
})

describe('parseDocument rejects, naming the path', () => {
  const cases: Array<[string, unknown, string]> = [
    ['format missing', withFields({ format: undefined }), 'format: expected "mosaic-crochet-pattern"'],
    ['format wrong', withFields({ format: 'mosaic' }), 'format: expected "mosaic-crochet-pattern"'],
    ['version 2', withFields({ version: 2 }), 'version: unsupported, expected 1'],
    ['version as a string', withFields({ version: '1' }), 'version: unsupported, expected 1'],
    ['name missing', withFields({ name: undefined }), 'name: expected a string'],
    ['name a number', withFields({ name: 42 }), 'name: expected a string'],
    ['name empty', withFields({ name: '' }), 'name: must not be empty'],
    ['name blank', withFields({ name: ' \t\n ' }), 'name: must not be empty'],
    ['name 101 chars', withFields({ name: 'x'.repeat(101) }), 'name: must be at most 100 characters'],
    ['name 101 code points', withFields({ name: '🧶'.repeat(101) }), 'name: must be at most 100 characters'],
    ['name 10 MB', withFields({ name: 'x'.repeat(10_000_000) }), 'name: must be at most 100 characters'],
    ['name with NUL', withFields({ name: 'a\u0000b' }), 'name: must not contain control characters'],
    ['name with inner newline', withFields({ name: 'a\nb' }), 'name: must not contain control characters'],
    ['name with U+001F', withFields({ name: 'a\u001fb' }), 'name: must not contain control characters'],
    ['name with DEL', withFields({ name: 'a\u007fb' }), 'name: must not contain control characters'],
    ['rows missing', withFields({ rows: undefined }), 'rows: expected an integer'],
    ['rows a string', withFields({ rows: '15' }), 'rows: expected an integer'],
    ['rows fractional', withFields({ rows: 15.5 }), 'rows: expected an integer'],
    ['rows NaN', withFields({ rows: NaN }), 'rows: expected an integer'],
    ['rows below 5', withFields({ rows: 3 }), 'rows: must be between 5 and 119'],
    ['rows above 119', withFields({ rows: 121 }), 'rows: must be between 5 and 119'],
    ['rows even', withFields({ rows: 16 }), 'rows: must be odd'],
    ['cols missing', withFields({ cols: null }), 'cols: expected an integer'],
    ['cols fractional', withFields({ cols: 20.5 }), 'cols: expected an integer'],
    ['cols below 5', withFields({ cols: 4 }), 'cols: must be between 5 and 120'],
    ['cols above 120', withFields({ cols: 121 }), 'cols: must be between 5 and 120'],
    ['colors missing', withFields({ colors: undefined }), 'colors: expected an object'],
    ['colors an array', withFields({ colors: ['#000000', '#ffffff'] }), 'colors: expected an object'],
    ['colors.A missing', withFields({ colors: { B: '#ffffff' } }), 'colors.A: expected a hex color #rrggbb'],
    ['colors.A short form', withFields({ colors: { A: '#fff', B: '#ffffff' } }), 'colors.A: expected a hex color #rrggbb'],
    ['colors.B a name', withFields({ colors: { A: '#ffffff', B: 'red' } }), 'colors.B: expected a hex color #rrggbb'],
    ['colors.B not hex', withFields({ colors: { A: '#ffffff', B: '#12345g' } }), 'colors.B: expected a hex color #rrggbb'],
    ['colors.B trailing newline', withFields({ colors: { A: '#ffffff', B: '#123456\n' } }), 'colors.B: expected a hex color #rrggbb'],
    ['cells missing', withFields({ cells: undefined }), 'cells: expected an array of strings'],
    ['cells a string', withFields({ cells: '0000' }), 'cells: expected an array of strings'],
    ['cells too few', withFields({ cells: validDoc().cells.slice(1) }), 'cells: expected 15 rows, got 14'],
    ['cells too many', withFields({ cells: [...validDoc().cells, '0'.repeat(20)] }), 'cells: expected 15 rows, got 16'],
    ['cells row not a string', withCell(3, 0), 'cells[3]: expected a string'],
    ['cells row an array', withCell(3, Array(20).fill('0')), 'cells[3]: expected a string'],
    ['cells row short', withCell(3, '0'.repeat(19)), 'cells[3]: expected 20 characters, got 19'],
    ['cells row long', withCell(3, '0'.repeat(21)), 'cells[3]: expected 20 characters, got 21'],
    ['cells row with 2', withCell(3, '0'.repeat(19) + '2'), "cells[3]: only '0' and '1' are allowed"],
    ['cells row with space', withCell(3, '0'.repeat(19) + ' '), "cells[3]: only '0' and '1' are allowed"],
    ['cells sparse', withFields({ cells: Object.assign(new Array(15), { 0: '0'.repeat(20) }) }), 'cells[1]: expected a string'],
    // SPEC §4: rows 1 and `rows` are locked.
    ['base row deviates', withCell(0, '1' + '0'.repeat(19)), 'cells[0]: row 1 is the base row and cannot deviate'],
    ['top row deviates', withCell(14, '0'.repeat(9) + '1' + '0'.repeat(10)), 'cells[14]: row 15 is the top row and cannot deviate'],
  ]

  it.each(cases)('%s', (_, input, error) => {
    expect(errorsOf(input)).toContain(error)
  })

  it('a top row that deviates on the largest grid', () => {
    const cells = toDocument(design(MAX_ROWS, MAX_COLS, [])).cells
    cells[MAX_ROWS - 1] = '1'.repeat(MAX_COLS)
    expect(errorsOf({ ...toDocument(design(MAX_ROWS, MAX_COLS, [])), cells })).toEqual([
      'cells[118]: row 119 is the top row and cannot deviate',
    ])
  })

  it('reports every problem at once, capped at 20', () => {
    expect(errorsOf(withFields({ format: 'x', version: 0, name: '' }))).toEqual([
      'format: expected "mosaic-crochet-pattern"',
      'version: unsupported, expected 1',
      'name: must not be empty',
    ])
    const doc = toDocument(design(MAX_ROWS, MAX_COLS, []))
    const errors = errorsOf({ ...doc, cells: doc.cells.map(() => '0') })
    expect(errors).toHaveLength(20)
    expect(errors[0]).toBe('cells[0]: expected 120 characters, got 1')
  })

  it('does not echo the offending value', () => {
    for (const error of errorsOf(withFields({ name: '<script>' + 'x'.repeat(200) }))) expect(error).not.toContain('<script>')
  })
})

describe('parseDocument never throws', () => {
  const throwing = Object.defineProperty({ ...validDoc() }, 'cells', {
    enumerable: true,
    get() {
      throw new Error('boom')
    },
  })
  const { proxy: revoked, revoke } = Proxy.revocable({}, {})
  revoke()
  const inputs: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['zero', 0],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['true', true],
    ['a bigint', 10n],
    ['a symbol', Symbol('doc')],
    ['a function', () => validDoc()],
    ['a string', 'mosaic-crochet-pattern'],
    ['a 10 MB string', 'x'.repeat(10 * 1024 * 1024)],
    ['the document as a JSON string', JSON.stringify(validDoc())],
    ['an empty array', []],
    ['an array holding a document', [validDoc()]],
    ['an empty object', {}],
    ['a null-prototype object', Object.create(null)],
    ['every field null', { format: null, version: null, name: null, rows: null, cols: null, colors: null, cells: null }],
    ['every field an object', { format: {}, version: {}, name: {}, rows: {}, cols: {}, colors: {}, cells: {} }],
    ['nested wrong shapes', withFields({ colors: { A: { toLowerCase: 1 }, B: [[[]]] }, cells: [[], {}, null, 1, [[[]]]] })],
    ['a huge cells array', withFields({ cells: new Array(10_000_000) })],
    ['a 10 MB cell', withCell(3, '1'.repeat(10 * 1024 * 1024))],
    ['a throwing getter', throwing],
    ['a revoked proxy', revoked],
    ['a deeply nested object', JSON.parse('{"a":'.repeat(5000) + '1' + '}'.repeat(5000))],
  ]

  it.each(inputs)('%s', (_, input) => {
    let result: ReturnType<typeof parseDocument> | undefined
    expect(() => (result = parseDocument(input))).not.toThrow()
    expect(result?.ok).toBe(false)
    if (result && !result.ok) {
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.length).toBeLessThanOrEqual(20)
    }
  })

  it('reports an unreadable input as invalid', () => {
    expect(errorsOf(throwing)).toEqual(['document: could not be read'])
  })
})

describe('exportDocument (SPEC §10 export)', () => {
  it('derives chart, instructions and conflicts for §5 Case B', () => {
    const doc = validDoc()
    const exported = exportDocument(doc)
    const special: Record<number, string> = {
      4: 'Row 4: 8 sc, 1 dc and 11 sc',
      5: 'Row 5: 8 sc, 1 dc and 11 sc',
      6: 'Row 6: 8 sc, 1 dc, 3 sc, 1 dc, 2 sc, 1 dc and 4 sc',
      7: 'Row 7: 15 sc, 1 dc and 4 sc',
      11: 'Row 11: 12 sc, 1 dc and 7 sc',
    }
    expect(exported.derived.instructions).toEqual(Array.from({ length: 15 }, (_, i) => special[i + 1] ?? `Row ${i + 1}: 20 sc`))
    expect(exported.derived.conflicts).toEqual([[4, 12], [5, 12], [6, 5], [6, 12], [7, 5]])
    // chart[5] is row 6: the dc of the deviations on row 5, columns 5, 8 and 12.
    expect(exported.derived.chart[5]).toBe('00001001000100000000')
    expect(exported.derived.chart[0]).toBe('0'.repeat(20))
    expect(exported.derived.chart).toHaveLength(15)
    const { derived, ...rest } = exported
    expect(derived).toBeDefined()
    expect(rest).toEqual(doc)
  })

  it('re-imports to the same canonical document', () => {
    const doc = validDoc()
    expect(parseDocument(JSON.parse(JSON.stringify(exportDocument(doc))))).toEqual({ ok: true, document: doc })
  })
})

describe('PATTERN_DOCUMENT_SCHEMA (JSON Schema 2020-12)', () => {
  // strict: unknown keywords or type mismatches in the schema throw at compile time.
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(PATTERN_DOCUMENT_SCHEMA)

  it('accepts canonical documents', () => {
    expect(validate(validDoc())).toBe(true)
    expect(validate(toDocument(design(MIN_ROWS, MIN_COLS, [])))).toBe(true)
    expect(validate(toDocument(design(MAX_ROWS, MAX_COLS, [])))).toBe(true)
    expect(validate(JSON.parse(JSON.stringify(exportDocument(validDoc()))))).toBe(true)
  })

  // schema: what the schema says; parse: what parseDocument says. Structural cases agree. The
  // semantic ones (marked) pass the schema and fail parseDocument, by design (SPEC §10).
  const table: Array<[string, unknown, { schema: boolean; parse: boolean }]> = [
    ['canonical', validDoc(), { schema: true, parse: true }],
    ['unknown keys', withFields({ extra: [1], colors: { A: '#ffffff', B: '#000000', C: 1 } }), { schema: true, parse: true }],
    ['uppercase colors', withFields({ colors: { A: '#FFFFFF', B: '#ABCDEF' } }), { schema: true, parse: true }],
    ['null', null, { schema: false, parse: false }],
    ['an array', [validDoc()], { schema: false, parse: false }],
    ['a string', 'doc', { schema: false, parse: false }],
    ['format wrong', withFields({ format: 'other' }), { schema: false, parse: false }],
    ['version 2', withFields({ version: 2 }), { schema: false, parse: false }],
    ['version "1"', withFields({ version: '1' }), { schema: false, parse: false }],
    ['name missing', withFields({ name: undefined }), { schema: false, parse: false }],
    ['name a number', withFields({ name: 7 }), { schema: false, parse: false }],
    ['name empty', withFields({ name: '' }), { schema: false, parse: false }],
    ['rows fractional', withFields({ rows: 15.5 }), { schema: false, parse: false }],
    ['rows even', withFields({ rows: 16 }), { schema: false, parse: false }],
    ['rows 3', withFields({ rows: 3 }), { schema: false, parse: false }],
    ['rows 121', withFields({ rows: 121 }), { schema: false, parse: false }],
    ['cols 4', withFields({ cols: 4 }), { schema: false, parse: false }],
    ['cols 121', withFields({ cols: 121 }), { schema: false, parse: false }],
    ['cols a string', withFields({ cols: '20' }), { schema: false, parse: false }],
    ['colors missing', withFields({ colors: undefined }), { schema: false, parse: false }],
    ['colors.B missing', withFields({ colors: { A: '#ffffff' } }), { schema: false, parse: false }],
    ['colors.A short', withFields({ colors: { A: '#fff', B: '#000000' } }), { schema: false, parse: false }],
    ['cells not an array', withFields({ cells: 'x' }), { schema: false, parse: false }],
    ['cells row with 2', withCell(3, '2'.repeat(20)), { schema: false, parse: false }],
    ['cells row a number', withCell(3, 0), { schema: false, parse: false }],
    ['cells row empty', withCell(3, ''), { schema: false, parse: false }],
    // Semantic: relations between fields, trimming, control characters and locked rows.
    ['name blank (semantic)', withFields({ name: '   ' }), { schema: true, parse: false }],
    ['name 101 chars (semantic)', withFields({ name: 'x'.repeat(101) }), { schema: true, parse: false }],
    ['name with a control char (semantic)', withFields({ name: 'a\u0001b' }), { schema: true, parse: false }],
    ['cells shorter than rows (semantic)', withFields({ cells: validDoc().cells.slice(1) }), { schema: true, parse: false }],
    ['row shorter than cols (semantic)', withCell(3, '0'.repeat(19)), { schema: true, parse: false }],
    ['base row deviates (semantic)', withCell(0, '1'.repeat(20)), { schema: true, parse: false }],
    ['top row deviates (semantic)', withCell(14, '1'.repeat(20)), { schema: true, parse: false }],
  ]

  it.each(table)('%s', (_, input, expected) => {
    // Through JSON, as the API sees it (undefined fields disappear).
    const json = JSON.parse(JSON.stringify(input))
    expect({ schema: validate(json), parse: parseDocument(json).ok }).toEqual(expected)
  })
})
