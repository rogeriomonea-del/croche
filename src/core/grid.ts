/**
 * Boolean matrix indexed `m[r - 1][c - 1]`; every public function takes 1-based (r, c).
 * Row 1 is the base row (bottom), column 1 is the left edge (SPEC §2).
 */
export type Matrix = boolean[][]

export const MIN_ROWS = 5
export const MAX_ROWS = 51
export const MIN_COLS = 5
export const MAX_COLS = 50

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

/** Rows are odd so the piece starts and ends in `main` (SPEC §2, §3.1). */
export const ROW_OPTIONS = range(MIN_ROWS, MAX_ROWS).filter((n) => n % 2 === 1)
export const COL_OPTIONS = range(MIN_COLS, MAX_COLS)

export function emptyMatrix(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false))
}

export function colCount(m: Matrix): number {
  return m[0]?.length ?? 0
}

/** Cell (r, c); anything outside the grid reads as false. */
export function at(m: Matrix, r: number, c: number): boolean {
  return m[r - 1]?.[c - 1] ?? false
}

/** Every true cell as [r, c], by row then column. */
export function cellsOf(m: Matrix): Array<[number, number]> {
  return m.flatMap((row, i) => row.flatMap((v, j): Array<[number, number]> => (v ? [[i + 1, j + 1]] : [])))
}

/**
 * Chart header label of column c. Rows are worked right to left, so stitch 1 is column `cols`;
 * the drawing itself is not mirrored (SPEC §3.6).
 */
export function stitchNumber(c: number, cols: number): number {
  return cols - c + 1
}
