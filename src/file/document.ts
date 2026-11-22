// Local persistence / export format for filet charts, mirroring the mosaic document (src/core/document.ts).

import { FILE_MAX_COLS, FILE_MAX_ROWS, FILE_MIN, type FileChart } from './chart'

export const FILE_FORMAT = 'crochet-file-pattern'
export const FILE_VERSION = 1
export const FILE_NAME_MAX = 100

const MAX_ERRORS = 20
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
// Every Unicode control character (C0, DEL and C1).
const CONTROL_CHAR_RE = /\p{Cc}/u
// In 'u' mode only an unpaired surrogate matches Cs.
const LONE_SURROGATE_RE = /\p{Cs}/u

export interface FileDocument {
  format: typeof FILE_FORMAT
  version: 1
  name: string
  rows: number
  cols: number
  colors: { filled: string; open: string }
  /** cells[0] = row 1 (bottom); char j = column j+1; '1' fechado */
  cells: string[]
}

export type ParseFileDocumentResult = { ok: true; chart: FileChart } | { ok: false; errors: string[] }

export function toFileDocument(chart: FileChart): FileDocument {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name: chart.name,
    rows: chart.filled.length,
    cols: chart.filled[0]?.length ?? 0,
    colors: { filled: chart.colors.filled, open: chart.colors.open },
    cells: chart.filled.map((row) => row.map((v) => (v ? '1' : '0')).join('')),
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
  if (name.length === 0) return 'name: não pode ser vazio'
  if (codePointLength(name, FILE_NAME_MAX) > FILE_NAME_MAX) return `name: no máximo ${FILE_NAME_MAX} caracteres`
  if (CONTROL_CHAR_RE.test(name)) return 'name: não pode conter caracteres de controle'
  if (LONE_SURROGATE_RE.test(name)) return 'name: não pode conter caracteres inválidos (surrogates isolados)'
  return null
}

function integerError(path: string, v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v)) return `${path}: esperado um número inteiro`
  if (v < min || v > max) return `${path}: deve estar entre ${min} e ${max}`
  return null
}

function rowError(row: unknown, i: number, cols: number): string | null {
  const path = `cells[${i}]`
  if (typeof row !== 'string') return `${path}: esperado um texto`
  // Length first: the character check below then only ever scans at most FILE_MAX_COLS characters.
  if (row.length !== cols) return `${path}: esperado ${cols} caracteres, recebido ${row.length}`
  if (!/^[01]*$/.test(row)) return `${path}: só são permitidos '0' e '1'`
  return null
}

// Every field is read exactly once and the output is built from those reads, so a getter or proxy
// cannot hand the checks one value and the result another.
function parse(input: unknown): ParseFileDocumentResult {
  if (!isObject(input)) return { ok: false, errors: ['documento: esperado um objeto'] }
  const errors: string[] = []
  const { format, version, name, rows, cols, colors, cells } = input

  if (format !== FILE_FORMAT) errors.push(`format: esperado "${FILE_FORMAT}"`)
  if (version !== FILE_VERSION) errors.push(`version: versão não suportada, esperado ${FILE_VERSION}`)

  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (typeof name !== 'string') errors.push('name: esperado um texto')
  else {
    const e = nameError(trimmedName)
    if (e) errors.push(e)
  }

  const rowsError = integerError('rows', rows, FILE_MIN, FILE_MAX_ROWS)
  const colsError = integerError('cols', cols, FILE_MIN, FILE_MAX_COLS)
  if (rowsError) errors.push(rowsError)
  if (colsError) errors.push(colsError)

  const hex = { filled: '', open: '' }
  if (!isObject(colors)) errors.push('colors: esperado um objeto')
  else {
    for (const key of ['filled', 'open'] as const) {
      const v = colors[key]
      if (typeof v === 'string' && HEX_COLOR_RE.test(v)) hex[key] = v.toLowerCase()
      else errors.push(`colors.${key}: esperada uma cor hexadecimal #rrggbb`)
    }
  }

  const filled: boolean[][] = []
  if (!Array.isArray(cells)) errors.push('cells: esperada uma lista de textos')
  else if (!rowsError && cells.length !== rows) errors.push(`cells: esperadas ${rows} carreiras, recebidas ${cells.length}`)
  // Rows are only checked against valid dimensions, which also bounds this loop to FILE_MAX_ROWS. A
  // plain loop, not forEach: a hole in a sparse array must fail as a missing string, not be skipped.
  else if (!rowsError && !colsError) {
    for (let i = 0; i < (rows as number); i++) {
      const row: unknown = cells[i]
      const e = rowError(row, i, cols as number)
      if (e) errors.push(e)
      else filled.push(Array.from(row as string, (ch) => ch === '1'))
    }
  }

  if (errors.length > 0) return { ok: false, errors: errors.slice(0, MAX_ERRORS) }
  return { ok: true, chart: { name: trimmedName, filled, colors: hex } }
}

/**
 * Validates untrusted input and returns a new chart: unknown keys ignored, name trimmed, colours
 * lowercased. Error strings name the path. It never throws: anything that cannot even be read, such
 * as a throwing getter, is reported as invalid.
 */
export function parseFileDocument(input: unknown): ParseFileDocumentResult {
  try {
    return parse(input)
  } catch {
    return { ok: false, errors: ['documento: não foi possível ler'] }
  }
}
