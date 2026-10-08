import { at, colCount, type Matrix } from './grid'

type Stitch = 'sc' | 'dc'

/**
 * SPEC §3.6: row r read right to left (column `cols` → 1), every row from the right side, runs
 * grouped: "Row 6: 12 sc, 1 dc, 2 sc, 1 dc and 4 sc"; a row without dc is "Row 1: 20 sc".
 */
export function rowInstruction(X: Matrix, r: number): string {
  const groups: Array<{ stitch: Stitch; count: number }> = []
  for (let c = colCount(X); c >= 1; c--) {
    const stitch: Stitch = at(X, r, c) ? 'dc' : 'sc'
    const last = groups[groups.length - 1]
    if (last?.stitch === stitch) last.count++
    else groups.push({ stitch, count: 1 })
  }
  const parts = groups.map((g) => `${g.count} ${g.stitch}`)
  const body = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `Row ${r}: ${body}`
}

/** One line per row, row 1 first (working order). */
export function instructions(X: Matrix): string[] {
  return X.map((_, i) => rowInstruction(X, i + 1))
}
