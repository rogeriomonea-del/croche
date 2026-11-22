import { ArrowLeft, ArrowRight, Check, Volume2 } from 'lucide-react'
import type { RowReading, Side } from '../../file'
import type { FileProgress } from '../../state/file-studio'
import { segmentLabel, totalsText } from './geometry'

interface FileReaderProps {
  reading: RowReading
  rows: number
  progress: FileProgress
  turning: boolean
  firstRowFrom: Side
  canSpeak: boolean
  autoRead: boolean
  onSegment: (segment: number) => void
  onMoveSegment: (delta: number) => void
  onMoveRow: (delta: number) => void
  onToggleDone: () => void
  onSpeakRow: () => void
  onSpeakSegment: () => void
  onAutoRead: (on: boolean) => void
  onTurning: (on: boolean) => void
  onFirstRowFrom: (side: Side) => void
}

export function FileReader(props: FileReaderProps) {
  const { reading, rows, progress, turning, firstRowFrom, canSpeak, autoRead } = props
  const done = progress.doneRows.includes(reading.row)
  const count = reading.segments.length
  const current = Math.min(progress.segment, count - 1)
  const currentSegment = reading.segments[current]
  const currentKind = currentSegment.type === 'run' ? currentSegment.run.kind : 'repeat'
  const leftward = reading.side === 'right'
  const Arrow = leftward ? ArrowLeft : ArrowRight
  const atStart = reading.row === 1 && current === 0
  const atEnd = reading.row === rows && current === count - 1

  return (
    <section className={`file-reader${done ? ' is-done' : ''}`} aria-labelledby="file-reader-title">
      <header className="file-reader-head">
        <h3 id="file-reader-title" aria-live="polite">
          Carreira <strong>{reading.row}</strong> <span>de {rows}</span>
        </h3>
        <button type="button" className={`file-done-toggle${done ? ' is-on' : ''}`} aria-pressed={done} onClick={props.onToggleDone}>
          <Check size={17} aria-hidden="true" />
          Carreira feita
        </button>
      </header>

      <p className="file-reader-direction">
        <Arrow size={34} strokeWidth={2.2} aria-hidden="true" />
        <span>{reading.direction}</span>
      </p>

      <div className="file-current" aria-live="polite">
        <span className="file-current-step">
          Trecho {current + 1} de {count}
        </span>
        <strong className="file-current-text">
          <i className={`file-swatch is-${currentKind}`} aria-hidden="true" />
          {segmentLabel(currentSegment)}
        </strong>
      </div>
      <div className="file-nav">
        <button type="button" className="file-nav-button" onClick={() => props.onMoveSegment(-1)} disabled={atStart}>
          ◀ Trecho
        </button>
        <button type="button" className="file-nav-button is-strong" onClick={() => props.onMoveSegment(1)} disabled={atEnd}>
          Trecho ▶
        </button>
        <button type="button" className="file-nav-button" onClick={() => props.onMoveRow(-1)} disabled={reading.row <= 1}>
          ◀ Carreira
        </button>
        <button type="button" className="file-nav-button" onClick={() => props.onMoveRow(1)} disabled={reading.row >= rows}>
          Carreira ▶
        </button>
      </div>

      <ol className="file-chips" aria-label="Trechos da carreira">
        {reading.segments.map((segment, index) => {
          const kind = segment.type === 'run' ? segment.run.kind : 'repeat'
          return (
            <li key={index}>
              <button
                type="button"
                className={`file-chip is-${kind}`}
                aria-current={index === current ? 'step' : undefined}
                onClick={() => props.onSegment(index)}
              >
                <i className={`file-swatch is-${kind}`} aria-hidden="true" />
                {segmentLabel(segment)}
              </button>
            </li>
          )
        })}
      </ol>
      <p className="file-reader-text" data-testid="file-reader-text">{reading.text}</p>
      <p className="file-reader-totals">{totalsText(reading)}</p>
      <p className="file-reader-progress">
        {progress.doneRows.length} de {rows} carreiras feitas
        <span className="file-progress-bar" aria-hidden="true">
          <span style={{ width: `${(100 * progress.doneRows.length) / rows}%` }} />
        </span>
      </p>

      {canSpeak && (
        <div className="file-voice">
          <button type="button" className="file-button" onClick={props.onSpeakRow}>
            <Volume2 size={17} aria-hidden="true" />
            Ouvir
          </button>
          <button type="button" className="file-button" onClick={props.onSpeakSegment}>
            <Volume2 size={17} aria-hidden="true" />
            Ouvir trecho
          </button>
          <label className="file-switch">
            <input type="checkbox" role="switch" checked={autoRead} onChange={(event) => props.onAutoRead(event.target.checked)} />
            <span aria-hidden="true" />
            Ler em voz alta ao avançar
          </label>
        </div>
      )}

      <fieldset className="file-reading-options">
        <legend>Leitura</legend>
        <label className="file-check">
          <input type="checkbox" checked={turning} onChange={(event) => props.onTurning(event.target.checked)} />
          Ida e volta (virar o trabalho)
        </label>
        <div className="file-inline-choice" role="group" aria-label="1ª carreira começa pela">
          <span>1ª carreira começa pela:</span>
          <div className="file-segmented is-small">
            <button type="button" aria-pressed={firstRowFrom === 'right'} onClick={() => props.onFirstRowFrom('right')}>direita</button>
            <button type="button" aria-pressed={firstRowFrom === 'left'} onClick={() => props.onFirstRowFrom('left')}>esquerda</button>
          </div>
        </div>
      </fieldset>
    </section>
  )
}

interface FileReadingStripProps {
  reading: RowReading
  rows: number
  segment: number
  onMoveSegment: (delta: number) => void
}

/**
 * The current row and segment in one compact band, kept in sight while the chart is on a phone
 * screen (the full reader sits above the chart there): a tap on the chart is answered right where
 * the finger is. Hidden on wide screens, where the reader is a sticky side column.
 */
export function FileReadingStrip({ reading, rows, segment, onMoveSegment }: FileReadingStripProps) {
  const count = reading.segments.length
  const current = Math.min(segment, count - 1)
  const currentSegment = reading.segments[current]
  const kind = currentSegment.type === 'run' ? currentSegment.run.kind : 'repeat'
  const Arrow = reading.side === 'right' ? ArrowLeft : ArrowRight
  return (
    <div className="file-strip" role="group" aria-label="Leitura atual" data-testid="file-strip">
      <p className="file-strip-row">
        <strong>Carreira {reading.row}</strong> <span>de {rows}</span>
        <span className="file-strip-direction">
          <Arrow size={16} strokeWidth={2.4} aria-hidden="true" />
          {reading.direction}
        </span>
      </p>
      <p className="file-strip-current">
        <span className="file-strip-step">Trecho {current + 1} de {count}</span>
        <strong>
          <i className={`file-swatch is-${kind}`} aria-hidden="true" />
          {segmentLabel(currentSegment)}
        </strong>
      </p>
      <div className="file-strip-nav">
        <button type="button" className="file-nav-button" aria-label="Trecho anterior" onClick={() => onMoveSegment(-1)} disabled={reading.row === 1 && current === 0}>
          ◀
        </button>
        <button type="button" className="file-nav-button is-strong" aria-label="Próximo trecho" onClick={() => onMoveSegment(1)} disabled={reading.row === rows && current === count - 1}>
          ▶
        </button>
      </div>
    </div>
  )
}
