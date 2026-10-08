import { memo, useMemo, type MouseEvent } from 'react'
import { cellYarn, conflictOutline, resolveClick, stitchNumber, stripe, YARN_LABEL, type Matrix, type View, type Yarn } from '../core'

const CELL = 22
const DRIVER = 64
const HEADER = 22

const NONE: never[] = []

interface MosaicGridProps {
  view: View
  delta: Matrix
  X: Matrix
  conflictX: Matrix
  colors: Record<Yarn, string>
  onCellClick: (r: number, c: number) => void
}

const x = (c: number) => DRIVER + (c - 1) * CELL
const y = (r: number, rows: number) => HEADER + (rows - r) * CELL

function sameRow<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const ColumnNumbers = memo(function ColumnNumbers({ cols }: { cols: number }) {
  return Array.from({ length: cols }, (_, j) => (
    <text key={j + 1} x={x(j + 1) + CELL / 2} y={HEADER - 7} textAnchor="middle" className="fill-slate-400 text-[9px]">
      {stitchNumber(j + 1, cols)}
    </text>
  ))
})

interface GridRowProps {
  r: number
  rows: number
  cols: number
  view: View
  colors: Record<Yarn, string>
  locked: boolean
  /** Visible yarn per column; only read in simulation. */
  yarns: Yarn[]
  /** dc (X) per column; only read in schematic. */
  xs: boolean[]
}

// Rows are compared by content: every click derives fresh matrices, but only the rows whose cells
// actually changed are drawn again, which keeps a 119 × 120 grid responsive.
const GridRow = memo(
  function GridRow({ r, rows, cols, view, colors, locked, yarns, xs }: GridRowProps) {
    const yarn = stripe(r)
    const top = y(r, rows)
    return (
      <g>
        <text x={24} y={top + CELL / 2 + 4} textAnchor="end" className="fill-slate-500 text-[11px] tabular-nums">
          {r}
        </text>
        <rect x={30} y={top + 5} width={12} height={12} rx={3} fill={colors[yarn]} stroke="#94a3b8" />
        <text x={46} y={top + CELL / 2 + 4} className="fill-slate-600 text-[11px] font-semibold">
          {YARN_LABEL[yarn]}
        </text>

        {Array.from({ length: cols }, (_, j) => (
          <rect
            key={j + 1}
            data-r={r}
            data-c={j + 1}
            x={x(j + 1)}
            y={top}
            width={CELL}
            height={CELL}
            fill={view === 'schematic' ? '#ffffff' : colors[yarns[j]]}
            stroke="#94a3b8"
            strokeOpacity={0.6}
            className={locked ? 'cursor-not-allowed' : 'cursor-pointer hover:opacity-75'}
          />
        ))}

        {view === 'schematic' &&
          xs.map(
            (on, j) =>
              on && (
                <path
                  key={j + 1}
                  d={`M${x(j + 1) + 6} ${top + 6}L${x(j + 1) + CELL - 6} ${top + CELL - 6}M${x(j + 1) + CELL - 6} ${top + 6}L${x(j + 1) + 6} ${top + CELL - 6}`}
                  stroke="#0f172a"
                  strokeWidth={2}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              ),
          )}

        {locked && <rect x={x(1)} y={top} width={cols * CELL} height={CELL} fill="url(#locked-row)" opacity={0.12} pointerEvents="none" />}
      </g>
    )
  },
  (a, b) =>
    a.r === b.r &&
    a.rows === b.rows &&
    a.cols === b.cols &&
    a.view === b.view &&
    a.colors === b.colors &&
    a.locked === b.locked &&
    sameRow(a.yarns, b.yarns) &&
    sameRow(a.xs, b.xs),
)

const OutlineRow = memo(
  function OutlineRow({ r, rows, cells }: { r: number; rows: number; cells: boolean[] }) {
    return cells.map(
      (on, j) =>
        on && (
          <rect
            key={j + 1}
            x={x(j + 1) + 1}
            y={y(r, rows) + 1}
            width={CELL - 2}
            height={CELL - 2}
            fill="none"
            stroke="#dc2626"
            strokeWidth={2.5}
            pointerEvents="none"
          />
        ),
    )
  },
  (a, b) => a.r === b.r && a.rows === b.rows && sameRow(a.cells, b.cells),
)

/**
 * The editable chart. Row 1 is drawn at the bottom; the left column is the row driver (row number
 * and the yarn that row is worked in). One click handler on the <svg> reads the cell's data-r/data-c.
 */
export function MosaicGrid({ view, delta, X, conflictX, colors, onCellClick }: MosaicGridProps) {
  const rows = delta.length
  const cols = delta[0].length
  const rowList = Array.from({ length: rows }, (_, i) => rows - i)

  const yarns = useMemo(() => delta.map((row, i) => row.map((_, j) => cellYarn(delta, i + 1, j + 1))), [delta])
  const outline = useMemo(() => conflictOutline(view, conflictX), [view, conflictX])

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

      <ColumnNumbers cols={cols} />

      {rowList.map((r) => (
        <GridRow
          key={r}
          r={r}
          rows={rows}
          cols={cols}
          view={view}
          colors={colors}
          locked={!resolveClick(view, r, 1, rows).ok}
          // The other view's data is left out so a change it cannot show does not redraw the row.
          yarns={view === 'simulation' ? yarns[r - 1] : NONE}
          xs={view === 'schematic' ? X[r - 1] : NONE}
        />
      ))}

      {rowList.map((r) => (
        <OutlineRow key={r} r={r} rows={rows} cells={outline[r - 1]} />
      ))}
    </svg>
  )
}
