import { Download, Redo2, Undo2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { FILE_MAX_COLS, FILE_MAX_ROWS, fileCols, fileRows, parseFileDocument, type FileChart } from '../../file'
import { fileSlug } from '../../shared/filename'
import { exportableDocument } from '../../state/file-studio'

interface FileEditPanelProps {
  chart: FileChart
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onRename: (name: string) => void
  onColor: (key: 'filled' | 'open', value: string) => void
  onResize: (rows: number, cols: number) => void
  onReplace: (chart: FileChart) => void
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function FileEditPanel(props: FileEditPanelProps) {
  const { chart } = props
  const rows = fileRows(chart)
  const cols = fileCols(chart)
  const jsonInput = useRef<HTMLInputElement>(null)
  const [size, setSize] = useState({ rows: String(rows), cols: String(cols) })
  const [sizeError, setSizeError] = useState<string | null>(null)
  const [importErrors, setImportErrors] = useState<string[] | null>(null)

  // Follow the chart when it changes elsewhere (undo, import).
  useEffect(() => {
    setSize({ rows: String(rows), cols: String(cols) })
    setSizeError(null)
  }, [rows, cols])

  function applySize() {
    const r = Number(size.rows)
    const c = Number(size.cols)
    const ok = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max
    if (!ok(r, FILE_MAX_ROWS) || !ok(c, FILE_MAX_COLS)) {
      setSizeError('Use números inteiros de 1 a 200 para carreiras e colunas.')
      return
    }
    setSizeError(null)
    props.onResize(r, c)
  }

  async function importJson(file: File | undefined) {
    if (!file) return
    setImportErrors(null)
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('size')
      const parsed = parseFileDocument(JSON.parse(await file.text()))
      if (parsed.ok) props.onReplace(parsed.chart)
      else setImportErrors(parsed.errors)
    } catch {
      setImportErrors(['Este arquivo não é um gráfico filé em JSON válido.'])
    }
  }

  return (
    <section className="file-panel" aria-label="Editar gráfico">
      <div className="file-history">
        <button type="button" className="file-button" onClick={props.onUndo} disabled={!props.canUndo} aria-keyshortcuts="Control+Z Meta+Z">
          <Undo2 size={17} aria-hidden="true" />
          Desfazer
        </button>
        <button type="button" className="file-button" onClick={props.onRedo} disabled={!props.canRedo} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">
          <Redo2 size={17} aria-hidden="true" />
          Refazer
        </button>
      </div>
      <p className="file-hint">Toque para alternar um quadradinho; arraste para pintar vários de uma vez.</p>

      <label className="file-field">
        Nome do gráfico
        <input value={chart.name} maxLength={100} onChange={(event) => props.onRename(event.target.value)} />
      </label>

      <form
        className="file-size-row"
        onSubmit={(event) => {
          event.preventDefault()
          applySize()
        }}
      >
        <label className="file-field">
          Carreiras
          <input type="number" inputMode="numeric" min={1} max={FILE_MAX_ROWS} value={size.rows} onChange={(event) => setSize({ ...size, rows: event.target.value })} />
        </label>
        <label className="file-field">
          Colunas
          <input type="number" inputMode="numeric" min={1} max={FILE_MAX_COLS} value={size.cols} onChange={(event) => setSize({ ...size, cols: event.target.value })} />
        </label>
        <button type="submit" className="file-button" disabled={size.rows === String(rows) && size.cols === String(cols)}>
          Aplicar tamanho
        </button>
      </form>
      {sizeError && <p role="alert" className="file-error">{sizeError}</p>}
      <p className="file-hint">O desenho fica preso no canto de baixo à esquerda (carreira 1, coluna 1).</p>

      <div className="file-colors">
        <label className="file-color">
          <input type="color" value={chart.colors.filled} onChange={(event) => props.onColor('filled', event.target.value)} />
          Cor dos fechados
        </label>
        <label className="file-color">
          <input type="color" value={chart.colors.open} onChange={(event) => props.onColor('open', event.target.value)} />
          Cor dos abertos
        </label>
      </div>

      <div className="file-json">
        <button
          type="button"
          className="file-button"
          onClick={() => download(`${fileSlug(chart.name)}.file.json`, `${JSON.stringify(exportableDocument(chart), null, 2)}\n`)}
        >
          <Download size={16} aria-hidden="true" />
          Exportar JSON
        </button>
        <button type="button" className="file-button" onClick={() => jsonInput.current?.click()}>
          <Upload size={16} aria-hidden="true" />
          Importar JSON
        </button>
        <input
          ref={jsonInput}
          type="file"
          accept="application/json,.json"
          aria-label="Escolher arquivo JSON do gráfico filé"
          hidden
          onChange={(event) => {
            void importJson(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>
      {importErrors && (
        <div role="alert" className="file-error">
          <strong>Não foi possível importar:</strong>
          <ul>
            {importErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
