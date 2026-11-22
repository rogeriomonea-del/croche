// Orientation fixes for an imported chart picture: some screenshots arrive upside down, some charts
// are drawn mirrored. Works on any analysis matrix whose row 0 is the TOP of the picture.

export interface ChartOrientation {
  /** Turn the picture half a turn: the last row comes first and every row is read backwards. */
  rotate180: boolean
  /** Mirror left and right: every row is read backwards. */
  mirror: boolean
}

export const NO_ORIENTATION: ChartOrientation = { rotate180: false, mirror: false }

/**
 * A new matrix with the orientation applied (rotate 180° = reverse the rows and each row;
 * mirror = reverse each row). Both together flip it top to bottom. Never mutates the input.
 */
export function orientMatrix<T>(topFirst: readonly (readonly T[])[], orientation: Partial<ChartOrientation>): T[][] {
  const rotate = orientation.rotate180 === true
  const reverseEachRow = rotate !== (orientation.mirror === true)
  const rows = topFirst.map((row) => (reverseEachRow ? row.slice().reverse() : row.slice()))
  return rotate ? rows.reverse() : rows
}
