import { at, type Matrix } from './grid'

/**
 * A cell can show the other colour only when a dc from row r+1 can drop into the front loop of
 * row r-1 and cover it. The base row has no r-1 and the top row has no r+1, so both are locked
 * (SPEC §3.5, §4).
 */
export function canToggle(r: number, rows: number): boolean {
  return r > 1 && r < rows
}

/** SPEC §3.2: flips (r, c) relative to its stripe. A locked row returns `delta` unchanged. */
export function toggle(delta: Matrix, r: number, c: number): Matrix {
  if (!canToggle(r, delta.length)) return delta
  return delta.map((row, i) => (i === r - 1 ? row.map((v, j) => (j === c - 1 ? !v : v)) : row))
}

/**
 * SPEC §4: resizing keeps the drawing, anchored at row 1 (bottom) and column 1 (left). Cells past
 * the new edge are dropped and new cells start on their stripe. A deviation that ends up on the new
 * top row is dropped as well: no dc can make it there.
 */
export function resize(delta: Matrix, rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => canToggle(i + 1, rows) && at(delta, i + 1, j + 1)),
  )
}
