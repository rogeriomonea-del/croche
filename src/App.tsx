import { CircleCheck, Lock, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useReducer, useState } from 'react'
import { InstructionsPanel } from './components/InstructionsPanel'
import { MosaicGrid } from './components/MosaicGrid'
import { Toolbar } from './components/Toolbar'
import { cellsOf, conflicts, deriveX, instructions, resolveClick, toCsv, type BlockedReason, type View } from './core'
import { designReducer, initialDesign } from './state/design'

const HINT: Record<View, string> = {
  simulation: 'Click a cell to swap its color. The dc that makes it is placed for you on the row above.',
  schematic: 'Click a cell to place or remove an X (dc). It drops two rows down and covers the cell below it.',
}

function blockedMessage(reason: BlockedReason, r: number): string {
  switch (reason) {
    case 'base-row':
      return 'Row 1 is the base row: there is no row below it for a dc to drop into, so it keeps its color.'
    case 'top-row':
      return `Row ${r} is the top row: no row above it can work the dc that would cover this cell.`
    case 'no-anchor':
      return `A dc on row ${r} would drop into row ${r - 2}, which does not exist. The first dc goes on row 3.`
  }
}

export default function App() {
  const [design, dispatch] = useReducer(designReducer, initialDesign)
  const [view, setView] = useState<View>('simulation')
  const [notice, setNotice] = useState<string | null>(null)

  const rows = design.delta.length
  const cols = design.delta[0].length
  const X = useMemo(() => deriveX(design.delta), [design.delta])
  const conflictX = useMemo(() => conflicts(X), [X])
  const lines = useMemo(() => instructions(X), [X])
  const conflictCells = useMemo(() => cellsOf(conflictX), [conflictX])
  const conflictRows = useMemo(() => new Set(conflictCells.map(([r]) => r)), [conflictCells])

  /**
   * The only way the drawing changes from the grid. The state holds one fact per cell: does it
   * deviate from its row's stripe? Colour and X are both derived from it, so they can never
   * disagree. resolveClick turns the click into that cell (the cell itself in simulation, the
   * cell under the X in schematic) or refuses it when no dc could exist there.
   */
  const handleCellClick = useCallback(
    (r: number, c: number) => {
      const target = resolveClick(view, r, c, rows)
      if (!target.ok) {
        setNotice(blockedMessage(target.reason, r))
        return
      }
      setNotice(null)
      dispatch({ type: 'toggle', r: target.r, c: target.c })
    },
    [view, rows],
  )

  const handleClear = () => {
    if (cellsOf(design.delta).length > 0 && !window.confirm('Clear the whole grid? This cannot be undone.')) return
    dispatch({ type: 'clear' })
    setNotice(null)
  }

  const handleDownloadCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(X)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `mosaic-${rows}x${cols}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-semibold">Mosaic Crochet Architect</h1>
        <p className="text-xs text-slate-500">Overlay mosaic crochet · rows alternate color A and B · row 1 at the bottom</p>
      </header>

      <main className="mx-auto max-w-7xl space-y-3 p-4">
        <Toolbar
          view={view}
          onViewChange={setView}
          rows={rows}
          cols={cols}
          onResize={(r, c) => dispatch({ type: 'resize', rows: r, cols: c })}
          colors={design.colors}
          onColorChange={(yarn, color) => dispatch({ type: 'setColor', yarn, color })}
          onSwapColors={() => dispatch({ type: 'swapColors' })}
          onClear={handleClear}
          onDownloadCsv={handleDownloadCsv}
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-live="polite">
          <span className="text-slate-500">{HINT[view]}</span>
          {conflictCells.length > 0 ? (
            <span className="inline-flex items-center gap-1 font-medium text-red-600">
              <TriangleAlert size={15} /> {conflictCells.length} dc in conflict: dc on consecutive rows of the same column
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <CircleCheck size={15} /> No conflicts
            </span>
          )}
          {notice && (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <Lock size={15} /> {notice}
            </span>
          )}
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="overflow-auto rounded-xl bg-white p-3 shadow-sm">
            <MosaicGrid
              view={view}
              delta={design.delta}
              X={X}
              conflictX={conflictX}
              colors={design.colors}
              onCellClick={handleCellClick}
            />
          </section>
          <InstructionsPanel lines={lines} conflictRows={conflictRows} />
        </div>
      </main>
    </div>
  )
}
