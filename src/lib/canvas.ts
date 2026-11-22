export interface CanvasCell {
  r: number
  c: number
}

/** Fill every crossed stitch even when the pointer moves faster than browser events. */
export function stitchLine(from: CanvasCell, to: CanvasCell): CanvasCell[] {
  const result: CanvasCell[] = []
  let c = from.c
  let r = from.r
  const dc = Math.abs(to.c - c)
  const dr = -Math.abs(to.r - r)
  const sc = c < to.c ? 1 : -1
  const sr = r < to.r ? 1 : -1
  let error = dc + dr
  while (true) {
    result.push({ r, c })
    if (c === to.c && r === to.r) return result
    const twice = 2 * error
    if (twice >= dr) {
      error += dr
      c += sc
    }
    if (twice <= dc) {
      error += dc
      r += sr
    }
  }
}

/** Keep the fabric point underneath the pointer fixed while changing magnification. */
export function zoomAt(
  point: { x: number; y: number },
  offset: { x: number; y: number },
  previous: number,
  next: number,
) {
  return {
    x: point.x - ((point.x - offset.x) * next) / previous,
    y: point.y - ((point.y - offset.y) * next) / previous,
  }
}
