import { ArrowLeftRight, Download, Eye, Grid3x3, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { COL_OPTIONS, ROW_OPTIONS, YARN_LABEL, type View, type Yarn } from '../core'

interface ToolbarProps {
  view: View
  onViewChange: (view: View) => void
  rows: number
  cols: number
  onResize: (rows: number, cols: number) => void
  colors: Record<Yarn, string>
  onColorChange: (yarn: Yarn, color: string) => void
  onSwapColors: () => void
  onClear: () => void
  onDownloadCsv: () => void
}

const button =
  'inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50'

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm font-medium ${
        active ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

export function Toolbar(props: ToolbarProps) {
  const { view, onViewChange, rows, cols, onResize, colors, onColorChange } = props
  const yarns: Yarn[] = ['main', 'pattern']

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl bg-white p-3 shadow-sm">
      <div className="inline-flex rounded-md bg-slate-100 p-0.5" role="group" aria-label="View">
        <ViewButton active={view === 'simulation'} onClick={() => onViewChange('simulation')}>
          <Eye size={16} /> Simulation
        </ViewButton>
        <ViewButton active={view === 'schematic'} onClick={() => onViewChange('schematic')}>
          <Grid3x3 size={16} /> Schematic
        </ViewButton>
      </div>

      <div className="flex items-center gap-3 text-sm text-slate-600">
        <label className="flex items-center gap-1.5">
          Rows
          <select
            value={rows}
            onChange={(e) => onResize(Number(e.target.value), cols)}
            className="rounded border border-slate-300 bg-white px-1.5 py-1"
          >
            {ROW_OPTIONS.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Stitches
          <select
            value={cols}
            onChange={(e) => onResize(rows, Number(e.target.value))}
            className="rounded border border-slate-300 bg-white px-1.5 py-1"
          >
            {COL_OPTIONS.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3 text-sm text-slate-600">
        {yarns.map((yarn) => (
          <label key={yarn} className="flex items-center gap-1.5" title={yarn === 'main' ? 'Odd rows (background)' : 'Even rows (pattern)'}>
            <input
              type="color"
              value={colors[yarn]}
              onChange={(e) => onColorChange(yarn, e.target.value)}
              className="h-7 w-9 cursor-pointer rounded border border-slate-300 bg-white"
            />
            Color {YARN_LABEL[yarn]}
          </label>
        ))}
      </div>

      <div className="ml-auto flex flex-wrap gap-2">
        <button type="button" className={button} onClick={props.onSwapColors} title="Swap colors A and B">
          <ArrowLeftRight size={16} /> Invert
        </button>
        <button type="button" className={button} onClick={props.onClear}>
          <Trash2 size={16} /> Clear
        </button>
        <button type="button" className={button} onClick={props.onDownloadCsv}>
          <Download size={16} /> CSV
        </button>
      </div>
    </div>
  )
}
