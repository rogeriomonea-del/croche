// Filet crochet ("crochê filé") chart model. Each square is either fechado (a filled block) or
// aberto (open mesh); no mosaic rule applies, any square can be either.

export const FILE_MIN = 1
export const FILE_MAX_ROWS = 200
export const FILE_MAX_COLS = 200

export const DEFAULT_FILE_NAME = 'Gráfico filé'
export const DEFAULT_FILE_COLORS: { filled: string; open: string } = { filled: '#2b2b2b', open: '#ffffff' }

export interface FileChart {
  name: string
  /** filled[r-1][c-1]: true = fechado. Row 1 = bottom (worked first); column 1 = left. */
  filled: boolean[][]
  colors: { filled: string; open: string } // '#rrggbb'
}

function checkSize(rows: number, cols: number): void {
  if (!Number.isInteger(rows) || rows < FILE_MIN || rows > FILE_MAX_ROWS) {
    throw new RangeError(`rows must be an integer between ${FILE_MIN} and ${FILE_MAX_ROWS}, got ${rows}`)
  }
  if (!Number.isInteger(cols) || cols < FILE_MIN || cols > FILE_MAX_COLS) {
    throw new RangeError(`cols must be an integer between ${FILE_MIN} and ${FILE_MAX_COLS}, got ${cols}`)
  }
}

export function checkFileCell(chart: FileChart, r: number, c: number): void {
  const rows = fileRows(chart)
  const cols = fileCols(chart)
  if (!Number.isInteger(r) || r < 1 || r > rows) throw new RangeError(`row ${r} is outside 1..${rows}`)
  if (!Number.isInteger(c) || c < 1 || c > cols) throw new RangeError(`column ${c} is outside 1..${cols}`)
}

export function emptyFileChart(rows: number, cols: number, name: string = DEFAULT_FILE_NAME): FileChart {
  checkSize(rows, cols)
  return {
    name,
    filled: Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false)),
    colors: { ...DEFAULT_FILE_COLORS },
  }
}

export function fileRows(chart: FileChart): number {
  return chart.filled.length
}

export function fileCols(chart: FileChart): number {
  return chart.filled[0]?.length ?? 0
}

/** Build from an analysis matrix whose row 0 is the TOP of the picture (vision output). invert swaps fechado/aberto. */
export function fileChartFromTopFirst(
  topFirst: boolean[][],
  options: { name: string; colors: { filled: string; open: string }; invert?: boolean },
): FileChart {
  const rows = topFirst.length
  const cols = topFirst[0]?.length ?? 0
  checkSize(rows, cols)
  if (topFirst.some((row) => row.length !== cols)) throw new RangeError('every row must have the same length')
  const invert = options.invert === true
  return {
    name: options.name,
    // Row 1 is the bottom of the picture, i.e. the last row of the top-first matrix.
    filled: topFirst.map((row) => row.map((v) => v !== invert)).reverse(),
    colors: { filled: options.colors.filled, open: options.colors.open },
  }
}

/** Sets one square; returns the same chart object when the square already has that state. */
export function paintFileCell(chart: FileChart, r: number, c: number, filled: boolean): FileChart {
  checkFileCell(chart, r, c)
  if (chart.filled[r - 1][c - 1] === filled) return chart
  // Only the touched row is copied; the other rows are shared with the previous chart.
  const rowsCopy = chart.filled.slice()
  const row = rowsCopy[r - 1].slice()
  row[c - 1] = filled
  rowsCopy[r - 1] = row
  return { ...chart, filled: rowsCopy }
}

export function toggleFileCell(chart: FileChart, r: number, c: number): FileChart {
  checkFileCell(chart, r, c)
  return paintFileCell(chart, r, c, !chart.filled[r - 1][c - 1])
}

/**
 * Keeps the content anchored at the bottom-left (row 1, column 1): shrinking drops rows from the top
 * and columns from the right; growing adds aberto squares there.
 */
export function resizeFileChart(chart: FileChart, rows: number, cols: number): FileChart {
  checkSize(rows, cols)
  const filled = Array.from({ length: rows }, (_, i) => {
    const old = chart.filled[i]
    return Array.from({ length: cols }, (_, j) => old?.[j] === true)
  })
  return { ...chart, filled }
}
