import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, Crop, Grid3x3, ImagePlus, LoaderCircle, ScanLine, ShieldCheck, Sparkles, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { COL_OPTIONS, ROW_OPTIONS, type DesignData, type Yarn } from '../core'
import { decodePhotoFile, samplePhoto, type DecodedPhoto } from '../lib/photo-image'
import { automaticPhotoThreshold, convertChartAnalysis, convertPhotoPixels, type PhotoFit, type PhotoPatternResult } from '../lib/photo-pattern'
import { analyzeChartImage, findContentBox, type AnalyzeOptions, type ChartAnalysis, type RgbaImage } from '../lib/vision'
import { PatternPreview } from './PatternPreview'
import './photo-pattern.css'

interface PhotoPatternDialogProps {
  onClose: () => void
  onApply: (design: DesignData) => void
  colors: Record<Yarn, string>
  /** Offered when a chart is detected: the filé studio reproduces it exactly. */
  onOpenFileStudio?: () => void
}

type ReadAs = 'chart' | 'photo'
type SizeMode = 'auto' | 'manual'

interface AnalysisRequest {
  key: string
  options: AnalyzeOptions
}

/** Analyses of the current image, by request key; errors are kept so they are not retried in a loop. */
interface AnalysisCache {
  image: RgbaImage | null
  byKey: Record<string, ChartAnalysis | Error>
  latest: string | null
}

const BASE_KEY = 'base'

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível preparar esta foto. Tente outra imagem.'
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function SourcePreview({ source }: { source: DecodedPhoto }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = source.canvas.width
    canvas.height = source.canvas.height
    canvas.getContext('2d')?.drawImage(source.canvas, 0, 0)
  }, [source])
  return <canvas ref={ref} role="img" aria-label="Fotografia original selecionada" />
}

export function PhotoPatternDialog({ onClose, onApply, colors, onOpenFileStudio }: PhotoPatternDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const fileRequest = useRef(0)
  const reducedMotion = useReducedMotion()
  const [source, setSource] = useState<DecodedPhoto | null>(null)
  const [fileName, setFileName] = useState('')
  const [name, setName] = useState('Meu mosaico fotográfico')
  const [rows, setRows] = useState(49)
  const [cols, setCols] = useState(48)
  const [fit, setFit] = useState<PhotoFit>('contain')
  const [threshold, setThreshold] = useState(128)
  const [autoContrast, setAutoContrast] = useState(true)
  const [invert, setInvert] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [readAs, setReadAs] = useState<ReadAs>('chart')
  const [sizeMode, setSizeMode] = useState<SizeMode>('auto')
  const [rowsPerChartRow, setRowsPerChartRow] = useState<1 | 2>(1)
  const [inkBias, setInkBias] = useState(0)
  const [analyses, setAnalyses] = useState<AnalysisCache>({ image: null, byKey: {}, latest: null })

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (element && !element.open) element.showModal()
    return () => {
      fileRequest.current++
      element?.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  // The pixels are read once per photo; every analysis below reuses them.
  const image = useMemo<RgbaImage | null>(() => {
    if (!source) return null
    return source.canvas.getContext('2d')?.getImageData(0, 0, source.canvas.width, source.canvas.height) ?? null
  }, [source])

  const lookup = (key: string | null): ChartAnalysis | Error | undefined =>
    key !== null && image && analyses.image === image ? analyses.byKey[key] : undefined
  const baseEntry = lookup(BASE_KEY)
  const base = baseEntry instanceof Error ? undefined : baseEntry
  const chartDetected = base?.mode === 'grid'
  const readsChart = chartDetected && readAs === 'chart'
  const manualRows = Math.max(3, rows - 2) // the border rows come on top of the resampled chart

  const requests = useMemo<AnalysisRequest[]>(() => {
    if (!image) return []
    const list: AnalysisRequest[] = [{ key: BASE_KEY, options: {} }]
    if (readsChart && sizeMode === 'manual') {
      list.push({ key: `size:${cols}x${manualRows}:${inkBias}`, options: { cols, rows: manualRows, inkBias } })
    } else if (readsChart && inkBias !== 0) {
      list.push({ key: `bias:${inkBias}`, options: { inkBias } })
    }
    return list
  }, [image, readsChart, sizeMode, cols, manualRows, inkBias])
  const missing = requests.filter((request) => lookup(request.key) === undefined)
  const missingKey = missing.map((request) => request.key).join('|')
  const analyzing = missing.length > 0

  useEffect(() => {
    if (!image || !missing.length) return
    // Let the spinner paint before the (synchronous) analysis takes the main thread.
    let timer = 0
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        const computed: Record<string, ChartAnalysis | Error> = {}
        for (const request of missing) {
          try {
            computed[request.key] = analyzeChartImage(image, request.options)
          } catch (err) {
            computed[request.key] = new Error(message(err))
          }
        }
        setAnalyses((previous) => ({
          image,
          byKey: previous.image === image ? { ...previous.byKey, ...computed } : computed,
          latest: missing.at(-1)!.key,
        }))
      }, 0)
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
    // missingKey captures `missing`; the array itself is new on every render.
  }, [image, missingKey])

  // Photo path: today's sampling, after trimming uniform page margins around the content.
  const photoCanvas = useMemo(() => {
    if (!source || !image || !base || readsChart) return null
    const box = base.mode === 'resample' && !base.grid ? base.crop : findContentBox(image)
    if (box.x === 0 && box.y === 0 && box.width === source.canvas.width && box.height === source.canvas.height) return source.canvas
    const canvas = document.createElement('canvas')
    canvas.width = box.width
    canvas.height = box.height
    canvas.getContext('2d')?.drawImage(source.canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
    return canvas
  }, [source, image, base, readsChart])

  const sampled = useMemo(() => {
    if (!photoCanvas) return { pixels: null, error: null }
    try {
      return { pixels: samplePhoto(photoCanvas, rows, cols, fit), error: null }
    } catch (err) {
      return { pixels: null, error: message(err) }
    }
  }, [photoCanvas, rows, cols, fit])

  const automaticThreshold = useMemo(() => sampled.pixels ? automaticPhotoThreshold(sampled.pixels) : 128, [sampled.pixels])
  const effectiveThreshold = autoContrast ? automaticThreshold : threshold

  // Chart path: the wanted analysis, or the previous one while a new one is being read.
  const wantedKey = readsChart ? requests.at(-1)!.key : null
  const wantedEntry = lookup(wantedKey)
  const staleEntry = wantedEntry === undefined && readsChart ? lookup(analyses.latest) : undefined
  const chartEntry = wantedEntry ?? staleEntry
  const chartAnalysis = chartEntry instanceof Error ? undefined : chartEntry
  const chartRowsPerRow = sizeMode === 'manual' ? 1 : rowsPerChartRow

  const converted = useMemo<{ result: PhotoPatternResult | null; error: string | null }>(() => {
    try {
      if (readsChart) {
        if (!chartAnalysis) return { result: null, error: null }
        return { result: convertChartAnalysis(chartAnalysis, { name, colors, invert, rowsPerChartRow: chartRowsPerRow }), error: null }
      }
      if (!sampled.pixels) return { result: null, error: null }
      return { result: convertPhotoPixels(sampled.pixels, { name, colors, threshold: effectiveThreshold, invert }), error: null }
    } catch (err) {
      return { result: null, error: message(err) }
    }
  }, [readsChart, chartAnalysis, chartRowsPerRow, sampled.pixels, name, colors, effectiveThreshold, invert])
  const result = converted.result
  const analysisError = baseEntry instanceof Error ? baseEntry.message : wantedEntry instanceof Error ? wantedEntry.message : null
  const activeError = error || analysisError || (readsChart ? null : sampled.error) || converted.error
  const shownRows = result?.design.delta.length ?? rows
  const shownCols = result?.design.delta[0]?.length ?? cols

  async function loadFile(file: File | undefined) {
    if (!file) return
    const request = ++fileRequest.current
    setLoading(true)
    setError(null)
    try {
      const decoded = await decodePhotoFile(file)
      if (request !== fileRequest.current) return
      setSource(decoded)
      setFileName(file.name)
      const cleanName = [...file.name.replace(/\.[^.]+$/, '').replace(/[\p{Cc}\p{Cs}]/gu, '').trim()].slice(0, 85).join('')
      setName(cleanName ? `Estudo — ${cleanName}` : 'Meu mosaico fotográfico')
      setAutoContrast(true)
      setReadAs('chart')
      setSizeMode('auto')
      setRowsPerChartRow(1)
      setInkBias(0)
    } catch (err) {
      if (request === fileRequest.current) setError(message(err))
    } finally {
      if (request === fileRequest.current) setLoading(false)
    }
  }

  function dropPhoto(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    void loadFile(event.dataTransfer.files[0])
  }

  function chooseSize(nextRows: number, nextCols: number) {
    if (readsChart) setSizeMode('manual')
    setRows(nextRows)
    setCols(nextCols)
  }

  const yarnA = readsChart ? (invert ? 'quadradinhos cheios' : 'quadradinhos vazios e bordas') : `tons ${invert ? 'escuros' : 'claros'}`
  const yarnB = readsChart ? (invert ? 'quadradinhos vazios' : 'quadradinhos cheios') : `tons ${invert ? 'claros' : 'escuros'}`

  return (
    <dialog
      ref={dialog}
      className="photo-pattern-dialog"
      aria-labelledby="photo-pattern-title"
      aria-describedby="photo-pattern-description"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return
        // A native dialog makes the page inert, but some browsers still visit their chrome
        // when tabbing beyond the first/last control. Keep this studio sheet's loop explicit.
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]'))
          .filter((element) => element.tabIndex >= 0 && !element.hasAttribute('disabled') && element.getClientRects().length > 0 && !element.closest('[inert]'))
        const first = focusable[0]
        const last = focusable.at(-1)
        if (!first || !last) { event.preventDefault(); return }
        const current = document.activeElement
        if (event.shiftKey && (current === first || current === event.currentTarget)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (current === last || current === event.currentTarget)) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <motion.div initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
        <header className="photo-pattern-heading">
          <div>
            <p className="photo-pattern-eyebrow">CROCHET VICTORIOSO · LABORATÓRIO DE FIOS</p>
            <h2 id="photo-pattern-title">Da fotografia <em>ao fio.</em></h2>
            <p id="photo-pattern-description">Transforme uma referência em um motivo de mosaico com duas cores, pronto para editar e crochetar.</p>
          </div>
          <button type="button" className="photo-pattern-close" onClick={onClose} aria-label="Fechar conversor de foto"><X size={20} /></button>
        </header>

        <div className="photo-pattern-layout">
          <section className="photo-pattern-workbench" aria-label="Fotografia e prévia">
            <div
              className={`photo-pattern-drop${dragging ? ' is-dragging' : ''}${source ? ' has-photo' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
              onDrop={dropPhoto}
            >
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Selecionar foto de crochê" hidden onChange={(event) => { void loadFile(event.target.files?.[0]); event.target.value = '' }} />
              {loading ? <LoaderCircle size={30} className="photo-pattern-spinner" aria-hidden="true" /> : <ImagePlus size={source ? 21 : 34} strokeWidth={1.2} aria-hidden="true" />}
              <div className="photo-pattern-drop-copy">
                <strong>{loading ? 'Preparando os fios da sua imagem…' : source ? fileName : 'Uma foto. Mil possibilidades.'}</strong>
                <span>{source ? `${source.originalWidth} × ${source.originalHeight} px · processada neste dispositivo` : 'Arraste sua referência ou escolha um arquivo · PNG, JPEG, WebP · até 12 MB'}</span>
              </div>
              <button type="button" className="photo-pattern-secondary" onClick={() => fileInput.current?.click()} disabled={loading}><Upload size={15} />{source ? 'Trocar foto' : 'Escolher foto'}</button>
            </div>

            {chartDetected && base && (
              <div className="photo-pattern-detected">
                <p role="status"><Grid3x3 size={15} aria-hidden="true" /><span>{`Gráfico detectado: ${base.cols} × ${base.rows} quadradinhos`}</span></p>
                <div className="photo-pattern-segments" role="group" aria-label="Leitura da imagem">
                  <button type="button" onClick={() => setReadAs('chart')} aria-pressed={readAs === 'chart'}><Grid3x3 size={14} />Ler como gráfico</button>
                  <button type="button" onClick={() => setReadAs('photo')} aria-pressed={readAs === 'photo'}><ScanLine size={14} />Ler como foto</button>
                </div>
              </div>
            )}

            <AnimatePresence mode="wait" initial={false}>
              {source ? (
                <motion.div key="preview" className="photo-pattern-comparison" initial={{ opacity: reducedMotion ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: reducedMotion ? 1 : 0 }}>
                  <figure>
                    <figcaption><span>01</span> Sua referência</figcaption>
                    <div className="photo-pattern-image-stage"><SourcePreview source={source} /></div>
                    <p>A luz, os contornos, a inspiração.</p>
                  </figure>
                  <figure>
                    <figcaption><span>02</span> Seu mosaico</figcaption>
                    <div className="photo-pattern-image-stage photo-pattern-result-stage" aria-busy={loading || analyzing}>
                      {result && <PatternPreview design={result.design} rowAspect={1} className="photo-pattern-preview" label="Prévia do mosaico convertido" />}
                      {analyzing && <span className="photo-pattern-reading" role="status"><LoaderCircle size={22} className="photo-pattern-spinner" aria-hidden="true" />Lendo a imagem…</span>}
                    </div>
                    <p>{shownRows} carreiras · {shownCols} pontos por carreira</p>
                  </figure>
                </motion.div>
              ) : (
                <motion.div key="empty" className="photo-pattern-empty" initial={{ opacity: reducedMotion ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: reducedMotion ? 1 : 0 }}>
                  <div className="photo-pattern-empty-art" aria-hidden="true"><ScanLine size={37} strokeWidth={1} /><span /><Sparkles size={31} strokeWidth={1} /></div>
                  <h3>Encontre um novo ponto de partida.</h3>
                  <p>Fotografe a peça de frente, com boa luz e fundo simples. Desenhos planos, silhuetas e contrastes claros trazem os melhores motivos.</p>
                  <div className="photo-pattern-steps"><span>01 · Escolha</span><span>02 · Ajuste</span><span>03 · Crie</span></div>
                </motion.div>
              )}
            </AnimatePresence>

            {readsChart ? (
              <div className="photo-pattern-explanation">
                <Grid3x3 size={17} aria-hidden="true" />
                <div>
                  <p>O mosaico overlay adapta o gráfico às regras de pontos altos; para reproduzir um gráfico de filé exatamente, use o Estúdio de filé.</p>
                  {onOpenFileStudio && <button type="button" className="photo-pattern-secondary photo-pattern-file-studio" onClick={onOpenFileStudio}>Abrir no Estúdio de filé<ArrowRight size={14} /></button>}
                </div>
              </div>
            ) : (
              <p className="photo-pattern-explanation"><ScanLine size={17} aria-hidden="true" /><span>A foto vira uma <strong>aproximação editável em duas cores</strong>. Ela não revela a receita exata de pontos tridimensionais, a modelagem de uma peça ou pontos escondidos. As carreiras são adaptadas às regras do mosaico; revise a amostra antes de tecer.</span></p>
            )}
            {result && (
              <div className="photo-pattern-summary" aria-live="polite">
                <span><Check size={14} />{result.conflictCount === 0 ? 'Sem conflitos de pontos' : `${result.conflictCount} conflitos`}</span>
                <span>{result.doubleCrochets} pontos altos · {result.singleCrochets} pontos baixos</span>
                <span>{result.adaptedCells} células adaptadas às regras</span>
              </div>
            )}
          </section>

          <aside className="photo-pattern-controls" aria-label="Ajustes da conversão">
            <div className="photo-pattern-section-title"><span>SEU ESTUDO</span><Sparkles size={15} /></div>
            <label className="photo-pattern-field">Nome do padrão<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
            <div className="photo-pattern-dimensions">
              <label className="photo-pattern-field">Carreiras<select value={shownRows} onChange={(event) => chooseSize(Number(event.target.value), shownCols)}>{ROW_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label className="photo-pattern-field">Pontos por carreira<select value={shownCols} onChange={(event) => chooseSize(shownRows, Number(event.target.value))}>{COL_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            </div>
            {readsChart && sizeMode === 'manual' ? (
              <div className="photo-pattern-manual">
                <p className="photo-pattern-hint">Tamanho manual: o gráfico é redistribuído em {cols} × {manualRows} quadradinhos, mais as carreiras de borda.</p>
                <button type="button" className="photo-pattern-auto" onClick={() => setSizeMode('auto')}><Grid3x3 size={13} />Usar tamanho do gráfico</button>
              </div>
            ) : (
              <p className="photo-pattern-hint">{readsChart
                ? 'O tamanho segue o gráfico, com uma carreira de borda embaixo e outra em cima.'
                : 'Mais pontos preservam mais detalhes. A primeira e a última carreira são protegidas.'}</p>
            )}

            {readsChart ? (
              <>
                {sizeMode === 'auto' && (
                  <fieldset className="photo-pattern-fieldset"><legend>Altura</legend><div className="photo-pattern-segments">
                    <button type="button" onClick={() => setRowsPerChartRow(1)} aria-pressed={rowsPerChartRow === 1}>1 carreira por linha</button>
                    <button type="button" onClick={() => setRowsPerChartRow(2)} aria-pressed={rowsPerChartRow === 2}>2 carreiras por linha</button>
                  </div></fieldset>
                )}
                <label className="photo-pattern-field photo-pattern-range">Sensibilidade<output>{signed(Math.round(inkBias * 100))}</output><input type="range" aria-label="Sensibilidade" min="-100" max="100" step="5" value={Math.round(inkBias * 100)} onChange={(event) => setInkBias(Number(event.target.value) / 100)} /></label>
                <p className="photo-pattern-hint photo-pattern-range-hint">Para a direita, mais quadradinhos contam como cheios.</p>
              </>
            ) : (
              <>
                <fieldset className="photo-pattern-fieldset"><legend>Enquadramento</legend><div className="photo-pattern-segments">
                  <button type="button" onClick={() => setFit('contain')} aria-pressed={fit === 'contain'}><ScanLine size={15} />Foto inteira</button>
                  <button type="button" onClick={() => setFit('cover')} aria-pressed={fit === 'cover'}><Crop size={15} />Recorte central</button>
                </div></fieldset>

                <label className="photo-pattern-field photo-pattern-range">Contraste<output>{effectiveThreshold}</output><input type="range" aria-label="Contraste" min="0" max="255" step="1" value={effectiveThreshold} disabled={!source} onChange={(event) => { setAutoContrast(false); setThreshold(Number(event.target.value)) }} /></label>
                <button type="button" className="photo-pattern-auto" disabled={!source} aria-pressed={autoContrast} onClick={() => setAutoContrast(true)}><Sparkles size={13} />Contraste automático{autoContrast && <Check size={13} />}</button>
              </>
            )}
            <label className="photo-pattern-invert"><input type="checkbox" checked={invert} onChange={(event) => setInvert(event.target.checked)} />Inverter claro e escuro</label>
            <div className="photo-pattern-yarns"><span><i style={{ background: colors.main }} />Fio A · {yarnA}</span><span><i style={{ background: colors.pattern }} />Fio B · {yarnB}</span></div>

            {result && <details className="photo-pattern-instructions"><summary>Instruções por carreira ({shownRows})</summary><p>Ler da direita para a esquerda, sem virar. sc = ponto baixo; dc = ponto alto sobreposto.</p><ol>{result.instructions.map((line, index) => <li key={index}>{line.replace(/^Row (\d+):/, 'Carreira $1:')}</li>)}</ol></details>}
            <p className="photo-pattern-privacy"><ShieldCheck size={15} />Sua foto fica neste navegador. Nenhum envio a servidores ou serviços de IA.</p>
          </aside>
        </div>

        {activeError && <p role="alert" className="photo-pattern-error">{activeError}</p>}
        <footer className="photo-pattern-footer"><p>Leve o motivo ao ateliê para refinar, salvar e exportar.</p><div><button type="button" className="photo-pattern-secondary" onClick={onClose}>Cancelar</button><button type="button" className="photo-pattern-apply" disabled={!result || loading || analyzing || !name.trim() || result.conflictCount > 0} onClick={() => result && onApply(result.design)}>Usar este mosaico<ArrowRight size={16} /></button></div></footer>
      </motion.div>
    </dialog>
  )
}
