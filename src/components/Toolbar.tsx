import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDownToLine,
  Camera,
  ArrowLeftRight,
  ChevronDown,
  FileJson,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Wind,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { COL_OPTIONS, ROW_OPTIONS, YARN_LABEL, type Yarn } from '../core'

interface ToolbarProps {
  rows: number
  cols: number
  onResize: (rows: number, cols: number) => void
  colors: Record<Yarn, string>
  onColorChange: (yarn: Yarn, color: string) => void
  onSwapColors: () => void
  onClear: () => void
  onDownloadCsv: () => void
  onExportJson: () => void
  onImportFile: (file: File) => void
  onTemplates: () => void
  onPhoto: () => void
}

const palettes = [
  { name: 'Bosque', colors: ['#f3ead8', '#0f766e'], names: ['Linho natural', 'Verde floresta'] },
  { name: 'Terracota', colors: ['#f1ddca', '#a85943'], names: ['Aveia', 'Barro queimado'] },
  { name: 'Índigo', colors: ['#ece8dc', '#354665'], names: ['Algodão cru', 'Índigo noturno'] },
  { name: 'Colheita', colors: ['#f0e6ce', '#90723f'], names: ['Cru suave', 'Semente de mostarda'] },
]
const spring = { type: 'spring' as const, stiffness: 300, damping: 30 }

export function Toolbar(props: ToolbarProps) {
  const { rows, cols, onResize, colors, onColorChange } = props
  const fileInput = useRef<HTMLInputElement>(null)
  const [activeYarn, setActiveYarn] = useState<Yarn>('pattern')
  // Descriptive labels are session-only studio notes: the versioned document remains unchanged.
  const [names, setNames] = useState<Record<Yarn, string>>({
    main: 'Linho natural',
    pattern: 'Verde floresta',
  })
  const [paletteOpen, setPaletteOpen] = useState(false)

  const applyPalette = (palette: (typeof palettes)[number]) => {
    onColorChange('main', palette.colors[0])
    onColorChange('pattern', palette.colors[1])
    setNames({ main: palette.names[0], pattern: palette.names[1] })
    setPaletteOpen(false)
  }

  return (
    <aside className="construction-sidebar" aria-label="Controles do estúdio">
      <section className="control-section">
        <div className="section-label">
          <SlidersHorizontal size={14} />
          <h2>Construção do tecido</h2>
          <span>01</span>
        </div>
        <div className="dimension-fields">
          <label>
            <span>Carreiras</span>
            <div className="select-wrap">
              <select value={rows} onChange={(e) => onResize(Number(e.target.value), cols)}>
                {ROW_OPTIONS.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <ChevronDown size={13} />
            </div>
          </label>
          <span className="dimension-times">×</span>
          <label>
            <span>Pontos</span>
            <div className="select-wrap">
              <select value={cols} onChange={(e) => onResize(rows, Number(e.target.value))}>
                {COL_OPTIONS.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <ChevronDown size={13} />
            </div>
          </label>
        </div>
        <p className="field-note">
          Dois fios. Um ritmo contínuo.
          <br />
          Carreiras ímpares equilibram as bordas.
        </p>
        <div className="construction-facts">
          <span>Técnica</span>
          <strong>Overlay mosaic</strong>
          <span>Sentido</span>
          <strong>Direita → esquerda</strong>
        </div>
      </section>

      <section className="control-section yarn-section">
        <div className="section-label">
          <Wind size={15} />
          <h2>Seu cesto de fios</h2>
          <span>02</span>
        </div>
        <p className="section-intro">Encontre o seu par perfeito.</p>
        <div className="yarn-basket" role="group" aria-label="Cesto de fios">
          {(['main', 'pattern'] as Yarn[]).map((yarn) => (
            <button
              key={yarn}
              className={`yarn-card ${activeYarn === yarn ? 'is-threaded' : ''}`}
              onClick={() => setActiveYarn(yarn)}
              aria-pressed={activeYarn === yarn}
              aria-label={`Selecionar fio ${YARN_LABEL[yarn]}`}
            >
              <span className="yarn-skein" style={{ '--yarn-color': colors[yarn] } as React.CSSProperties}>
                <span />
                <span />
                <span />
                <i>{YARN_LABEL[yarn]}</i>
              </span>
              <span className="yarn-card-name">{names[yarn]}</span>
              <span className="yarn-card-role">{yarn === 'main' ? 'Base · A' : 'Desenho · B'}</span>
              {activeYarn === yarn && (
                <motion.span layoutId="threaded-yarn" className="threaded-dot" transition={spring} />
              )}
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeYarn}
            className="yarn-detail"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={spring}
          >
            <label className="yarn-name-label">
              <span>Fio {YARN_LABEL[activeYarn]} · nome</span>
              <input
                value={names[activeYarn]}
                maxLength={32}
                aria-label={`Fio ${YARN_LABEL[activeYarn]} nome`}
                onChange={(e) => setNames({ ...names, [activeYarn]: e.target.value })}
              />
            </label>
            <label className="yarn-color-label">
              <input
                aria-label={`Fio ${YARN_LABEL[activeYarn]} cor`}
                type="color"
                value={colors[activeYarn]}
                onChange={(e) => onColorChange(activeYarn, e.target.value)}
              />
              <span>{colors[activeYarn].toUpperCase()}</span>
              <span>Editar cor</span>
            </label>
          </motion.div>
        </AnimatePresence>
        <div className="palette-actions">
          <button
            className="text-button"
            onClick={() => setPaletteOpen(!paletteOpen)}
            aria-expanded={paletteOpen}
          >
            <Sparkles size={13} /> Paletas especiais <ChevronDown size={12} />
          </button>
          <button
            className="icon-button"
            aria-label="Trocar cores dos fios"
            title="Trocar cores dos fios"
            onClick={props.onSwapColors}
          >
            <ArrowLeftRight size={14} />
          </button>
        </div>
        <AnimatePresence>
          {paletteOpen && (
            <motion.div
              className="palette-options"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={spring}
            >
              {palettes.map((palette) => (
                <button key={palette.name} onClick={() => applyPalette(palette)}>
                  <span className="palette-pair">
                    {palette.colors.map((color) => (
                      <i key={color} style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  {palette.name}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <p className="field-note">
          A carreira define o fio de trabalho.
          <br />
          Os nomes são notas desta sessão.
        </p>
      </section>

      <section className="control-section blueprint-section">
        <div className="section-label">
          <FileJson size={14} />
          <h2>Arquivo do padrão</h2>
          <span>03</span>
        </div>
        <button className="file-action" aria-label="Exportar JSON" onClick={props.onExportJson}>
          <ArrowDownToLine size={15} />
          <span>
            Exportar padrão<small>Documento JSON editável</small>
          </span>
          <span className="file-type">.json</span>
        </button>
        <button className="file-action" aria-label="Exportar CSV" onClick={props.onDownloadCsv}>
          <ArrowDownToLine size={15} />
          <span>
            Exportar gráfico<small>Pontos para o seu caderno</small>
          </span>
          <span className="file-type">.csv</span>
        </button>
        <button className="file-action" onClick={() => fileInput.current?.click()}>
          <Upload size={15} />
          <span>
            Importar padrão<small>Reabra uma criação salva</small>
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Importar arquivo de padrão"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) props.onImportFile(file)
          }}
        />
        <button className="sample-button" onClick={props.onTemplates}>
          <Sparkles size={14} /> Explorar os 20 modelos <span>↗</span>
        </button>
        <button className="sample-button photo-mini" onClick={props.onPhoto}>
          <Camera size={14} /> Foto em pontos <span>↗</span>
        </button>
      </section>
      <button className="clear-button" onClick={props.onClear}>
        <Scissors size={14} /> Limpar a bancada
      </button>
      <p className="sidebar-footnote">CRIADO PARA AS SUAS MÃOS.</p>
    </aside>
  )
}
