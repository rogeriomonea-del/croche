import { memo } from 'react'
import { cellYarn, type DesignData } from '../core'

interface PatternPreviewProps {
  design: DesignData
  className?: string
  label?: string
  rowAspect?: number
}

/** The same visible yarns as the editor. Run-length paths keep larger previews inexpensive. */
export const PatternPreview = memo(function PatternPreview({ design, className, label, rowAspect = 0.55 }: PatternPreviewProps) {
  const rows = design.delta.length, cols = design.delta[0]?.length ?? 0
  const paths: string[] = []
  for (let r = rows; r >= 1; r--) {
    let runStart = -1
    for (let c = 1; c <= cols + 1; c++) {
      const isPattern = c <= cols && cellYarn(design.delta, r, c) === 'pattern'
      if (isPattern && runStart === -1) runStart = c - 1
      if (!isPattern && runStart !== -1) {
        paths.push(`M${runStart} ${(rows - r) * rowAspect}h${c - 1 - runStart}v${rowAspect}h-${c - 1 - runStart}z`)
        runStart = -1
      }
    }
  }

  return (
    <svg
      className={className}
      viewBox={`0 0 ${cols} ${rows * rowAspect}`}
      xmlns="http://www.w3.org/2000/svg"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <rect width={cols} height={rows * rowAspect} fill={design.colors.main} />
      <path d={paths.join('')} fill={design.colors.pattern} />
    </svg>
  )
})
