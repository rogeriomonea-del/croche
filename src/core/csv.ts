import { colCount, stitchNumber, type Matrix } from './grid'
import { stripe, YARN_LABEL } from './stripe'

/**
 * The X chart as CSV, 1 = dc (X) and 0 = sc, laid out as the chart is drawn: top row first,
 * columns left to right under their stitch numbers. Plain RFC 4180 with CRLF line endings: Excel is
 * no longer a target, so there is no `sep=` line (SPEC §9).
 */
export function toCsv(X: Matrix): string {
  const cols = colCount(X)
  const header = ['Row', 'Yarn', ...X[0].map((_, j) => stitchNumber(j + 1, cols))]
  const lines = [header.join(',')]
  for (let r = X.length; r >= 1; r--) {
    lines.push([r, YARN_LABEL[stripe(r)], ...X[r - 1].map((x) => (x ? 1 : 0))].join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
