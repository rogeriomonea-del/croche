import { TriangleAlert } from 'lucide-react'

interface InstructionsPanelProps {
  lines: string[]
  conflictRows: Set<number>
}

export function InstructionsPanel({ lines, conflictRows }: InstructionsPanelProps) {
  return (
    <aside className="rounded-xl bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800">Written instructions</h2>
      <p className="mt-0.5 text-xs text-slate-500">Every row from the right side, read right to left.</p>
      <ol className="mt-3 max-h-[70vh] space-y-1 overflow-auto font-mono text-[13px] text-slate-700">
        {lines.map((line, i) => (
          <li key={i} className={conflictRows.has(i + 1) ? 'flex items-center gap-1 text-red-600' : ''}>
            {conflictRows.has(i + 1) && <TriangleAlert size={13} className="shrink-0" aria-label="conflict" />}
            {line}
          </li>
        ))}
      </ol>
    </aside>
  )
}
