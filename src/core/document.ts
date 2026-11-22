import { conflicts } from './conflicts'
import { deriveX } from './deriveX'
import { cellsOf, colCount, MAX_COLS, MAX_ROWS, MIN_COLS, MIN_ROWS, type Matrix } from './grid'
import { instructions } from './instructions'
import type { Yarn } from './stripe'

// SPEC §10: the one pattern format shared by the database, the API, export and import.
export const DOCUMENT_FORMAT = 'mosaic-crochet-pattern'
export const DOCUMENT_VERSION = 1
export const NAME_MAX = 100

const MAX_ERRORS = 20
const HEX_COLOR = '^#[0-9a-fA-F]{6}$'
const HEX_COLOR_RE = new RegExp(HEX_COLOR)
// Every Unicode control character (C0, DEL and C1): NEL or CSI would break lines or start
// terminal escapes wherever the name is shown.
const CONTROL_CHAR_RE = /\p{Cc}/u
// In 'u' mode only an unpaired surrogate matches Cs. SQLite stores it as U+FFFD in the name
// column while the JSON document keeps it, so the two copies of the name would disagree.
const LONE_SURROGATE_RE = /\p{Cs}/u

export interface PatternDocument {
  format: typeof DOCUMENT_FORMAT
  version: typeof DOCUMENT_VERSION
  name: string
  rows: number
  cols: number
  /** A = main (odd rows, background), B = pattern (even rows). */
  colors: { A: string; B: string }
  /** `cells[0]` is row 1; character j is column j + 1; '1' = the cell deviates from its stripe. */
  cells: string[]
}

export interface ExportedPatternDocument extends PatternDocument {
  derived: {
    /** Same encoding as `cells`, '1' = dc. */
    chart: string[]
    instructions: string[]
    conflicts: Array<[number, number]>
  }
}

/** A design as the UI holds it, plus its name. */
export interface DesignData {
  name: string
  delta: Matrix
  colors: Record<Yarn, string>
}

export type ParseDocumentResult = { ok: true; document: PatternDocument } | { ok: false; errors: string[] }

function encode(m: Matrix): string[] {
  return m.map((row) => row.map((v) => (v ? '1' : '0')).join(''))
}

export function toDocument(design: DesignData): PatternDocument {
  return {
    format: DOCUMENT_FORMAT,
    version: DOCUMENT_VERSION,
    name: design.name,
    rows: design.delta.length,
    cols: colCount(design.delta),
    colors: { A: design.colors.main, B: design.colors.pattern },
    cells: encode(design.delta),
  }
}

export function fromDocument(doc: PatternDocument): DesignData {
  return {
    name: doc.name,
    delta: doc.cells.map((row) => Array.from(row, (ch) => ch === '1')),
    colors: { main: doc.colors.A, pattern: doc.colors.B },
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Each code point is one or two UTF-16 units, so a string over 2 × max units is too long without
// spreading a possibly huge string into an array.
function codePointLength(s: string, max: number): number {
  return s.length > 2 * max ? Infinity : [...s].length
}

function nameError(name: string): string | null {
  if (name.length === 0) return 'name: must not be empty'
  if (codePointLength(name, NAME_MAX) > NAME_MAX) return `name: must be at most ${NAME_MAX} characters`
  if (CONTROL_CHAR_RE.test(name)) return 'name: must not contain control characters'
  if (LONE_SURROGATE_RE.test(name)) return 'name: must not contain unpaired surrogates'
  return null
}

function integerError(path: string, v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v)) return `${path}: expected an integer`
  if (v < min || v > max) return `${path}: must be between ${min} and ${max}`
  return null
}

function rowError(row: unknown, i: number, rows: number, cols: number): string | null {
  const path = `cells[${i}]`
  if (typeof row !== 'string') return `${path}: expected a string`
  // Length first: the character check below then only ever scans at most MAX_COLS characters.
  if (row.length !== cols) return `${path}: expected ${cols} characters, got ${row.length}`
  if (!/^[01]*$/.test(row)) return `${path}: only '0' and '1' are allowed`
  // SPEC §4: no dc can reach a deviation on the base or the top row.
  if (row.includes('1')) {
    if (i === 0) return `${path}: row 1 is the base row and cannot deviate`
    if (i === rows - 1) return `${path}: row ${rows} is the top row and cannot deviate`
  }
  return null
}

// Every field is read exactly once and the output is built from those reads, so a getter or proxy
// cannot hand the checks one value and the result another.
function parse(input: unknown): ParseDocumentResult {
  if (!isObject(input)) return { ok: false, errors: ['document: expected an object'] }
  const errors: string[] = []
  const { format, version, name, rows, cols, colors, cells } = input

  if (format !== DOCUMENT_FORMAT) errors.push(`format: expected "${DOCUMENT_FORMAT}"`)
  if (version !== DOCUMENT_VERSION) errors.push(`version: unsupported, expected ${DOCUMENT_VERSION}`)

  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (typeof name !== 'string') errors.push('name: expected a string')
  else {
    const e = nameError(trimmedName)
    if (e) errors.push(e)
  }

  const rowsError = integerError('rows', rows, MIN_ROWS, MAX_ROWS) ?? ((rows as number) % 2 === 0 ? 'rows: must be odd' : null)
  const colsError = integerError('cols', cols, MIN_COLS, MAX_COLS)
  if (rowsError) errors.push(rowsError)
  if (colsError) errors.push(colsError)

  const hex: Record<'A' | 'B', string> = { A: '', B: '' }
  if (!isObject(colors)) errors.push('colors: expected an object')
  else {
    for (const key of ['A', 'B'] as const) {
      const v = colors[key]
      if (typeof v === 'string' && HEX_COLOR_RE.test(v)) hex[key] = v.toLowerCase()
      else errors.push(`colors.${key}: expected a hex color #rrggbb`)
    }
  }

  const rowStrings: string[] = []
  if (!Array.isArray(cells)) errors.push('cells: expected an array of strings')
  else if (!rowsError && cells.length !== rows) errors.push(`cells: expected ${rows} rows, got ${cells.length}`)
  // Rows are only checked against valid dimensions, which also bounds this loop to MAX_ROWS. A plain
  // loop, not forEach: a hole in a sparse array must fail as a missing string, not be skipped.
  else if (!rowsError && !colsError) {
    for (let i = 0; i < (rows as number); i++) {
      const row: unknown = cells[i]
      const e = rowError(row, i, rows as number, cols as number)
      if (e) errors.push(e)
      else rowStrings.push(row as string)
    }
  }

  if (errors.length > 0) return { ok: false, errors: errors.slice(0, MAX_ERRORS) }
  return {
    ok: true,
    document: {
      format: DOCUMENT_FORMAT,
      version: DOCUMENT_VERSION,
      name: trimmedName,
      rows: rows as number,
      cols: cols as number,
      colors: hex,
      cells: rowStrings,
    },
  }
}

/**
 * Validates untrusted input (SPEC §10) and returns a canonical new document: known keys only (unknown
 * keys and `derived` are dropped), name trimmed, colors lowercased. Error strings name the path. It
 * never throws: anything that cannot even be read, such as a throwing getter, is reported as invalid.
 */
export function parseDocument(input: unknown): ParseDocumentResult {
  try {
    return parse(input)
  } catch {
    return { ok: false, errors: ['document: could not be read'] }
  }
}

/** A valid document plus what the core derives from it (SPEC §10 export). */
export function exportDocument(doc: PatternDocument): ExportedPatternDocument {
  const X = deriveX(fromDocument(doc).delta)
  return {
    format: doc.format,
    version: doc.version,
    name: doc.name,
    rows: doc.rows,
    cols: doc.cols,
    colors: { A: doc.colors.A, B: doc.colors.B },
    cells: [...doc.cells],
    derived: {
      chart: encode(X),
      instructions: instructions(X),
      conflicts: cellsOf(conflicts(X)),
    },
  }
}

const HEX_COLOR_SCHEMA = { type: 'string', pattern: HEX_COLOR, description: 'Hex color #rrggbb; stored lowercased.' }

/**
 * JSON Schema (draft 2020-12) for PatternDocument v1. It holds the structural rules; the rules that
 * relate fields to each other or depend on trimming are only described here and enforced by
 * `parseDocument`. Unknown keys are allowed because the format ignores them.
 */
export const PATTERN_DOCUMENT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Mosaic crochet pattern document v1',
  type: 'object',
  required: ['format', 'version', 'name', 'rows', 'cols', 'colors', 'cells'],
  properties: {
    format: { const: DOCUMENT_FORMAT },
    version: { const: DOCUMENT_VERSION },
    name: {
      type: 'string',
      minLength: 1,
      description: `1–${NAME_MAX} characters after trimming, no control characters (U+0000–U+001F, U+007F–U+009F), no unpaired surrogates.`,
    },
    rows: { type: 'integer', minimum: MIN_ROWS, maximum: MAX_ROWS, not: { multipleOf: 2 }, description: 'Odd, so the piece starts and ends in color A.' },
    cols: { type: 'integer', minimum: MIN_COLS, maximum: MAX_COLS },
    colors: {
      type: 'object',
      required: ['A', 'B'],
      properties: { A: HEX_COLOR_SCHEMA, B: HEX_COLOR_SCHEMA },
      description: 'A = main (odd rows, background), B = pattern (even rows).',
    },
    cells: {
      type: 'array',
      minItems: MIN_ROWS,
      maxItems: MAX_ROWS,
      items: { type: 'string', pattern: '^[01]+$', minLength: MIN_COLS, maxLength: MAX_COLS },
      description:
        "Exactly `rows` strings of exactly `cols` characters. cells[0] is row 1 (the base); character j is column j + 1 from the left; '1' = the cell deviates from its row's stripe. The first and last rows contain only '0'.",
    },
  },
  description: 'Unknown keys are ignored and not stored; an exported `derived` block is ignored on import.',
} as const
