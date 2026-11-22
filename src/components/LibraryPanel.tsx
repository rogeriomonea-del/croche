import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, FolderOpen, Library, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { PatternSummary } from '../shared/api'
import './auxiliary.css'

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

export function LibraryPanel(props: LibraryPanelProps) {
  const { patterns, error, currentId, busyId, onOpen, onDelete } = props
  const [open, setOpen] = useState(true)
  const reducedMotion = useReducedMotion()

  return (
    <section className={`aux-panel library-panel ${props.className ?? ''}`} aria-labelledby="library-title">
      <div className="library-heading">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="pattern-library"
          className="aux-panel-toggle"
        >
          <span className="aux-panel-icon">
            <Library size={16} strokeWidth={1.6} />
          </span>
          <span className="aux-panel-title" id="library-title">
            Meus desenhos
          </span>
          {patterns && <span className="aux-count">{patterns.length}</span>}
          <ChevronDown size={14} className={`aux-chevron ${open ? 'is-open' : ''}`} />
        </button>
        <button
          type="button"
          onClick={props.onNew}
          className="aux-icon-button library-new"
          title="Novo desenho"
          aria-label="Novo desenho"
        >
          <Plus size={16} />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="library"
            id="pattern-library"
            initial={{ height: reducedMotion ? 'auto' : 0, opacity: reducedMotion ? 1 : 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: reducedMotion ? 'auto' : 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="aux-collapse"
          >
            {error ? (
              <p className="aux-empty aux-error" role="alert">
                {error}{' '}
                <button type="button" onClick={props.onRetry} className="aux-text-button">
                  Tentar novamente
                </button>
              </p>
            ) : patterns === null ? (
              <p className="aux-empty aux-loading" role="status">
                <LoaderCircle size={15} className="animate-spin" /> Reunindo seus desenhos…
              </p>
            ) : patterns.length === 0 ? (
              <div className="library-empty">
                <span className="library-empty-art" aria-hidden="true">
                  <FolderOpen size={23} strokeWidth={1.25} />
                </span>
                <p>Toda coleção começa com uma ideia.</p>
                <span>
                  Salve seu desenho e volte a ele
                  <br />
                  quando a inspiração chamar.
                </span>
              </div>
            ) : (
              <ul className="library-list">
                <AnimatePresence initial={false}>
                  {patterns.map((p) => {
                    const current = p.id === currentId
                    return (
                      <motion.li
                        key={p.id}
                        layout={!reducedMotion}
                        initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        className={`library-item ${current ? 'is-current' : ''}`}
                      >
                        <span
                          className="library-swatch"
                          aria-hidden="true"
                          style={{ backgroundColor: p.colors.A, color: p.colors.B }}
                        >
                          <svg viewBox="0 0 32 36" fill="none">
                            <path
                              d="M-4 0 16 20 36 0M-4 9 16 29 36 9M-4 18 16 38 36 18M-4 27 16 47 36 27"
                              stroke="currentColor"
                              strokeWidth="5"
                            />
                          </svg>
                        </span>
                        <div className="library-details">
                          <p title={p.name}>
                            {p.name}
                            {current && <span className="library-current-dot" aria-label="Desenho aberto" />}
                          </p>
                          <span>
                            {p.rows} × {p.cols} ·{' '}
                            <time dateTime={p.updatedAt} title={new Date(p.updatedAt).toLocaleString('pt-BR')}>
                              {new Date(p.updatedAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                            </time>
                          </span>
                        </div>
                        {busyId === p.id ? (
                          <LoaderCircle
                            size={15}
                            className="library-spinner animate-spin"
                            aria-label="Processando"
                          />
                        ) : (
                          <div className="library-actions">
                            <button
                              type="button"
                              className="aux-icon-button"
                              onClick={() => onOpen(p)}
                              disabled={busyId !== null}
                              title="Abrir"
                              aria-label={`Abrir ${p.name}`}
                            >
                              <FolderOpen size={15} />
                            </button>
                            <button
                              type="button"
                              className="aux-icon-button aux-delete-button"
                              onClick={() => onDelete(p)}
                              disabled={busyId !== null}
                              title="Excluir"
                              aria-label={`Excluir ${p.name}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </motion.li>
                    )
                  })}
                </AnimatePresence>
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
