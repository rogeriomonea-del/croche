import { detectStraight, type DetectedGrid } from './grid'
import { assertImage, luminance, opaque, type RgbaImage } from './image'
import { detectWarped } from './warp'

/** A straight lattice this confident is taken as is; below it the photo model is tried as well. */
const STRAIGHT_ACCEPT = 0.75
/** Confidence the photo model must gain over a straight lattice to replace it. */
const WARPED_MARGIN = 0.1

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
  if (straight && straight.confidence >= STRAIGHT_ACCEPT) return straight
  const warped = detectWarped(L, w, h)
  if (!warped) return straight
  if (!straight) return warped
  // The straight reading is exact on screenshots; the photo model replaces it only when clearly more
  // confident and not smaller (its margin trimming can cut off pale rows of a sharp chart).
  const cells = (g: DetectedGrid) => g.x.count * g.y.count
  return warped.confidence > straight.confidence + WARPED_MARGIN && cells(warped) >= cells(straight) ? warped : straight
}
