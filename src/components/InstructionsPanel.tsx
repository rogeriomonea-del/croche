import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BookOpen, ChevronDown, MoveLeft, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import './auxiliary.css'

interface InstructionsPanelProps {
  lines: string[]
  conflictRows: Set<number>
  className?: string
}

export function InstructionsPanel({ lines, conflictRows, className = '' }: InstructionsPanelProps) {
  const [open, setOpen] = useState(true)
  const [readingRow, setReadingRow] = useState<number | null>(null)
  const reducedMotion = useReducedMotion()

  return (
    <aside className={`aux-panel instruction-panel ${className}`} aria-labelledby="instructions-title">
      <button
        type="button"
        className="aux-panel-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="instruction-sheet"
      >
        <span className="aux-panel-icon">
          <BookOpen size={16} strokeWidth={1.6} />
        </span>
        <span className="aux-panel-title" id="instructions-title">
          Receita escrita
        </span>
        <ChevronDown size={15} className={`aux-chevron ${open ? 'is-open' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="sheet"
            id="instruction-sheet"
            initial={{ height: reducedMotion ? 'auto' : 0, opacity: reducedMotion ? 1 : 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: reducedMotion ? 'auto' : 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="aux-collapse"
          >
            <p className="instruction-direction">
              <MoveLeft size={14} /> Da direita para a esquerda, sempre pelo direito.
            </p>
            <ol className="instruction-list" aria-label="Instruções do desenho">
              {lines.map((line, i) => {
                const row = i + 1
                const conflict = conflictRows.has(row)
                // Translate presentation only; the core and exported recipe retain their contract.
                const displayLine = line
                  .replace(/^Row (\d+):/, 'Carreira $1:')
                  .replace(/\bsc\b/g, 'pb')
                  .replace(/\bdc\b/g, 'pa')
                  .replace(/\band\b/g, 'e')
                return (
                  <li key={row}>
                    <button
                      type="button"
                      className={`instruction-row ${conflict ? 'has-conflict' : ''} ${readingRow === row ? 'is-reading' : ''}`}
                      onClick={() => setReadingRow(readingRow === row ? null : row)}
                      aria-pressed={readingRow === row}
                      aria-label={`${displayLine}${conflict ? '. Conflito de pontos' : ''}`}
                      title="Marcar a carreira que você está tecendo"
                    >
                      <span className="instruction-row-number">{String(row).padStart(2, '0')}</span>
                      <span>{displayLine.replace(/^Carreira \d+:\s*/, '')}</span>
                      {conflict && (
                        <TriangleAlert size={13} className="instruction-warning" aria-label="conflito" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ol>
            <div className="instruction-key">
              <span>
                <b>pb</b> ponto baixo
              </span>
              <span>
                <b>pa</b> ponto alto
              </span>
            </div>
            <p className="instruction-footnote">Toque numa carreira para marcar onde parou.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  )
}
