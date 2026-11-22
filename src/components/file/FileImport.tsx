import { ArrowRight, FlipHorizontal2, ImagePlus, LoaderCircle, RotateCw, ScanLine, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_FILE_COLORS,
  FILE_MAX_COLS,
  FILE_MAX_ROWS,
  NO_ORIENTATION,
  fileChartFromTopFirst,
  orientMatrix,
  type ChartOrientation,
  type FileChart,
} from '../../file'
import { decodePhotoFile, type DecodedPhoto } from '../../lib/photo-image'
import { analyzeChartImage, type ChartAnalysis, type RgbaImage } from '../../lib/vision'
import { documentName } from '../../state/file-studio'

/** A picture already decoded elsewhere (the mosaic photo converter), to be read here at once. */
export interface ImportSeed {
  source: DecodedPhoto
  fileName: string
}

interface FileImportProps {
  initial?: ImportSeed
  onUse: (chart: FileChart) => void
  onCancel: () => void
}

function pixels(decoded: DecodedPhoto): RgbaImage {
  const ctx = decoded.canvas.getContext('2d')
  if (!ctx) throw new Error('O navegador não conseguiu abrir a área de imagem.')
  const data = ctx.getImageData(0, 0, decoded.canvas.width, decoded.canvas.height)
  return { width: data.width, height: data.height, data: data.data }
}

type Size = { cols: number; rows: number }

/** One finished analysis, with the inputs it was made from: only a result for the current inputs is fresh. */
interface AnalysisResult {
  image: RgbaImage
  inkBias: number
  manual: Size | null
  analysis: ChartAnalysis | null
  error: string | null
}

function sameSize(a: Size | null, b: Size | null): boolean {
  return a === b || (!!a && !!b && a.cols === b.cols && a.rows === b.rows)
}

const HEX = /^#[0-9a-f]{6}$/
/** The sensitivity slider re-reads the whole picture: only once it rests this long (ms). */
const SLIDER_SETTLE = 150

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

function orientationLabel({ rotate180, mirror }: ChartOrientation): string {
  return `${rotate180 ? ', girada 180°' : ''}${mirror ? ', espelhada' : ''}`
}

function ReferencePreview({ source, crop, orientation }: { source: DecodedPhoto; crop: ChartAnalysis['crop'] | null; orientation: ChartOrientation }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    canvas.width = source.canvas.width
    canvas.height = source.canvas.height
    // Shown the way it will be read: half a turn reverses both axes, a mirror only the horizontal one.
    const sx = orientation.rotate180 !== orientation.mirror ? -1 : 1
    const sy = orientation.rotate180 ? -1 : 1
    ctx.setTransform(sx, 0, 0, sy, sx < 0 ? canvas.width : 0, sy < 0 ? canvas.height : 0)
    ctx.drawImage(source.canvas, 0, 0)
    if (crop) {
      // The sampled region, framed in gold.
      const w = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) / 220))
      ctx.strokeStyle = '#b7915d'
      ctx.lineWidth = w
      ctx.setLineDash([w * 3, w * 2])
      ctx.strokeRect(crop.x, crop.y, crop.width, crop.height)
    }
  }, [source, crop, orientation])
  return <canvas ref={ref} role="img" aria-label={`Imagem de referência importada${orientationLabel(orientation)}`} />
}

function ResultPreview({ analysis, ink, invert }: { analysis: ChartAnalysis; ink: boolean[][]; invert: boolean }) {
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
      for (let j = 0; j < analysis.cols; j++) if (ink[i][j] !== invert) ctx.fillRect(j * cell, i * cell, cell, cell)
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
  }, [analysis, ink, invert])
  return <canvas ref={ref} role="img" aria-label={`Gráfico lido: ${analysis.cols} × ${analysis.rows} quadradinhos`} />
}

export function FileImport({ initial, onUse, onCancel }: FileImportProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const [seeded] = useState(() => {
    if (!initial) return { image: null, error: null }
    try {
      return { image: pixels(initial.source), error: null }
    } catch (err) {
      return { image: null, error: message(err) }
    }
  })
  const [source, setSource] = useState<DecodedPhoto | null>(seeded.image ? initial!.source : null)
  const [image, setImage] = useState<RgbaImage | null>(seeded.image)
  const [fileName, setFileName] = useState(seeded.image ? initial!.fileName : '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(seeded.error)
  const [invert, setInvert] = useState(false)
  const [orientation, setOrientation] = useState<ChartOrientation>(NO_ORIENTATION)
  /** Slider position (right = more fechados); `inkBias` follows it once it settles. */
  const [biasDraft, setBiasDraft] = useState(0)
  const [inkBias, setInkBias] = useState(0)
  const [manual, setManual] = useState<Size | null>(null)
  /** The grid's own cell counts, when a grid was found; kept while a corrected size is read. */
  const [detected, setDetected] = useState<Size | null>(null)
  const [sizeDraft, setSizeDraft] = useState<{ cols: string; rows: string }>({ cols: '', rows: '' })

  useEffect(() => () => {
    request.current++
  }, [])

  // Busy is known in the same render as the change that asks for a new analysis, so the spinner
  // and the disabled controls paint before the (synchronous) analysis takes the main thread.
  // The analysis biases towards ink; with fechado/aberto swapped, more fechados means less ink.
  const analysisBias = invert ? -inkBias : inkBias
  const current = result && result.image === image ? result : null
  const fresh = !!current && current.inkBias === analysisBias && sameSize(current.manual, manual)
  const settling = biasDraft !== inkBias
  const analysing = !!image && (!fresh || settling)
  const analysis = current?.analysis ?? null

  // Analysis runs after a frame. A newer change cancels a pending run, and a result only counts
  // as fresh when it was made from the current inputs, so an older result never wins.
  useEffect(() => {
    if (!settling) return
    const timer = setTimeout(() => setInkBias(biasDraft), SLIDER_SETTLE)
    return () => clearTimeout(timer)
  }, [biasDraft, settling])

  useEffect(() => {
    if (!image || fresh) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        if (cancelled) return
        let next: AnalysisResult
        try {
          next = { image, inkBias: analysisBias, manual, analysis: analyzeChartImage(image, { inkBias: analysisBias, ...(manual ?? {}) }), error: null }
        } catch (err) {
          next = { image, inkBias: analysisBias, manual, analysis: null, error: message(err) }
        }
        if (cancelled) return
        setResult(next)
        if (!manual && next.analysis) {
          const { mode, cols, rows } = next.analysis
          setDetected(mode === 'grid' ? { cols, rows } : null)
          setSizeDraft({ cols: String(cols), rows: String(rows) })
        }
      }, 0)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [image, analysisBias, manual, fresh])

  const orientedInk = useMemo(() => (analysis ? orientMatrix(analysis.ink, orientation) : null), [analysis, orientation])

  async function loadFile(file: File | undefined) {
    if (!file) return
    const id = ++request.current
    setLoading(true)
    setError(null)
    try {
      const decoded = await decodePhotoFile(file)
      if (id !== request.current) return
      const read = pixels(decoded)
      setSource(decoded)
      setFileName(file.name)
      setResult(null)
      setManual(null)
      setDetected(null)
      setInvert(false)
      setOrientation(NO_ORIENTATION)
      setInkBias(0)
      setBiasDraft(0)
      setImage(read)
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

  function restoreDetectedSize() {
    if (!detected) return
    setManual(null)
    setSizeDraft({ cols: String(detected.cols), rows: String(detected.rows) })
  }

  function toggleOrientation(key: keyof ChartOrientation) {
    setOrientation((previous) => ({ ...previous, [key]: !previous[key] }))
  }

  function use() {
    if (!analysis || !orientedInk || analysing) return
    try {
      onUse(
        fileChartFromTopFirst(orientedInk, {
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

  const gridFound = detected !== null
  const sizeInvalid = !!analysis && !validSize(sizeDraft)
  const shownError = error ?? current?.error ?? null

  const sizeFields = (
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
  )

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
        <button type="button" className="file-button" onClick={() => fileInput.current?.click()} disabled={loading || analysing}>
          <Upload size={16} aria-hidden="true" />
          {source ? 'Trocar imagem' : 'Escolher imagem'}
        </button>
      </div>

      {source && (
        <>
          <div className="file-import-compare">
            <figure>
              <figcaption><span>01</span> Referência</figcaption>
              <div className="file-import-stage"><ReferencePreview source={source} crop={analysis?.crop ?? null} orientation={orientation} /></div>
            </figure>
            <figure>
              <figcaption><span>02</span> Leitura em filé</figcaption>
              <div className={`file-import-stage${analysing && analysis ? ' is-stale' : ''}`} aria-busy={analysing}>
                {analysis && orientedInk && <ResultPreview analysis={analysis} ink={orientedInk} invert={invert} />}
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
            <div className="file-import-controls" aria-busy={analysing}>
              <p className={`file-import-status${gridFound ? ' is-found' : ''}`} aria-live="polite">
                <ScanLine size={17} aria-hidden="true" />
                {detected
                  ? `Grade detectada: ${detected.cols} × ${detected.rows} quadradinhos`
                  : 'Grade não encontrada — informe o tamanho'}
              </p>
              {detected && manual && !sameSize(manual, detected) && (
                <p className="file-hint">{`Lendo como ${manual.cols} × ${manual.rows} quadradinhos (tamanho corrigido).`}</p>
              )}
              {gridFound ? (
                <details className="file-size-fix">
                  <summary>Corrigir tamanho</summary>
                  <p className="file-hint">Se a contagem não bate com o gráfico, informe colunas e carreiras: a grade é lida de novo nesse tamanho.</p>
                  {sizeFields}
                  <button type="button" className="file-button" disabled={!manual || analysing} onClick={restoreDetectedSize}>
                    Usar tamanho detectado
                  </button>
                </details>
              ) : (
                sizeFields
              )}
              <div className="file-orient" role="group" aria-label="Orientação do gráfico">
                <button type="button" className="file-button" aria-pressed={orientation.rotate180} disabled={analysing} onClick={() => toggleOrientation('rotate180')}>
                  <RotateCw size={16} aria-hidden="true" />
                  Girar 180°
                </button>
                <button type="button" className="file-button" aria-pressed={orientation.mirror} disabled={analysing} onClick={() => toggleOrientation('mirror')}>
                  <FlipHorizontal2 size={16} aria-hidden="true" />
                  Espelhar
                </button>
                <small className="file-hint">Para print de cabeça para baixo (números ou marca d’água invertidos) ou gráfico espelhado.</small>
              </div>
              <label className="file-check">
                <input type="checkbox" checked={invert} disabled={analysing} onChange={(event) => setInvert(event.target.checked)} />
                Inverter fechado/aberto
              </label>
              <label className="file-field file-range">
                <span>
                  Sensibilidade <output>{biasDraft > 0 ? '+' : ''}{biasDraft.toFixed(2)}</output>
                </span>
                <input
                  type="range"
                  aria-label="Sensibilidade"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={biasDraft}
                  onChange={(event) => setBiasDraft(Number(event.target.value))}
                />
                <small>Para a esquerda, menos quadradinhos fechados; para a direita, mais (também com fechado/aberto invertidos).</small>
              </label>
            </div>
          )}
        </>
      )}

      {shownError && <p role="alert" className="file-error">{shownError}</p>}

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
