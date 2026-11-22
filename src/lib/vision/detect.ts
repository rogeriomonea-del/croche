import { detectStraight, type DetectedGrid, type GridAxis } from './grid'
import { assertImage, luminance, opaque, type RgbaImage } from './image'
import { detectWarped } from './warp'

/** A straight lattice this confident is taken as is; below it the photo model is tried as well. */
const STRAIGHT_ACCEPT = 0.75
/** Confidence the photo model must gain over a straight lattice to replace it. */
const WARPED_MARGIN = 0.1
/**
 * Below STRAIGHT_ACCEPT a straight lattice is still taken as is (the costly photo model skipped)
 * when it fits like a screenshot: this confident, with nearly every line found, close to the lattice
 * (RMS in pitches) and straight along its length (drift in pitches). A photo model cannot improve on it.
 */
const EXACT_ACCEPT = 0.6
const EXACT_LINES = 0.97
const EXACT_RESIDUAL = 0.07
const EXACT_SKEW = 0.1

/**
 * Below this pitch (pixels) a straight lattice that does not fit exactly is checked against the photo
 * model: axis numbers, arrows and watermark drawn about a pitch from the border fall on the lattice,
 * and in a blurred photo pass for an outer row or column with strong lines.
 */
const SMALL_PITCH = 10
/** The photo model's lattice, inside such a straight lattice, replaces it unless this much less confident. */
const SMALL_MARGIN = 0.05

/** Whether axis `a` is `b` without up to two outer cells per end (same pitch, aligned lines). */
function inside(a: GridAxis, b: GridAxis): boolean {
  const lead = (a.start - b.start) / b.pitch
  const trail = (b.start + b.count * b.pitch - a.start - a.count * a.pitch) / b.pitch
  return Math.abs(a.pitch - b.pitch) < 0.05 * b.pitch && lead > -0.3 && lead < 2.3 && trail > -0.3 && trail < 2.3 && Math.abs(lead - Math.round(lead)) < 0.3
}

function exact(grid: DetectedGrid): boolean {
  const fit = grid.fit
  return !!fit && grid.confidence >= EXACT_ACCEPT && fit.lines >= EXACT_LINES && fit.residual <= EXACT_RESIDUAL && fit.skew <= EXACT_SKEW
}

/** null when the picture has no regular grid (a photo of an object, a drawing without grid lines). */
export function detectGrid(image: RgbaImage): DetectedGrid | null {
  assertImage(image)
  return detectGridOpaque(opaque(image))
}

/** detectGrid for an image already validated and composited onto white. */
export function detectGridOpaque(flat: RgbaImage): DetectedGrid | null {
  const { width: w, height: h } = flat
  if (w < 16 || h < 16) return null
  const L = luminance(flat)
  const straight = detectStraight(L, w, h, false)
  // Lines that drift along their length (a tilted photo) make a straight lattice lose rows or columns
  // at no cost in confidence: such a lattice is never taken without trying the photo model.
  const skewed = !!straight?.fit && straight.fit.skew > EXACT_SKEW
  const small = !!straight && Math.min(straight.x.pitch, straight.y.pitch) < SMALL_PITCH && !exact(straight)
  if (straight && !skewed && !small && (straight.confidence >= STRAIGHT_ACCEPT || exact(straight))) return straight
  const warped = detectWarped(L, w, h)
  if (!warped) return straight
  if (!straight || skewed) return warped
  const cells = (g: DetectedGrid) => g.x.count * g.y.count
  // Small cells: the photo model trims the margins by the crossing-line support of whole rows, which
  // labels a pitch away do not have; the straight lattice may carry them as extra outer cells.
  if (small && inside(warped.x, straight.x) && inside(warped.y, straight.y) && cells(warped) < cells(straight) && warped.confidence >= straight.confidence - SMALL_MARGIN) return warped
  // Confidence does not see a missing outer row or column, so the larger lattice wins unless it is
  // less confident. Otherwise the straight reading is exact on screenshots; the photo model replaces
  // it only when clearly more confident and not smaller (its margin trimming can cut off pale rows).
  if (cells(warped) > cells(straight)) return warped.confidence >= straight.confidence ? warped : straight
  return warped.confidence > straight.confidence + WARPED_MARGIN && cells(warped) === cells(straight) ? warped : straight
}
