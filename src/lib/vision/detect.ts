import { detectStraight, type DetectedGrid } from './grid'
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
  if (straight && (straight.confidence >= STRAIGHT_ACCEPT || exact(straight))) return straight
  const warped = detectWarped(L, w, h)
  if (!warped) return straight
  if (!straight) return warped
  // The straight reading is exact on screenshots; the photo model replaces it only when clearly more
  // confident and not smaller (its margin trimming can cut off pale rows of a sharp chart).
  const cells = (g: DetectedGrid) => g.x.count * g.y.count
  return warped.confidence > straight.confidence + WARPED_MARGIN && cells(warped) >= cells(straight) ? warped : straight
}
