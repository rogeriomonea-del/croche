import { ArrowRight, ImagePlus, LoaderCircle, ScanLine, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_FILE_COLORS, FILE_MAX_COLS, FILE_MAX_ROWS, fileChartFromTopFirst, type FileChart } from '../../file'
import { decodePhotoFile, type DecodedPhoto } from '../../lib/photo-image'
import { analyzeChartImage, type ChartAnalysis, type RgbaImage } from '../../lib/vision'
import { documentName } from '../../state/file-studio'

interface FileImportProps {
  onUse: (chart: FileChart) => void
  onCancel: () => void
}

const HEX = /^#[0-9a-f]{6}$/

function hex(value: string, fallback: string): string {
  const v = value.trim().toLowerCase()
  return HEX.test(v) ? v : fallback
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Não foi possível analisar esta imagem. Tente outra.'
}

function chartName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
  return documentName(stem ? `Filé — ${stem}` : 'Gráfico filé')
}

function ReferencePreview({ source, crop }: { source: DecodedPhoto; crop: ChartAnalysis['crop'] | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    canvas.width = source.canvas.width
    canvas.height = source.canvas.height
    ctx.drawImage(source.canvas, 0, 0)
    if (crop) {
      // The sampled region, framed in gold.
      const w = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) / 220))
      ctx.strokeStyle = '#b7915d'
      ctx.lineWidth = w
      ctx.setLineDash([w * 3, w * 2])
      ctx.strokeRect(crop.x, crop.y, crop.width, crop.height)
    }
  }, [source, crop])
  return <canvas ref={ref} role="img" aria-label="Imagem de referência importada" />
}

function ResultPreview({ analysis, invert }: { analysis: ChartAnalysis; invert: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const cell = Math.max(2, Math.min(14, Math.floor(720 / Math.max(analysis.cols, analysis.rows))))
    canvas.width = analysis.cols * cell
    canvas.height = analysis.rows * cell
    ctx.fillStyle = hex(analysis.colors.paper, DEFAULT_FILE_COLORS.open)
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = hex(analysis.colors.ink, DEFAULT_FILE_COLORS.filled)
    for (let i = 0; i < analysis.rows; i++) {
      for (let j = 0; j < analysis.cols; j++) if (analysis.ink[i][j] !== invert) ctx.fillRect(j * cell, i * cell, cell, cell)
    }
    if (cell >= 4) {
      ctx.strokeStyle = 'rgba(92, 72, 67, 0.25)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let j = 1; j < analysis.cols; j++) {
        ctx.moveTo(j * cell + 0.5, 0)
        ctx.lineTo(j * cell + 0.5, canvas.height)
      }
      for (let i = 1; i < analysis.rows; i++) {
        ctx.moveTo(0, i * cell + 0.5)
        ctx.lineTo(canvas.width, i * cell + 0.5)
      }
      ctx.stroke()
    }
  }, [analysis, invert])
  return <canvas ref={ref} role="img" aria-label={`Gráfico lido: ${analysis.cols} × ${analysis.rows} quadradinhos`} />
}

export function FileImport({ onUse, onCancel }: FileImportProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const [source, setSource] = useState<DecodedPhoto | null>(null)
  const [image, setImage] = useState<RgbaImage | null>(null)
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [analysing, setAnalysing] = useState(false)
  const [analysis, setAnalysis] = useState<ChartAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invert, setInvert] = useState(false)
  const [inkBias, setInkBias] = useState(0)
  const [manual, setManual] = useState<{ cols: number; rows: number } | null>(null)
  const [sizeDraft, setSizeDraft] = useState<{ cols: string; rows: string }>({ cols: '', rows: '' })

  useEffect(() => () => {
    request.current++
  }, [])

  // Analysis runs after a frame, so the spinner paints first and typing never blocks.
  useEffect(() => {
    if (!image) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    setAnalysing(true)
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        if (cancelled) return
        try {
          const result = analyzeChartImage(image, { inkBias, ...(manual ?? {}) })
          if (cancelled) return
          setAnalysis(result)
          setError(null)
          if (!manual) setSizeDraft({ cols: String(result.cols), rows: String(result.rows) })
        } catch (err) {
          if (!cancelled) {
            setAnalysis(null)
            setError(message(err))
          }
        } finally {
          if (!cancelled) setAnalysing(false)
        }
      }, 0)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [image, inkBias, manual])

  async function loadFile(file: File | undefined) {
    if (!file) return
    const id = ++request.current
    setLoading(true)
    setError(null)
    try {
      const decoded = await decodePhotoFile(file)
      if (id !== request.current) return
      const ctx = decoded.canvas.getContext('2d')
      if (!ctx) throw new Error('O navegador não conseguiu abrir a área de imagem.')
      const data = ctx.getImageData(0, 0, decoded.canvas.width, decoded.canvas.height)
      setSource(decoded)
      setFileName(file.name)
      setAnalysis(null)
      setManual(null)
      setInvert(false)
      setInkBias(0)
      setImage({ width: data.width, height: data.height, data: data.data })
    } catch (err) {
      if (id === request.current) setError(message(err))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }

  function validSize(draft: { cols: string; rows: string }): { cols: number; rows: number } | null {
    const cols = Number(draft.cols)
    const rows = Number(draft.rows)
    const ok = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max
    return ok(cols, FILE_MAX_COLS) && ok(rows, FILE_MAX_ROWS) ? { cols, rows } : null
  }

  function applySize(next: { cols: string; rows: string }) {
    setSizeDraft(next)
    const size = validSize(next)
    if (size) setManual(size)
  }

  function use() {
    if (!analysis) return
    try {
      onUse(
        fileChartFromTopFirst(analysis.ink, {
          name: chartName(fileName),
          colors: {
            filled: hex(analysis.colors.ink, DEFAULT_FILE_COLORS.filled),
            open: hex(analysis.colors.paper, DEFAULT_FILE_COLORS.open),
          },
          invert,
        }),
      )
    } catch (err) {
      setError(message(err))
    }
  }

  const gridFound = analysis?.mode === 'grid'
  const sizeInvalid = !!analysis && !gridFound && !validSize(sizeDraft)

  return (
    <section className="file-import" aria-label="Importar foto ou gráfico">
      <div className={`file-import-drop${source ? ' has-image' : ''}`}>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Escolher foto ou print do gráfico"
          hidden
          onChange={(event) => {
            void loadFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        {loading ? <LoaderCircle size={28} className="file-spin" aria-hidden="true" /> : <ImagePlus size={source ? 22 : 32} strokeWidth={1.2} aria-hidden="true" />}
        <div className="file-import-copy">
          <strong>{loading ? 'Lendo a imagem…' : source ? fileName : 'Envie o print ou a foto do gráfico.'}</strong>
          <span>
            {source
              ? `${source.originalWidth} × ${source.originalHeight} px · analisada só neste aparelho`
              : 'PNG, JPEG ou WebP, até 12 MB. A grade é encontrada sozinha; margens, números e marca d’água ficam de fora.'}
          </span>
        </div>
        <button type="button" className="file-button" onClick={() => fileInput.current?.click()} disabled={loading}>
          <Upload size={16} aria-hidden="true" />
          {source ? 'Trocar imagem' : 'Escolher imagem'}
        </button>
      </div>

      {source && (
        <>
          <div className="file-import-compare">
            <figure>
              <figcaption><span>01</span> Referência</figcaption>
              <div className="file-import-stage"><ReferencePreview source={source} crop={analysis?.crop ?? null} /></div>
            </figure>
            <figure>
              <figcaption><span>02</span> Leitura em filé</figcaption>
              <div className="file-import-stage" aria-busy={analysing}>
                {analysis && <ResultPreview analysis={analysis} invert={invert} />}
                {analysing && (
                  <span className="file-import-busy" role="status">
                    <LoaderCircle size={22} className="file-spin" aria-hidden="true" />
                    Analisando a grade…
                  </span>
                )}
              </div>
            </figure>
          </div>

          {analysis && (
            <div className="file-import-controls">
              <p className={`file-import-status${gridFound ? ' is-found' : ''}`} aria-live="polite">
                <ScanLine size={17} aria-hidden="true" />
                {gridFound
                  ? `Grade detectada: ${analysis.cols} × ${analysis.rows} quadradinhos`
                  : 'Grade não encontrada — informe o tamanho'}
              </p>
              {!gridFound && (
                <div className="file-size-row">
                  <label className="file-field">
                    Colunas
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={FILE_MAX_COLS}
                      value={sizeDraft.cols}
                      onChange={(event) => applySize({ ...sizeDraft, cols: event.target.value })}
                    />
                  </label>
                  <label className="file-field">
                    Carreiras
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={FILE_MAX_ROWS}
                      value={sizeDraft.rows}
                      onChange={(event) => applySize({ ...sizeDraft, rows: event.target.value })}
                    />
                  </label>
                  {sizeInvalid && <p className="file-hint">Use números inteiros de 1 a 200.</p>}
                </div>
              )}
              <label className="file-check">
                <input type="checkbox" checked={invert} onChange={(event) => setInvert(event.target.checked)} />
                Inverter fechado/aberto
              </label>
              <label className="file-field file-range">
                <span>
                  Sensibilidade <output>{inkBias > 0 ? '+' : ''}{inkBias.toFixed(2)}</output>
                </span>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={inkBias}
                  onChange={(event) => setInkBias(Number(event.target.value))}
                />
                <small>Para a esquerda, menos quadradinhos fechados; para a direita, mais.</small>
              </label>
            </div>
          )}
        </>
      )}

      {error && <p role="alert" className="file-error">{error}</p>}

      <div className="file-import-actions">
        <button type="button" className="file-button" onClick={onCancel}>Voltar ao gráfico</button>
        <button type="button" className="file-button is-primary" disabled={!analysis || analysing || loading} onClick={use}>
          Usar este gráfico
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}
