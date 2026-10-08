import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { Eraser, Hand, Maximize2, Minus, Plus } from 'lucide-react'
import {
  cellYarn,
  conflictOutline,
  otherYarn,
  resolveClick,
  stitchNumber,
  stripe,
  YARN_LABEL,
  type Matrix,
  type View,
  type Yarn,
} from '../core'
import { stitchLine, zoomAt, type CanvasCell } from '../lib/canvas'
import './canvas.css'

const CELL = 27
const DRIVER = 67
const HEADER = 28
const FOOTER = 14
const NONE: never[] = []
const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 }
type Tool = 'hook' | 'erase' | 'hand'

interface MosaicGridProps {
  view: View
  delta: Matrix
  X: Matrix
  conflictX: Matrix
  colors: Record<Yarn, string>
  onCellClick: (r: number, c: number) => void
  /** Visible coordinates; the editor resolves them through resolveClick before changing delta. */
  onPaintCells?: (cells: CanvasCell[], value: boolean) => void
  onStrokeStart?: () => void
  onStrokeEnd?: () => void
}

const x = (c: number) => DRIVER + (c - 1) * CELL
const rowHeight = (view: View) => (view === 'simulation' ? 23 : CELL)
const y = (r: number, rows: number, height: number) => HEADER + (rows - r) * height

function sameRow<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((value, i) => value === b[i]))
}

function contrastInk(color: string): string {
  const value = Number.parseInt(color.slice(1), 16)
  return (value >> 16) * 299 + ((value >> 8) & 255) * 587 + (value & 255) * 114 > 145000
    ? '#544b3d'
    : '#fffdf6'
}

function HookIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m6 20 9-12c4 1 5-2 3-4-2-2-5 0-4 2L4 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m7 14 3 2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

const ColumnNumbers = memo(function ColumnNumbers({ cols }: { cols: number }) {
  return (
    <g className="grid-column-numbers" aria-hidden="true">
      {Array.from({ length: cols }, (_, j) => (
        <text key={j} x={x(j + 1) + CELL / 2} y={HEADER - 10} textAnchor="middle">
          {stitchNumber(j + 1, cols)}
        </text>
      ))}
    </g>
  )
})

interface GridRowProps {
  r: number
  rows: number
  cols: number
  view: View
  colors: Record<Yarn, string>
  locked: boolean
  yarns: Yarn[]
  xs: boolean[]
  uid: string
  reduced: boolean
}

// A click derives fresh matrices; comparing each row's contents keeps 14,280 cells responsive.
const GridRow = memo(
  function GridRow({ r, rows, cols, view, colors, locked, yarns, xs, uid, reduced }: GridRowProps) {
    const height = rowHeight(view)
    const simulation = view === 'simulation'
    const yarn = stripe(r)
    return (
      <motion.g
        role="row"
        aria-rowindex={rows - r + 1}
        initial={false}
        animate={{ y: y(r, rows, height), opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={reduced ? { duration: 0 } : SPRING}
      >
        <g className="grid-row-driver" aria-hidden="true">
          <text x={19} y={height / 2 + 3} textAnchor="end">
            {String(r).padStart(2, '0')}
          </text>
          <rect x={28} y={height / 2 - 7} width={25} height={14} rx={7} fill={colors[yarn]} />
          <text
            x={40.5}
            y={height / 2 + 3}
            textAnchor="middle"
            className="grid-driver-letter"
            fill={contrastInk(colors[yarn])}
          >
            {YARN_LABEL[yarn]}
          </text>
        </g>
        {Array.from({ length: cols }, (_, j) => (
          <rect
            key={j}
            id={`${uid}-cell-${r}-${j + 1}`}
            role="gridcell"
            aria-colindex={j + 1}
            aria-label={`Carreira ${r}, ponto ${stitchNumber(j + 1, cols)}${locked ? ', borda protegida' : ''}${xs[j] ? ', ponto alto' : ''}`}
            data-r={r}
            data-c={j + 1}
            x={x(j + 1)}
            y={0}
            width={CELL}
            height={height}
            rx={simulation ? 1.5 : 0}
            fill={simulation ? colors[yarns[j]] : '#fcfaf5'}
            className={`grid-cell ${simulation ? 'grid-cell-simulation' : 'grid-cell-chart'}${locked ? ' grid-cell-locked' : ''}`}
          />
        ))}
        {simulation ? (
          <rect
            x={DRIVER}
            y={0}
            width={cols * CELL}
            height={height}
            fill={`url(#${uid}-fiber)`}
            pointerEvents="none"
          />
        ) : (
          xs.map(
            (on, j) =>
              on && (
                <path
                  key={j}
                  d={`M${x(j + 1) + 8} 8l11 11m0-11L${x(j + 1) + 8} 19`}
                  className="grid-cross-stitch"
                  pointerEvents="none"
                />
              ),
          )
        )}
        {locked && (
          <rect
            x={DRIVER}
            y={0}
            width={cols * CELL}
            height={height}
            fill={`url(#${uid}-locked)`}
            opacity={simulation ? 0.11 : 0.5}
            pointerEvents="none"
          />
        )}
      </motion.g>
    )
  },
  (a, b) =>
    a.r === b.r &&
    a.rows === b.rows &&
    a.cols === b.cols &&
    a.view === b.view &&
    a.colors === b.colors &&
    a.locked === b.locked &&
    a.reduced === b.reduced &&
    a.uid === b.uid &&
    sameRow(a.yarns, b.yarns) &&
    sameRow(a.xs, b.xs),
)

const OutlineRow = memo(
  function OutlineRow({
    r,
    rows,
    height,
    cells,
  }: {
    r: number
    rows: number
    height: number
    cells: boolean[]
  }) {
    return (
      <g pointerEvents="none">
        {cells.map(
          (on, j) =>
            on && (
              <rect
                key={j}
                x={x(j + 1) + 2}
                y={y(r, rows, height) + 2}
                width={CELL - 4}
                height={height - 4}
                rx={3}
                className="grid-conflict"
              />
            ),
        )}
      </g>
    )
  },
  (a, b) => a.r === b.r && a.rows === b.rows && a.height === b.height && sameRow(a.cells, b.cells),
)

const RaisedStitches = memo(
  function RaisedStitches({
    r,
    rows,
    cells,
    color,
  }: {
    r: number
    rows: number
    cells: boolean[]
    color: string
  }) {
    const top = y(r, rows, 23)
    return (
      <g pointerEvents="none">
        {cells.map(
          (on, j) =>
            on && (
              <g key={j}>
                <path
                  d={`M${x(j + 1) + 6} ${top + 9}C${x(j + 1) + 7} ${top + 20},${x(j + 1) + 8} ${top + 46},${x(j + 1) + 13.5} ${top + 49}C${x(j + 1) + 19} ${top + 46},${x(j + 1) + 20} ${top + 20},${x(j + 1) + 21} ${top + 9}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={8}
                  strokeLinecap="round"
                />
                <path
                  d={`M${x(j + 1) + 6} ${top + 9}Q${x(j + 1) + 9} ${top + 45},${x(j + 1) + 13.5} ${top + 49}Q${x(j + 1) + 18} ${top + 45},${x(j + 1) + 21} ${top + 9}`}
                  fill="none"
                  stroke="#fff"
                  strokeOpacity={0.27}
                  strokeWidth={1.4}
                  strokeLinecap="round"
                />
              </g>
            ),
        )}
      </g>
    )
  },
  (a, b) => a.r === b.r && a.rows === b.rows && a.color === b.color && sameRow(a.cells, b.cells),
)

export function MosaicGrid({
  view,
  delta,
  X,
  conflictX,
  colors,
  onCellClick,
  onPaintCells,
  onStrokeStart,
  onStrokeEnd,
}: MosaicGridProps) {
  const uid = useId().replace(/:/g, '')
  const rows = delta.length
  const cols = delta[0].length
  const height = rowHeight(view)
  const width = DRIVER + cols * CELL + 10
  const fabricHeight = HEADER + rows * height + FOOTER
  const reduced = Boolean(useReducedMotion())
  const viewport = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [tool, setTool] = useState<Tool>('hook')
  const [space, setSpace] = useState(false)
  const [panning, setPanning] = useState(false)
  const [hover, setHover] = useState<CanvasCell | null>(null)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState<CanvasCell>({ r: 3, c: 1 })
  const [zoomLabel, setZoomLabel] = useState(100)
  const panX = useMotionValue(0)
  const panY = useMotionValue(0)
  const scale = useMotionValue(1)
  const gesture = useRef<
    | null
    | { kind: 'pan'; x: number; y: number; offsetX: number; offsetY: number }
    | { kind: 'paint'; last: CanvasCell; seen: Set<string>; value: boolean }
  >(null)
  const queued = useRef<CanvasCell[]>([])
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onPaintCells, onCellClick, onStrokeStart, onStrokeEnd })
  callbacks.current = { onPaintCells, onCellClick, onStrokeStart, onStrokeEnd }
  const yarns = useMemo(
    () => delta.map((row, i) => row.map((_, j) => cellYarn(delta, i + 1, j + 1))),
    [delta],
  )
  const outline = useMemo(() => conflictOutline(view, conflictX), [view, conflictX])
  const rowList = useMemo(() => Array.from({ length: rows }, (_, i) => rows - i), [rows])

  const changeZoom = useCallback(
    (next: number, point?: { x: number; y: number }) => {
      const element = viewport.current
      if (!element) return
      next = Math.max(0.05, Math.min(3.5, next))
      const anchor = point ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 }
      const offset = zoomAt(anchor, { x: panX.get(), y: panY.get() }, scale.get(), next)
      panX.set(offset.x)
      panY.set(offset.y)
      scale.set(next)
      setZoomLabel(Math.round(next * 100))
    },
    [panX, panY, scale],
  )

  const fit = useCallback(() => {
    const element = viewport.current
    if (!element) return
    const next = Math.max(
      0.05,
      Math.min(1.2, (element.clientWidth - 86) / width, (element.clientHeight - 118) / fabricHeight),
    )
    scale.set(next)
    panX.set((element.clientWidth - width * next) / 2 - 7)
    panY.set((element.clientHeight - fabricHeight * next) / 2 - 10)
    setZoomLabel(Math.round(next * 100))
  }, [width, fabricHeight, panX, panY, scale])

  useLayoutEffect(() => {
    fit()
    const observer = new ResizeObserver(fit)
    if (viewport.current) observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [fit])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = element.getBoundingClientRect()
      const deltaY =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
      changeZoom(scale.get() * Math.exp(-deltaY * 0.0015), {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [changeZoom, scale])

  const flush = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    const cells = queued.current
    queued.current = []
    const current = gesture.current
    if (!cells.length || current?.kind !== 'paint') return
    if (callbacks.current.onPaintCells) callbacks.current.onPaintCells(cells, current.value)
    else cells.forEach((cell) => callbacks.current.onCellClick(cell.r, cell.c))
  }, [])

  const endGesture = useCallback(() => {
    const painting = gesture.current?.kind === 'paint'
    flush()
    gesture.current = null
    setPanning(false)
    if (painting) callbacks.current.onStrokeEnd?.()
  }, [flush])

  useEffect(() => {
    setActive((previous) => ({ r: Math.min(previous.r, rows), c: Math.min(previous.c, cols) }))
    setHover(null)
    endGesture()
  }, [rows, cols, view, endGesture])

  useEffect(() => {
    const release = () => {
      setSpace(false)
      endGesture()
    }
    const keyup = (event: globalThis.KeyboardEvent) => {
      if (event.code === 'Space') setSpace(false)
    }
    window.addEventListener('blur', release)
    window.addEventListener('keyup', keyup)
    return () => {
      window.removeEventListener('blur', release)
      window.removeEventListener('keyup', keyup)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [endGesture])

  const locate = (clientX: number, clientY: number): CanvasCell | null => {
    const matrix = svg.current?.getScreenCTM()
    if (!matrix) return null
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    const c = Math.floor((point.x - DRIVER) / CELL) + 1
    const r = rows - Math.floor((point.y - HEADER) / height)
    return r >= 1 && r <= rows && c >= 1 && c <= cols ? { r, c } : null
  }

  const paint = (cell: CanvasCell) => {
    const current = gesture.current
    if (current?.kind !== 'paint') return
    for (const next of stitchLine(current.last, cell)) {
      const key = `${next.r}:${next.c}`
      if (!current.seen.has(key) && resolveClick(view, next.r, next.c, rows).ok) {
        current.seen.add(key)
        queued.current.push(next)
      }
    }
    current.last = cell
    if (frame.current === null) frame.current = requestAnimationFrame(flush)
  }

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return
    if (event.button !== 0 && event.button !== 1) return
    // Buttons are siblings of the interaction surface, so a tool click never paints the fabric.
    event.preventDefault()
    viewport.current?.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    if (space || tool === 'hand' || event.button === 1) {
      gesture.current = {
        kind: 'pan',
        x: event.clientX,
        y: event.clientY,
        offsetX: panX.get(),
        offsetY: panY.get(),
      }
      setPanning(true)
      return
    }
    const cell = locate(event.clientX, event.clientY)
    if (!cell) return
    setActive(cell)
    const target = resolveClick(view, cell.r, cell.c, rows)
    if (!target.ok) {
      onCellClick(cell.r, cell.c)
      return
    }
    callbacks.current.onStrokeStart?.()
    gesture.current = {
      kind: 'paint',
      last: cell,
      seen: new Set(),
      value: tool === 'erase' ? false : !delta[target.r - 1][target.c - 1],
    }
    paint(cell)
  }

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return
    const current = gesture.current
    if (current?.kind === 'pan') {
      panX.set(current.offsetX + event.clientX - current.x)
      panY.set(current.offsetY + event.clientY - current.y)
      return
    }
    const cell = locate(event.clientX, event.clientY)
    setHover((previous) => (previous?.r === cell?.r && previous?.c === cell?.c ? previous : cell))
    if (current?.kind === 'paint' && cell) paint(cell)
  }

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.code === 'Space') {
      event.preventDefault()
      setSpace(true)
      return
    }
    if (event.key === 'Escape') {
      endGesture()
      setHover(null)
      return
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      changeZoom(scale.get() * 1.2)
      return
    }
    if (event.key === '-') {
      event.preventDefault()
      changeZoom(scale.get() / 1.2)
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      fit()
      return
    }
    if (event.key.toLowerCase() === 'h') {
      setTool('hand')
      return
    }
    if (event.key.toLowerCase() === 'b') {
      setTool('hook')
      return
    }
    if (event.key.toLowerCase() === 'e') {
      setTool('erase')
      return
    }
    const offset = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key]
    if (offset) {
      event.preventDefault()
      const next = {
        r: Math.max(1, Math.min(rows, active.r + offset[0])),
        c: Math.max(1, Math.min(cols, active.c + offset[1])),
      }
      setActive(next)
      setHover(null)
      const element = viewport.current
      if (element) {
        const pixelX = panX.get() + (x(next.c) + CELL / 2) * scale.get()
        const pixelY = panY.get() + (y(next.r, rows, height) + height / 2) * scale.get()
        if (pixelX < 35 || pixelX > element.clientWidth - 35)
          panX.set(panX.get() + element.clientWidth / 2 - pixelX)
        if (pixelY < 55 || pixelY > element.clientHeight - 75)
          panY.set(panY.get() + element.clientHeight / 2 - pixelY)
      }
      return
    }
    if (event.key === 'Enter' || event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (event.repeat) return
      const target = resolveClick(view, active.r, active.c, rows)
      if (!target.ok) {
        onCellClick(active.r, active.c)
        return
      }
      callbacks.current.onStrokeStart?.()
      if (onPaintCells)
        onPaintCells(
          [active],
          event.key !== 'Enter' || tool === 'erase' ? false : !delta[target.r - 1][target.c - 1],
        )
      else onCellClick(active.r, active.c)
      callbacks.current.onStrokeEnd?.()
    }
  }

  const preview = hover ?? (focused ? active : null)
  const target = preview ? resolveClick(view, preview.r, preview.c, rows) : null
  const previewYarn = preview ? otherYarn(cellYarn(delta, preview.r, preview.c)) : 'main'
  const previewAllowed = preview && target?.ok && tool !== 'hand' && !space
  const cursor = panning ? 'grabbing' : space || tool === 'hand' ? 'hand' : tool

  return (
    <div className="canvas-workspace">
      <div className="canvas-table-heading" aria-hidden="true">
        <span className="canvas-table-dot" />
        <span>A MESA DE DESENHO</span>
        <span className="canvas-table-mode">
          {view === 'simulation' ? 'O desenho ganha textura' : 'Cada ponto, uma intenção'}
        </span>
      </div>
      <div
        ref={viewport}
        className={`canvas-viewport canvas-cursor-${cursor}`}
        tabIndex={0}
        role="grid"
        aria-label={`${view === 'schematic' ? 'Gráfico de pontos' : 'Simulação do tecido'}, ${rows} carreiras por ${cols} pontos. Use as setas para navegar, Enter para pintar e Delete para apagar. Segure Espaço e arraste para mover.`}
        aria-rowcount={rows}
        aria-colcount={cols}
        aria-activedescendant={`${uid}-cell-${active.r}-${active.c}`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onLostPointerCapture={endGesture}
        onPointerLeave={() => setHover(null)}
        onKeyDown={keyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setSpace(false)
        }}
      >
        <motion.div className="canvas-position" style={{ x: panX, y: panY, scale }}>
          {/* Only fabric dimensions morph. Projecting position would counteract viewport fitting
              after a document remount and slide cells underneath an in-progress pointer stroke. */}
          <motion.div
            className={`canvas-fabric canvas-fabric-${view}`}
            layout="size"
            layoutDependency={`${view}:${rows}:${cols}`}
            transition={reduced ? { duration: 0 } : SPRING}
            style={{ width, height: fabricHeight }}
          >
            <svg ref={svg} width={width} height={fabricHeight} className="grid-svg" aria-hidden={false}>
              <defs>
                <pattern
                  id={`${uid}-locked`}
                  width="7"
                  height="7"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <path d="M0 0v7" stroke="#afa18c" strokeWidth="1" />
                </pattern>
                <pattern
                  id={`${uid}-fiber`}
                  width={CELL}
                  height={23}
                  patternUnits="userSpaceOnUse"
                  x={DRIVER}
                  y={HEADER}
                >
                  <path
                    d="M1 2Q13.5 8 26 2"
                    fill="none"
                    stroke="#1e2920"
                    strokeOpacity=".16"
                    strokeWidth="3"
                  />
                  <path
                    d="M5 1C5 8 6 15 13.5 20C21 15 22 8 22 1"
                    fill="none"
                    stroke="#17251a"
                    strokeOpacity=".19"
                    strokeWidth="6"
                    strokeLinecap="round"
                  />
                  <path
                    d="M6 0C6 7 7 14 13.5 19C20 14 21 7 21 0"
                    fill="none"
                    stroke="#fff"
                    strokeOpacity=".34"
                    strokeWidth="4.3"
                    strokeLinecap="round"
                  />
                  <path
                    d="M7 0C7 7 8 13 13.5 17M20 0C20 7 19 13 15 17"
                    fill="none"
                    stroke="#fff"
                    strokeOpacity=".3"
                    strokeWidth=".8"
                  />
                  <path
                    d="m4 6 5-2m-4 6 5-2m-3 6 5-3m9-5-5-2m4 6-5-2m3 6-5-3"
                    stroke="#fff"
                    strokeOpacity=".17"
                    strokeWidth=".7"
                  />
                </pattern>
              </defs>
              <ColumnNumbers cols={cols} />
              <AnimatePresence initial={false}>
                {rowList.map((r) => (
                  <GridRow
                    key={r}
                    r={r}
                    rows={rows}
                    cols={cols}
                    view={view}
                    colors={colors}
                    locked={!resolveClick(view, r, 1, rows).ok}
                    yarns={view === 'simulation' ? yarns[r - 1] : NONE}
                    xs={view === 'schematic' ? X[r - 1] : NONE}
                    uid={uid}
                    reduced={reduced}
                  />
                ))}
              </AnimatePresence>
              {view === 'simulation' &&
                rowList.map((r) => (
                  <RaisedStitches key={r} r={r} rows={rows} cells={X[r - 1]} color={colors[stripe(r)]} />
                ))}
              {rowList.map((r) => (
                <OutlineRow key={r} r={r} rows={rows} height={height} cells={outline[r - 1]} />
              ))}
              {preview && (
                <g className="grid-hover" pointerEvents="none">
                  <rect
                    x={24}
                    y={y(preview.r, rows, height) + 2}
                    width={34}
                    height={height - 4}
                    rx={8}
                    className="grid-active-driver"
                  />
                  <rect
                    x={x(preview.c) + 1.5}
                    y={y(preview.r, rows, height) + 1.5}
                    width={CELL - 3}
                    height={height - 3}
                    rx={view === 'simulation' ? 5 : 2}
                    className={previewAllowed ? 'grid-hover-outline' : 'grid-hover-locked'}
                  />
                  {previewAllowed &&
                    tool === 'hook' &&
                    (view === 'simulation' ? (
                      <rect
                        x={x(preview.c) + 3}
                        y={y(preview.r, rows, height) + 2}
                        width={CELL - 6}
                        height={height - 4}
                        rx={7}
                        fill={colors[previewYarn]}
                        opacity={0.48}
                      />
                    ) : (
                      !X[preview.r - 1][preview.c - 1] && (
                        <path
                          d={`M${x(preview.c) + 8} ${y(preview.r, rows, height) + 8}l11 11m0-11-11 11`}
                          className="grid-ghost-stitch"
                        />
                      )
                    ))}
                </g>
              )}
            </svg>
          </motion.div>
        </motion.div>
      </div>
      <div className="canvas-tools" role="toolbar" aria-label="Ferramentas de desenho">
        <button
          type="button"
          aria-label="Agulha de crochê (B)"
          title="Agulha de crochê · B"
          aria-pressed={tool === 'hook'}
          onClick={() => setTool('hook')}
        >
          <HookIcon />
        </button>
        <button
          type="button"
          aria-label="Apagar ponto (E)"
          title="Apagar ponto · E"
          aria-pressed={tool === 'erase'}
          onClick={() => setTool('erase')}
        >
          <Eraser size={18} strokeWidth={1.6} />
        </button>
        <span className="canvas-tool-divider" />
        <button
          type="button"
          aria-label="Mover tecido (H)"
          title="Mover tecido · H ou segure Espaço"
          aria-pressed={tool === 'hand'}
          onClick={() => setTool('hand')}
        >
          <Hand size={18} strokeWidth={1.6} />
        </button>
      </div>
      <div className="canvas-zoom" role="toolbar" aria-label="Zoom da bancada">
        <button
          type="button"
          aria-label="Diminuir zoom"
          title="Diminuir zoom"
          onClick={() => changeZoom(scale.get() / 1.2)}
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          className="canvas-zoom-value"
          title="Restaurar 100%"
          aria-label={`Zoom ${zoomLabel} por cento. Restaurar 100 por cento`}
          onClick={() => changeZoom(1)}
        >
          {zoomLabel}%
        </button>
        <button
          type="button"
          aria-label="Aumentar zoom"
          title="Aumentar zoom"
          onClick={() => changeZoom(scale.get() * 1.2)}
        >
          <Plus size={15} />
        </button>
        <span className="canvas-tool-divider" />
        <button type="button" aria-label="Enquadrar tecido" title="Enquadrar · 0" onClick={fit}>
          <Maximize2 size={15} />
        </button>
      </div>
      <div className="canvas-status">
        <span>
          {preview
            ? `Carreira ${preview.r} · Ponto ${stitchNumber(preview.c, cols)}${target?.ok ? '' : ' · Borda'}`
            : `${cols} pontos × ${rows} carreiras`}
        </span>
        <span>
          Role para aproximar <span className="canvas-status-dot">·</span> Espaço + arraste para mover
        </span>
      </div>
      <span className="canvas-sr-only" aria-live="polite">
        {focused ? `Carreira ${active.r}, ponto ${stitchNumber(active.c, cols)}` : ''}
      </span>
    </div>
  )
}
