import { Check, ImagePlus, Maximize2, PencilLine, Rows3, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react'
import { fileCols, fileRows, rowReading, speechChunks, speechText, type FileChart } from '../../file'
import { createSpeaker } from '../../lib/speech'
import { createWakeLock } from '../../lib/wake-lock'
import { fileStudioReducer, loadFileStudio, saveFileStudio, type FileStudioAction } from '../../state/file-studio'
import { FileChartCanvas } from './FileChartCanvas'
import { FileEditPanel } from './FileEditPanel'
import { FileImport } from './FileImport'
import { FileReader } from './FileReader'
import { fitCell, segmentColumns, zoomStep } from './geometry'
import './file-studio.css'

interface FileStudioProps {
  onClose: () => void
}

/** localStorage, or null where reading it throws (Safari private mode, blocked storage). */
function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const SAVE_DELAY = 300
const NAVIGATION = new Set(['moveSegment', 'moveRow', 'selectRow', 'selectSegment'])

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

export function FileStudio({ onClose }: FileStudioProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const chartPanel = useRef<HTMLElement>(null)
  const readerAnchor = useRef<HTMLDivElement>(null)
  const [state, dispatch] = useReducer(fileStudioReducer, undefined, () => loadFileStudio(safeStorage()))
  const [importing, setImporting] = useState(false)
  const [cell, setCell] = useState(12)
  const [autoFit, setAutoFit] = useState(true)
  const speaker = useMemo(() => createSpeaker(), [])
  const wakeLock = useMemo(() => createWakeLock(), [])
  const latest = useRef(state)
  const speakNext = useRef(false)
  const spokenRow = useRef<number | null>(null)

  const { chart, mode, reading: readingOptions, progress, autoRead } = state
  const rows = fileRows(chart)
  const cols = fileCols(chart)
  const reading = useMemo(() => rowReading(chart, progress.row, readingOptions), [chart, progress.row, readingOptions])
  const segment = Math.min(progress.segment, reading.segments.length - 1)
  const spans = useMemo(() => segmentColumns(reading, cols), [reading, cols])
  const recipe = useMemo(
    () => Array.from({ length: rows }, (_, i) => rowReading(chart, i + 1, readingOptions).text),
    [chart, rows, readingOptions],
  )

  // Native modal dialog: opened once, restores focus to the launcher when it goes away.
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (element && !element.open) element.showModal()
    return () => {
      element?.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  // Debounced autosave, flushed when the page is hidden or the studio closes.
  useEffect(() => {
    latest.current = state
  }, [state])
  useEffect(() => {
    const timer = setTimeout(() => saveFileStudio(safeStorage(), state), SAVE_DELAY)
    return () => clearTimeout(timer)
    // The history is not saved: only these parts trigger a write.
  }, [state.chart, state.mode, state.reading, state.progress, state.autoRead])
  useEffect(() => {
    const flush = () => saveFileStudio(safeStorage(), latest.current)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  // Screen stays on while crocheting.
  useEffect(() => {
    if (mode !== 'tecer' || importing) return
    void wakeLock.enable()
    return () => {
      void wakeLock.disable()
    }
  }, [mode, importing, wakeLock])

  useEffect(() => () => speaker.cancel(), [speaker])

  const fit = useCallback(() => {
    const panel = chartPanel.current
    if (!panel) return
    const style = getComputedStyle(panel)
    const width = panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    if (width > 0) setCell(fitCell(width - 1, rows, cols, 3, 28))
  }, [rows, cols])
  // Fit the chart on first paint, when its size changes, and when the screen changes size, until
  // the user picks a zoom; "Ajustar" goes back to fitting.
  useLayoutEffect(() => {
    if (importing || !autoFit) return
    fit()
    const panel = chartPanel.current
    if (!panel || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => fit())
    observer.observe(panel)
    return () => observer.disconnect()
  }, [fit, importing, autoFit])

  const act = useCallback((action: FileStudioAction) => {
    if (NAVIGATION.has(action.type)) speakNext.current = true
    dispatch(action)
  }, [])

  // Read aloud after moving, when asked to.
  useEffect(() => {
    if (!speakNext.current) return
    speakNext.current = false
    if (!autoRead || mode !== 'tecer') return
    const chunk = speechChunks(reading)[segment] ?? ''
    if (spokenRow.current !== reading.row) speaker.speak(`Carreira ${reading.row}, ${reading.direction}. ${chunk}.`)
    else speaker.speak(`${chunk}.`)
    spokenRow.current = reading.row
  }, [reading, segment, autoRead, mode, speaker])

  function speakRow() {
    spokenRow.current = reading.row
    speaker.speak(speechText(reading))
  }

  function speakSegment() {
    const chunk = speechChunks(reading)[segment]
    if (chunk) speaker.speak(`${chunk}.`)
  }

  function applyImported(next: FileChart) {
    dispatch({ type: 'replaceChart', chart: next })
    dispatch({ type: 'setMode', mode: 'editar' })
    setImporting(false)
  }

  function selectFromRecipe(row: number) {
    act({ type: 'selectRow', row })
    if (mode !== 'tecer') dispatch({ type: 'setMode', mode: 'tecer' })
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => readerAnchor.current?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' }))
  }

  function keyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // A native dialog makes the page inert, but some browsers still visit their chrome when
      // tabbing beyond the first/last control. Keep the studio's loop explicit.
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]'))
        .filter((element) => element.tabIndex >= 0 && !element.hasAttribute('disabled') && element.getClientRects().length > 0 && !element.closest('[inert]'))
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) {
        event.preventDefault()
        return
      }
      const current = document.activeElement
      if (event.shiftKey && (current === first || current === event.currentTarget)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (current === last || current === event.currentTarget)) {
        event.preventDefault()
        first.focus()
      }
      return
    }
    if (importing || isTyping(event.target)) return
    const mod = event.ctrlKey || event.metaKey
    if (mode === 'editar') {
      if (mod && !event.altKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
      } else if (mod && !event.altKey && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        dispatch({ type: 'redo' })
      }
      return
    }
    if (mod || event.altKey) return
    const moves: Record<string, FileStudioAction> = {
      ArrowLeft: { type: 'moveSegment', delta: -1 },
      ArrowRight: { type: 'moveSegment', delta: 1 },
      ArrowUp: { type: 'moveRow', delta: 1 },
      ArrowDown: { type: 'moveRow', delta: -1 },
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      act(move)
    } else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault()
      speakRow()
    }
  }

  const doneCount = progress.doneRows.length

  return (
    <dialog
      ref={dialog}
      className="file-studio"
      aria-labelledby="file-studio-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={keyDown}
    >
      <div className="file-studio-inner">
        <header className="file-studio-head">
          <div>
            <p className="file-eyebrow">CROCHET VICTORIOSO · CROCHÊ FILÉ</p>
            <h2 id="file-studio-title">
              Estúdio de <em>filé</em>
            </h2>
          </div>
          <button type="button" className="file-close" onClick={onClose} aria-label="Fechar estúdio de filé">
            <X size={20} />
          </button>
        </header>

        <div className="file-studio-bar">
          <div className="file-segmented" role="group" aria-label="Modo do estúdio">
            <button type="button" aria-pressed={!importing && mode === 'editar'} onClick={() => { setImporting(false); dispatch({ type: 'setMode', mode: 'editar' }) }}>
              <PencilLine size={16} aria-hidden="true" />
              Editar
            </button>
            <button type="button" aria-pressed={!importing && mode === 'tecer'} onClick={() => { setImporting(false); dispatch({ type: 'setMode', mode: 'tecer' }) }}>
              <Rows3 size={16} aria-hidden="true" />
              Tecer
            </button>
          </div>
          <button type="button" className="file-button file-import-launch" aria-pressed={importing} onClick={() => setImporting(true)}>
            <ImagePlus size={16} aria-hidden="true" />
            Importar foto ou gráfico
          </button>
          <p className="file-chart-meta">
            <strong>{chart.name.trim() || 'Gráfico filé'}</strong>
            <span>
              {rows} carreiras × {cols} colunas · {doneCount} de {rows} carreiras feitas
            </span>
          </p>
        </div>

        {importing ? (
          <FileImport onUse={applyImported} onCancel={() => setImporting(false)} />
        ) : (
          <div className={`file-studio-main is-${mode}`}>
            <section ref={chartPanel} className="file-chart-panel" aria-label="Gráfico">
              <div className="file-zoom">
                <div className="file-zoom-buttons">
                  <button type="button" className="file-icon-button" aria-label="Diminuir zoom" onClick={() => { setAutoFit(false); setCell((c) => zoomStep(c, -1, rows, cols)) }}>
                    <ZoomOut size={18} />
                  </button>
                  <button type="button" className="file-icon-button" aria-label="Aumentar zoom" onClick={() => { setAutoFit(false); setCell((c) => zoomStep(c, 1, rows, cols)) }}>
                    <ZoomIn size={18} />
                  </button>
                  <button type="button" className="file-button is-compact" aria-pressed={autoFit} onClick={() => { setAutoFit(true); fit() }}>
                    <Maximize2 size={15} aria-hidden="true" />
                    Ajustar
                  </button>
                </div>
                <p className="file-legend">
                  <span><i style={{ background: chart.colors.filled }} />fechado</span>
                  <span><i style={{ background: chart.colors.open }} />aberto</span>
                </p>
              </div>
              <FileChartCanvas
                chart={chart}
                mode={mode}
                reading={readingOptions}
                row={progress.row}
                segmentSpan={mode === 'tecer' ? spans[segment] ?? null : null}
                doneRows={progress.doneRows}
                cell={cell}
                onSelectRow={(row) => act({ type: 'selectRow', row })}
                onStrokeStart={() => dispatch({ type: 'strokeStart' })}
                onPaint={(r, c, filled) => dispatch({ type: 'paint', r, c, filled })}
                onStrokeEnd={() => dispatch({ type: 'strokeEnd' })}
              />
              <p className="file-hint">
                {mode === 'tecer'
                  ? 'Toque em qualquer quadradinho ou número para ler aquela carreira. Teclado: ← → trechos, ↑ ↓ carreiras, espaço para ouvir.'
                  : 'Carreira 1 embaixo; a seta dourada marca o lado em que cada carreira começa.'}
              </p>
            </section>

            <aside className="file-side">
              <div ref={readerAnchor} className="file-reader-anchor" />
              {mode === 'tecer' ? (
                <FileReader
                  reading={reading}
                  rows={rows}
                  progress={progress}
                  turning={readingOptions.turning}
                  firstRowFrom={readingOptions.firstRowFrom}
                  canSpeak={speaker.supported}
                  autoRead={autoRead}
                  onSegment={(s) => act({ type: 'selectSegment', segment: s })}
                  onMoveSegment={(delta) => act({ type: 'moveSegment', delta })}
                  onMoveRow={(delta) => act({ type: 'moveRow', delta })}
                  onToggleDone={() => dispatch({ type: 'toggleDone', row: reading.row })}
                  onSpeakRow={speakRow}
                  onSpeakSegment={speakSegment}
                  onAutoRead={(on) => dispatch({ type: 'setAutoRead', on })}
                  onTurning={(turning) => dispatch({ type: 'setReading', turning })}
                  onFirstRowFrom={(firstRowFrom) => dispatch({ type: 'setReading', firstRowFrom })}
                />
              ) : (
                <FileEditPanel
                  chart={chart}
                  canUndo={state.past.length > 0}
                  canRedo={state.future.length > 0}
                  onUndo={() => dispatch({ type: 'undo' })}
                  onRedo={() => dispatch({ type: 'redo' })}
                  onRename={(name) => dispatch({ type: 'rename', name })}
                  onColor={(key, value) => dispatch({ type: 'setColor', key, value })}
                  onResize={(r, c) => dispatch({ type: 'resize', rows: r, cols: c })}
                  onReplace={(next) => dispatch({ type: 'replaceChart', chart: next })}
                />
              )}
            </aside>

            <section className="file-recipe" aria-labelledby="file-recipe-title">
              <h3 id="file-recipe-title">Receita completa</h3>
              <p className="file-hint">Da carreira 1 (embaixo) até a última. Toque numa carreira para lê-la.</p>
              <ol>
                {recipe.map((text, i) => {
                  const row = i + 1
                  const done = progress.doneRows.includes(row)
                  return (
                    <li key={row}>
                      <button
                        type="button"
                        className={`file-recipe-row${done ? ' is-done' : ''}`}
                        aria-current={mode === 'tecer' && row === progress.row ? 'true' : undefined}
                        onClick={() => selectFromRecipe(row)}
                      >
                        <span>{text}</span>
                        {done && <Check size={16} aria-label="feita" />}
                      </button>
                    </li>
                  )
                })}
              </ol>
            </section>
          </div>
        )}
      </div>
    </dialog>
  )
}
