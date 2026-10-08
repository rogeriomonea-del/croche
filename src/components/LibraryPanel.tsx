import { ChevronDown, FolderOpen, Library, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { formatUpdated } from '../lib/format'
import type { PatternSummary } from '../shared/api'

interface LibraryPanelProps {
  /** null until the first list arrives. */
  patterns: PatternSummary[] | null
  error: string | null
  currentId: string | null
  /** The pattern being opened or deleted, if any. */
  busyId: string | null
  onOpen: (pattern: PatternSummary) => void
  onDelete: (pattern: PatternSummary) => void
  onNew: () => void
  onRetry: () => void
  className?: string
}

const iconButton = 'rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-40'

export function LibraryPanel(props: LibraryPanelProps) {
  const { patterns, error, currentId, busyId, onOpen, onDelete } = props
  // Folded by default on small screens, where it sits above the grid; always open from lg up.
  const [open, setOpen] = useState(false)

  return (
    <section className={`rounded-xl bg-white p-3 shadow-sm ${props.className ?? ''}`} aria-labelledby="library-title">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left lg:pointer-events-none"
        >
          <Library size={16} className="shrink-0 text-slate-500" />
          <h2 id="library-title" className="truncate text-sm font-semibold text-slate-800">
            My patterns{patterns ? ` (${patterns.length})` : ''}
          </h2>
          <ChevronDown size={16} className={`shrink-0 text-slate-500 transition-transform lg:hidden ${open ? 'rotate-180' : ''}`} />
        </button>
        <button
          type="button"
          onClick={props.onNew}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Plus size={15} /> New pattern
        </button>
      </div>

      <div className={`${open ? '' : 'hidden'} mt-2 lg:block`}>
        {error ? (
          <p className="text-sm text-red-600">
            {error}{' '}
            <button type="button" onClick={props.onRetry} className="font-medium underline">
              Try again
            </button>
          </p>
        ) : patterns === null ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-slate-500">
            <LoaderCircle size={14} className="animate-spin" /> Loading…
          </p>
        ) : patterns.length === 0 ? (
          <p className="text-sm text-slate-500">No saved patterns yet. Save this one to keep it here.</p>
        ) : (
          <ul className="max-h-80 space-y-0.5 overflow-y-auto">
            {patterns.map((p) => {
              const current = p.id === currentId
              return (
                <li key={p.id} className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${current ? 'bg-slate-100' : ''}`}>
                  <span className="flex shrink-0 flex-col gap-0.5" aria-hidden>
                    <span className="h-2.5 w-2.5 rounded-sm border border-slate-300" style={{ background: p.colors.A }} />
                    <span className="h-2.5 w-2.5 rounded-sm border border-slate-300" style={{ background: p.colors.B }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800" title={p.name}>
                      {p.name}
                      {current && <span className="ml-1.5 text-xs font-normal text-slate-500">(open)</span>}
                    </p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {p.rows} × {p.cols} ·{' '}
                      <time dateTime={p.updatedAt} title={new Date(p.updatedAt).toLocaleString()}>
                        {formatUpdated(p.updatedAt)}
                      </time>
                    </p>
                  </div>
                  {busyId === p.id ? (
                    <LoaderCircle size={16} className="mx-1.5 shrink-0 animate-spin text-slate-500" />
                  ) : (
                    <>
                      <button type="button" className={iconButton} onClick={() => onOpen(p)} disabled={busyId !== null} title="Open" aria-label={`Open ${p.name}`}>
                        <FolderOpen size={16} />
                      </button>
                      <button type="button" className={iconButton} onClick={() => onDelete(p)} disabled={busyId !== null} title="Delete" aria-label={`Delete ${p.name}`}>
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
