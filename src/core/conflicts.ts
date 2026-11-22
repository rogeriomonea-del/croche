import { at, type Matrix } from './grid'

/** SPEC §3.4: a dc with another dc directly below or above it in the same column. */
export function conflicts(X: Matrix): Matrix {
  return X.map((row, i) => {
    const r = i + 1
    return row.map((x, j) => x && (at(X, r - 1, j + 1) || at(X, r + 1, j + 1)))
  })
}
