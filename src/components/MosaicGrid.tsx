import type { MouseEvent } from 'react'
import { at, cellYarn, resolveClick, stitchNumber, stripe, YARN_LABEL, type Matrix, type View, type Yarn } from '../core'

const CELL = 22
const DRIVER = 64
const HEADER = 22

interface MosaicGridProps {
  view: View
  delta: Matrix
  X: Matrix
  conflictX: Matrix
  colors: Record<Yarn, string>
  onCellClick: (r: number, c: number) => void
}

/**
 * The editable chart. Row 1 is drawn at the bottom; the left column is the row driver (row number
 * and the yarn that row is worked in). One click handler on the <svg> reads the cell's data-r/data-c.
 */
export function MosaicGrid({ view, delta, X, conflictX, colors, onCellClick }: MosaicGridProps) {
  const rows = delta.length
  const cols = delta[0].length
  const x = (c: number) => DRIVER + (c - 1) * CELL
  const y = (r: number) => HEADER + (rows - r) * CELL
  const rowList = Array.from({ length: rows }, (_, i) => rows - i)
  const colList = Array.from({ length: cols }, (_, j) => j + 1)

  // A conflict belongs to the dc (X) cells. In simulation the user sees the cells those dc cover,
  // one row lower, so the outline moves down with them.
  const inConflict = (r: number, c: number) => (view === 'schematic' ? at(conflictX, r, c) : at(conflictX, r + 1, c))

  const handleClick = (e: MouseEvent<SVGSVGElement>) => {
    const cell = (e.target as Element).closest('[data-r]')
    if (cell) onCellClick(Number(cell.getAttribute('data-r')), Number(cell.getAttribute('data-c')))
  }

  return (
    <svg
      width={DRIVER + cols * CELL}
      height={HEADER + rows * CELL}
      className="select-none"
      onClick={handleClick}
      role="img"
      aria-label={`${view === 'schematic' ? 'Schematic' : 'Simulated'} mosaic chart, ${rows} rows by ${cols} stitches`}
    >
      <defs>
        <pattern id="locked-row" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#0f172a" strokeWidth="2" />
        </pattern>
      </defs>

      {colList.map((c) => (
        <text key={c} x={x(c) + CELL / 2} y={HEADER - 7} textAnchor="middle" className="fill-slate-400 text-[9px]">
          {stitchNumber(c, cols)}
        </text>
      ))}

      {rowList.map((r) => {
        const yarn = stripe(r)
        const locked = !resolveClick(view, r, 1, rows).ok
        return (
          <g key={r}>
            <text x={24} y={y(r) + CELL / 2 + 4} textAnchor="end" className="fill-slate-500 text-[11px] tabular-nums">
              {r}
            </text>
            <rect x={30} y={y(r) + 5} width={12} height={12} rx={3} fill={colors[yarn]} stroke="#94a3b8" />
            <text x={46} y={y(r) + CELL / 2 + 4} className="fill-slate-600 text-[11px] font-semibold">
              {YARN_LABEL[yarn]}
            </text>

            {colList.map((c) => (
              <rect
                key={c}
                data-r={r}
                data-c={c}
                x={x(c)}
                y={y(r)}
                width={CELL}
                height={CELL}
                fill={view === 'schematic' ? '#ffffff' : colors[cellYarn(delta, r, c)]}
                stroke="#94a3b8"
                strokeOpacity={0.6}
                className={locked ? 'cursor-not-allowed' : 'cursor-pointer hover:opacity-75'}
              />
            ))}

            {view === 'schematic' &&
              colList
                .filter((c) => at(X, r, c))
                .map((c) => (
                  <path
                    key={c}
                    d={`M${x(c) + 6} ${y(r) + 6}L${x(c) + CELL - 6} ${y(r) + CELL - 6}M${x(c) + CELL - 6} ${y(r) + 6}L${x(c) + 6} ${y(r) + CELL - 6}`}
                    stroke="#0f172a"
                    strokeWidth={2}
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                ))}

            {locked && (
              <rect x={x(1)} y={y(r)} width={cols * CELL} height={CELL} fill="url(#locked-row)" opacity={0.12} pointerEvents="none" />
            )}
          </g>
        )
      })}

      {rowList.flatMap((r) =>
        colList
          .filter((c) => inConflict(r, c))
          .map((c) => (
            <rect
              key={`${r}-${c}`}
              x={x(c) + 1}
              y={y(r) + 1}
              width={CELL - 2}
              height={CELL - 2}
              fill="none"
              stroke="#dc2626"
              strokeWidth={2.5}
              pointerEvents="none"
            />
          )),
      )}
    </svg>
  )
}
