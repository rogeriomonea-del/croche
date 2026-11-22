import { at, type Matrix } from './grid'

/**
 * SPEC §3.3: X[r+1][c] = delta[r][c]. The dc of row r+1 drops into the front loop of row r-1 and
 * covers (r, c) with the colour of r+1. Row 1 never holds a dc, and a deviation on the top row has
 * no row above to produce one (§3.5), so it falls off the grid.
 */
export function deriveX(delta: Matrix): Matrix {
  return delta.map((row, i) => row.map((_, j) => at(delta, i, j + 1)))
}
