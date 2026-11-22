import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { fileCols, fileRows, rowStartSide, type FileChart, type ReadingOptions } from '../../file'
import type { StudioMode } from '../../state/file-studio'
import { cellsBetween, chartLayout, colLeft, hitTest, labelStep, rowTop, type ChartLayout } from './geometry'

interface FileChartCanvasProps {
  chart: FileChart
  mode: StudioMode
  reading: ReadingOptions
  /** Selected row and the chart columns of its current segment (Tecer). */
  row: number
  segmentSpan: { from: number; to: number } | null
  doneRows: readonly number[]
  cell: number
  onSelectRow: (row: number) => void
  onStrokeStart: () => void
  onPaint: (r: number, c: number, filled: boolean) => void
  onStrokeEnd: () => void
}

const AUBERGINE = '#63465e'
const GOLD = '#b7915d'
const LABEL = '#7d6a60'
const DONE_VEIL = 'rgba(246, 242, 235, 0.68)'
/** Backing-store area cap (iOS Safari refuses larger canvases). */
const MAX_BACKING_AREA = 16_000_000

function draw(
  canvas: HTMLCanvasElement,
  layout: ChartLayout,
  props: Pick<FileChartCanvasProps, 'chart' | 'mode' | 'reading' | 'row' | 'segmentSpan' | 'doneRows'>,
) {
  const { chart, mode, reading, row, segmentSpan, doneRows } = props
  const { rows, cols, cell, gutter, top } = layout
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const scale = Math.max(0.25, Math.min(dpr, Math.sqrt(MAX_BACKING_AREA / (layout.width * layout.height))))
  const pw = Math.max(1, Math.round(layout.width * scale))
  const ph = Math.max(1, Math.round(layout.height * scale))
  if (canvas.width !== pw) canvas.width = pw
  if (canvas.height !== ph) canvas.height = ph
  canvas.style.width = `${layout.width}px`
  canvas.style.height = `${layout.height}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.clearRect(0, 0, layout.width, layout.height)

  const gridW = cols * cell
  const gridH = rows * cell
  const left = gutter
  const tecer = mode === 'tecer'

  // Squares: aberto background, one path for every fechado.
  ctx.fillStyle = chart.colors.open
  ctx.fillRect(left, top, gridW, gridH)
  ctx.beginPath()
  for (let r = 1; r <= rows; r++) {
    const y = rowTop(layout, r)
    const line = chart.filled[r - 1]
    for (let c = 1; c <= cols; c++) {
      if (!line[c - 1]) continue
      let end = c
      while (end < cols && line[end]) end++
      ctx.rect(colLeft(layout, c), y, (end - c + 1) * cell, cell)
      c = end
    }
  }
  ctx.fillStyle = chart.colors.filled
  ctx.fill()

  // Finished rows fade back so the remaining work stands out.
  if (doneRows.length) {
    ctx.fillStyle = DONE_VEIL
    for (const r of doneRows) if (r >= 1 && r <= rows && !(tecer && r === row)) ctx.fillRect(left, rowTop(layout, r), gridW, cell)
  }

  // Thin lines between squares, thicker every 10 counted from row 1 / column 1.
  if (cell >= 4) {
    ctx.beginPath()
    for (let c = 1; c < cols; c++) if (c % 10 !== 0) {
      const x = left + c * cell + 0.5
      ctx.moveTo(x, top)
      ctx.lineTo(x, top + gridH)
    }
    for (let r = 1; r < rows; r++) if (r % 10 !== 0) {
      const y = rowTop(layout, r) + 0.5
      ctx.moveTo(left, y)
      ctx.lineTo(left + gridW, y)
    }
    ctx.strokeStyle = 'rgba(92, 72, 67, 0.22)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.beginPath()
  for (let c = 10; c < cols; c += 10) {
    const x = left + c * cell
    ctx.moveTo(x, top)
    ctx.lineTo(x, top + gridH)
  }
  for (let r = 10; r < rows; r += 10) {
    const y = rowTop(layout, r)
    ctx.moveTo(left, y)
    ctx.lineTo(left + gridW, y)
  }
  ctx.strokeStyle = 'rgba(82, 56, 78, 0.62)'
  ctx.lineWidth = cell >= 6 ? 2 : 1.25
  ctx.stroke()
  ctx.strokeStyle = 'rgba(82, 56, 78, 0.8)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(left - 0.75, top - 0.75, gridW + 1.5, gridH + 1.5)

  // Current row: an aubergine frame, the current segment in gold.
  if (tecer && row >= 1 && row <= rows) {
    const y = rowTop(layout, row)
    if (segmentSpan) {
      const x = colLeft(layout, segmentSpan.from)
      const w = (segmentSpan.to - segmentSpan.from + 1) * cell
      ctx.fillStyle = 'rgba(183, 145, 93, 0.38)'
      ctx.fillRect(x, y, w, cell)
      ctx.strokeStyle = GOLD
      ctx.lineWidth = 2
      ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, cell - 2))
    }
    ctx.strokeStyle = AUBERGINE
    ctx.lineWidth = 3
    ctx.strokeRect(left - 1.5, y - 1.5, gridW + 3, cell + 3)
  }

  // Row numbers on both sides; a small arrow on the side each row starts from.
  const step = labelStep(cell)
  const font = Math.max(9, Math.min(12, cell * 0.85))
  ctx.font = `500 ${font}px 'DM Sans', sans-serif`
  ctx.textBaseline = 'middle'
  for (let r = 1; r <= rows; r++) {
    const selected = tecer && r === row
    const labelled = selected || r === 1 || r % step === 0
    const y = rowTop(layout, r) + cell / 2
    const side = rowStartSide(r, reading)
    if (selected) {
      // A filled arrow pointing the way the row is worked, on its starting side.
      const size = Math.max(7, Math.min(13, cell))
      const tip = side === 'right' ? left + gridW + 4 : left - 4
      const base = side === 'right' ? tip + size : tip - size
      ctx.fillStyle = AUBERGINE
      ctx.beginPath()
      ctx.moveTo(tip, y)
      ctx.lineTo(base, y - size / 2)
      ctx.lineTo(base, y + size / 2)
      ctx.closePath()
      ctx.fill()
    } else if (cell >= 8) {
      const size = Math.min(5, cell * 0.4)
      const tip = side === 'right' ? left + gridW + 3 : left - 3
      const base = side === 'right' ? tip + size : tip - size
      ctx.fillStyle = GOLD
      ctx.beginPath()
      ctx.moveTo(tip, y)
      ctx.lineTo(base, y - size / 1.6)
      ctx.lineTo(base, y + size / 1.6)
      ctx.closePath()
      ctx.fill()
    }
    if (!labelled) continue
    const text = String(r)
    const leftX = left - (side === 'left' || selected ? 18 : 8)
    const rightX = left + gridW + (side === 'right' || selected ? 18 : 8)
    ctx.fillStyle = selected ? AUBERGINE : LABEL
    ctx.font = `${selected ? 700 : 500} ${font}px 'DM Sans', sans-serif`
    ctx.textAlign = 'right'
    ctx.fillText(text, leftX, y)
    ctx.textAlign = 'left'
    ctx.fillText(text, rightX, y)
  }

  // Column numbers under the grid.
  ctx.font = `500 ${Math.max(9, Math.min(11, cell * 0.8))}px 'DM Sans', sans-serif`
  ctx.fillStyle = LABEL
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let c = 1; c <= cols; c++) {
    if (c !== 1 && c % step !== 0) continue
    ctx.fillText(String(c), colLeft(layout, c) + cell / 2, top + gridH + 6)
  }
}

export function FileChartCanvas(props: FileChartCanvasProps) {
  const { chart, mode, reading, row, segmentSpan, doneRows, cell, onSelectRow, onStrokeStart, onPaint, onStrokeEnd } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stroke = useRef<{ pointer: number; value: boolean; last: { r: number; c: number } } | null>(null)
  const rows = fileRows(chart)
  const cols = fileCols(chart)
  const layout = useMemo(() => chartLayout(rows, cols, cell), [rows, cols, cell])

  useEffect(() => {
    if (canvasRef.current) draw(canvasRef.current, layout, { chart, mode, reading, row, segmentSpan, doneRows })
  }, [layout, chart, mode, reading, row, segmentSpan, doneRows])

  // Keep the current row (and segment) in view inside the chart's own scroller.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || mode !== 'tecer' || row < 1 || row > rows) return
    const y = rowTop(layout, row)
    const margin = Math.min(scroller.clientHeight / 3, layout.cell * 3)
    let top = scroller.scrollTop
    if (y - margin < top) top = y - margin
    else if (y + layout.cell + margin > top + scroller.clientHeight) top = y + layout.cell + margin - scroller.clientHeight
    let leftPos = scroller.scrollLeft
    if (segmentSpan) {
      const x0 = colLeft(layout, segmentSpan.from) - layout.gutter
      const x1 = colLeft(layout, segmentSpan.to + 1) + layout.gutter
      if (x1 - x0 > scroller.clientWidth) leftPos = reading && rowStartSide(row, reading) === 'right' ? x1 - scroller.clientWidth : x0
      else if (x0 < leftPos) leftPos = x0
      else if (x1 > leftPos + scroller.clientWidth) leftPos = x1 - scroller.clientWidth
    }
    if (top !== scroller.scrollTop || leftPos !== scroller.scrollLeft) {
      const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      scroller.scrollTo({ top: Math.max(0, top), left: Math.max(0, leftPos), behavior: smooth ? 'smooth' : 'auto' })
    }
  }, [layout, mode, row, rows, segmentSpan, reading])

  function locate(event: { clientX: number; clientY: number }) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return hitTest(layout, event.clientX - rect.left, event.clientY - rect.top)
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (mode !== 'editar' || event.button !== 0 || stroke.current) return
    const hit = locate(event)
    if (!hit || hit.kind !== 'cell') return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const value = !chart.filled[hit.r - 1][hit.c - 1]
    stroke.current = { pointer: event.pointerId, value, last: { r: hit.r, c: hit.c } }
    onStrokeStart()
    onPaint(hit.r, hit.c, value)
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const active = stroke.current
    if (!active || active.pointer !== event.pointerId) return
    const hit = locate(event)
    if (!hit || hit.kind !== 'cell' || (hit.r === active.last.r && hit.c === active.last.c)) return
    for (const p of cellsBetween(active.last, hit).slice(1)) onPaint(p.r, p.c, active.value)
    active.last = { r: hit.r, c: hit.c }
  }

  function pointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    const active = stroke.current
    if (!active || active.pointer !== event.pointerId) return
    stroke.current = null
    onStrokeEnd()
  }

  return (
    <div ref={scrollRef} className={`file-chart-scroll is-${mode}`}>
      <canvas
        ref={canvasRef}
        className="file-chart-canvas"
        role="img"
        aria-label={`Gráfico filé “${chart.name}”: ${rows} carreiras de ${cols} quadradinhos. A lista de carreiras abaixo descreve cada uma.`}
        data-cell={cell}
        data-gutter={layout.gutter}
        data-top={layout.top}
        data-rows={rows}
        data-cols={cols}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onLostPointerCapture={pointerEnd}
        onClick={(event) => {
          if (mode !== 'tecer') return
          const hit = locate(event)
          if (hit) onSelectRow(hit.r)
        }}
      />
    </div>
  )
}
