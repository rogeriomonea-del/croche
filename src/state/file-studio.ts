// Filet studio state: the chart with its undo history, the studio mode, the reading options and the
// crocheting progress. Pure reducer plus a defensive localStorage round trip.

import {
  DEFAULT_FILE_NAME,
  DEFAULT_READING,
  FILE_NAME_MAX,
  emptyFileChart,
  fileCols,
  fileRows,
  paintFileCell,
  parseFileDocument,
  resizeFileChart,
  rowReading,
  toFileDocument,
  type FileChart,
  type ReadingOptions,
  type Side,
} from '../file'

export type StudioMode = 'editar' | 'tecer'

export interface FileProgress {
  /** Selected row, 1-based (row 1 = bottom). */
  row: number
  /** Index of the current segment of the selected row, 0-based. */
  segment: number
  /** Rows marked as crocheted, ascending, unique. */
  doneRows: number[]
}

export interface FileStudioState {
  chart: FileChart
  past: FileChart[]
  future: FileChart[]
  inStroke: boolean
  strokeRecorded: boolean
  /** The last recorded edit when a run of events refines it (typing the name, dragging a colour). */
  refining: string | null
  mode: StudioMode
  reading: ReadingOptions
  progress: FileProgress
  /** "Ler em voz alta ao avançar": read each new segment aloud while crocheting. */
  autoRead: boolean
}

export type FileStudioAction =
  | { type: 'strokeStart' }
  | { type: 'strokeEnd' }
  | { type: 'paint'; r: number; c: number; filled: boolean }
  | { type: 'toggle'; r: number; c: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'rename'; name: string }
  | { type: 'setColor'; key: 'filled' | 'open'; value: string }
  | { type: 'resize'; rows: number; cols: number }
  | { type: 'replaceChart'; chart: FileChart }
  | { type: 'setMode'; mode: StudioMode }
  | { type: 'setReading'; turning?: boolean; firstRowFrom?: Side }
  | { type: 'selectRow'; row: number }
  | { type: 'moveRow'; delta: number }
  | { type: 'selectSegment'; segment: number }
  | { type: 'moveSegment'; delta: number }
  | { type: 'toggleDone'; row: number }
  | { type: 'setAutoRead'; on: boolean }

export const HISTORY_LIMIT = 100
export const START_ROWS = 10
export const START_COLS = 20
export const STORAGE_KEY = 'crochet-victorioso:file-studio:v1'
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/

export function initialFileStudio(chart: FileChart = emptyFileChart(START_ROWS, START_COLS)): FileStudioState {
  return {
    chart,
    past: [],
    future: [],
    inStroke: false,
    strokeRecorded: false,
    refining: null,
    mode: 'editar',
    reading: { ...DEFAULT_READING },
    progress: { row: 1, segment: 0, doneRows: [] },
    autoRead: false,
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

function segmentCount(chart: FileChart, row: number, reading: ReadingOptions): number {
  return rowReading(chart, row, reading).segments.length
}

/** Keeps the progress valid for this chart and reading. */
function fitProgress(progress: FileProgress, chart: FileChart, reading: ReadingOptions): FileProgress {
  const rows = fileRows(chart)
  const row = clampInt(progress.row, 1, rows)
  const segment = clampInt(progress.segment, 0, segmentCount(chart, row, reading) - 1)
  const doneRows = progress.doneRows.filter((r) => r <= rows)
  if (row === progress.row && segment === progress.segment && doneRows.length === progress.doneRows.length) return progress
  return { row, segment, doneRows }
}

/** Records `chart` as the new present; `refining` names an edit that later events of the same kind extend. */
function commit(state: FileStudioState, chart: FileChart, refining: string | null = null): FileStudioState {
  if (chart === state.chart) return state
  const extend = (state.inStroke && state.strokeRecorded) || (refining !== null && state.refining === refining)
  const past = extend ? state.past : [...state.past, state.chart].slice(-HISTORY_LIMIT)
  return {
    ...state,
    chart,
    past,
    future: [],
    strokeRecorded: state.inStroke ? true : state.strokeRecorded,
    refining,
    progress: fitProgress(state.progress, chart, state.reading),
  }
}

function inside(chart: FileChart, r: number, c: number): boolean {
  return Number.isInteger(r) && Number.isInteger(c) && r >= 1 && c >= 1 && r <= fileRows(chart) && c <= fileCols(chart)
}

export function fileStudioReducer(state: FileStudioState, action: FileStudioAction): FileStudioState {
  switch (action.type) {
    case 'strokeStart':
      return { ...state, inStroke: true, strokeRecorded: false, refining: null }
    case 'strokeEnd':
      return { ...state, inStroke: false, strokeRecorded: false, refining: null }
    case 'paint':
      if (!inside(state.chart, action.r, action.c)) return state
      return commit(state, paintFileCell(state.chart, action.r, action.c, action.filled))
    case 'toggle':
      if (!inside(state.chart, action.r, action.c)) return state
      return commit(state, paintFileCell(state.chart, action.r, action.c, !state.chart.filled[action.r - 1][action.c - 1]))
    case 'undo': {
      if (!state.past.length) return state
      const chart = state.past[state.past.length - 1]
      return {
        ...state,
        chart,
        past: state.past.slice(0, -1),
        future: [state.chart, ...state.future],
        inStroke: false,
        strokeRecorded: false,
        refining: null,
        progress: fitProgress(state.progress, chart, state.reading),
      }
    }
    case 'redo': {
      if (!state.future.length) return state
      const chart = state.future[0]
      return {
        ...state,
        chart,
        past: [...state.past, state.chart].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        inStroke: false,
        strokeRecorded: false,
        refining: null,
        progress: fitProgress(state.progress, chart, state.reading),
      }
    }
    case 'rename':
      if (action.name === state.chart.name) return state
      return commit(state, { ...state.chart, name: action.name }, 'rename')
    case 'setColor': {
      const value = action.value.toLowerCase()
      if (!HEX_COLOR_RE.test(value) || state.chart.colors[action.key] === value) return state
      return commit(state, { ...state.chart, colors: { ...state.chart.colors, [action.key]: value } }, `color:${action.key}`)
    }
    case 'resize': {
      const { rows, cols } = action
      const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 200
      if (!valid(rows) || !valid(cols)) return state
      if (rows === fileRows(state.chart) && cols === fileCols(state.chart)) return state
      return commit(state, resizeFileChart(state.chart, rows, cols))
    }
    case 'replaceChart': {
      const next = commit({ ...state, inStroke: false, strokeRecorded: false, refining: null }, action.chart)
      return { ...next, progress: { row: 1, segment: 0, doneRows: [] } }
    }
    case 'setMode':
      if (state.mode === action.mode) return state
      return { ...state, mode: action.mode, inStroke: false, strokeRecorded: false, refining: null }
    case 'setReading': {
      const reading: ReadingOptions = {
        turning: action.turning ?? state.reading.turning,
        firstRowFrom: action.firstRowFrom ?? state.reading.firstRowFrom,
      }
      if (reading.turning === state.reading.turning && reading.firstRowFrom === state.reading.firstRowFrom) return state
      // The segments of a row change with its direction: start the row over.
      return { ...state, reading, progress: fitProgress({ ...state.progress, segment: 0 }, state.chart, reading) }
    }
    case 'selectRow': {
      const row = clampInt(action.row, 1, fileRows(state.chart))
      if (row === state.progress.row && state.progress.segment === 0) return state
      return { ...state, progress: { ...state.progress, row, segment: 0 } }
    }
    case 'moveRow': {
      const row = clampInt(state.progress.row + action.delta, 1, fileRows(state.chart))
      if (row === state.progress.row) return state
      return { ...state, progress: { ...state.progress, row, segment: 0 } }
    }
    case 'selectSegment': {
      const last = segmentCount(state.chart, state.progress.row, state.reading) - 1
      const segment = clampInt(action.segment, 0, last)
      if (segment === state.progress.segment) return state
      return { ...state, progress: { ...state.progress, segment } }
    }
    case 'moveSegment': {
      // Past the last segment the next row begins; before the first, the previous row's last segment.
      const { row, segment } = state.progress
      const rows = fileRows(state.chart)
      const target = segment + action.delta
      const count = segmentCount(state.chart, row, state.reading)
      if (target >= 0 && target < count) return { ...state, progress: { ...state.progress, segment: target } }
      if (target >= count) {
        if (row >= rows) return state
        return { ...state, progress: { ...state.progress, row: row + 1, segment: 0 } }
      }
      if (row <= 1) return state
      const previous = segmentCount(state.chart, row - 1, state.reading)
      return { ...state, progress: { ...state.progress, row: row - 1, segment: previous - 1 } }
    }
    case 'toggleDone': {
      if (!Number.isInteger(action.row) || action.row < 1 || action.row > fileRows(state.chart)) return state
      const done = state.progress.doneRows
      const doneRows = done.includes(action.row)
        ? done.filter((r) => r !== action.row)
        : [...done, action.row].sort((a, b) => a - b)
      return { ...state, progress: { ...state.progress, doneRows } }
    }
    case 'setAutoRead':
      if (state.autoRead === action.on) return state
      return { ...state, autoRead: action.on }
  }
}

// ---------------------------------------------------------------------------------------------
// Persistence

interface StoredStudio {
  version: 1
  document: unknown
  mode: StudioMode
  reading: ReadingOptions
  progress: FileProgress
  /** Added after the first release: missing in older saves, read as off. */
  autoRead?: boolean
}

/** A name the document format accepts: no control characters, trimmed, at most 100 characters, never empty. */
export function documentName(name: string): string {
  const clean = [...name.replace(/[\p{Cc}\p{Cs}]/gu, '').trim()].slice(0, FILE_NAME_MAX).join('').trim()
  return clean || DEFAULT_FILE_NAME
}

/** The chart as an exportable document (the name made valid for the format). */
export function exportableDocument(chart: FileChart) {
  return toFileDocument({ ...chart, name: documentName(chart.name) })
}

export function serializeFileStudio(state: FileStudioState): string {
  const stored: StoredStudio = {
    version: 1,
    document: exportableDocument(state.chart),
    mode: state.mode,
    reading: state.reading,
    progress: state.progress,
    autoRead: state.autoRead,
  }
  return JSON.stringify(stored)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The stored studio, or null when the text is missing or not a valid saved studio. Never throws. */
export function deserializeFileStudio(text: string | null): FileStudioState | null {
  if (!text) return null
  try {
    const data: unknown = JSON.parse(text)
    if (!isRecord(data) || data.version !== 1) return null
    const parsed = parseFileDocument(data.document)
    if (!parsed.ok) return null
    const chart = parsed.chart
    const state = initialFileStudio(chart)
    const mode: StudioMode = data.mode === 'tecer' ? 'tecer' : 'editar'
    const reading: ReadingOptions = { ...DEFAULT_READING }
    if (isRecord(data.reading)) {
      if (typeof data.reading.turning === 'boolean') reading.turning = data.reading.turning
      if (data.reading.firstRowFrom === 'left' || data.reading.firstRowFrom === 'right') reading.firstRowFrom = data.reading.firstRowFrom
    }
    let progress: FileProgress = { row: 1, segment: 0, doneRows: [] }
    if (isRecord(data.progress)) {
      const p = data.progress
      const rows = fileRows(chart)
      const done = Array.isArray(p.doneRows)
        ? [...new Set(p.doneRows.filter((r): r is number => Number.isInteger(r) && r >= 1 && r <= rows))].sort((a, b) => a - b)
        : []
      progress = {
        row: typeof p.row === 'number' ? p.row : 1,
        segment: typeof p.segment === 'number' ? p.segment : 0,
        doneRows: done,
      }
    }
    const autoRead = data.autoRead === true
    return { ...state, mode, reading, progress: fitProgress(progress, chart, reading), autoRead }
  } catch {
    return null
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function loadFileStudio(storage: StorageLike | null | undefined): FileStudioState {
  try {
    return deserializeFileStudio(storage?.getItem(STORAGE_KEY) ?? null) ?? initialFileStudio()
  } catch {
    return initialFileStudio()
  }
}

/** Saves; returns false when storage is unavailable or full. */
export function saveFileStudio(storage: StorageLike | null | undefined, state: FileStudioState): boolean {
  try {
    if (!storage) return false
    storage.setItem(STORAGE_KEY, serializeFileStudio(state))
    return true
  } catch {
    return false
  }
}
