/** sRGB 0-255 to CIELAB (D65), written into `out` at `offset`. */
function srgbToLab(r: number, g: number, b: number, out: Float64Array, offset: number): void {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const lr = lin(r)
  const lg = lin(g)
  const lb = lin(b)
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  out[offset] = 116 * fy - 16
  out[offset + 1] = 500 * (fx - fy)
  out[offset + 2] = 200 * (fy - fz)
}

function hex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

export interface Classification {
  ink: Uint8Array
  certainty: Float32Array
  colors: { paper: string; ink: string }
  /** 0..1: how cleanly the two clusters separate (centre distance against their spread). */
  separation: number
}

/** Below this CIELAB distance the cells are treated as one colour. */
const SAME_COLOUR = 6
/** Below this lightness difference, saturation decides which cluster is ink. */
const NEAR_LIGHTNESS = 10

/**
 * Two-means in CIELAB over per-cell colours (`rgb`: three floats per cell). Initialised
 * deterministically from the extremes of the colours' principal axis. Ink is the darker cluster, or
 * the more saturated one when their lightness is nearly equal. `bias` (-1..1) moves the decision
 * boundary along the segment between the centres: 0 is the midpoint, positive makes more cells ink.
 */
export function classifyCells(rgb: Float32Array, bias: number): Classification {
  const n = rgb.length / 3
  const lab = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) srgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], lab, i * 3)

  // Principal axis by power iteration on the covariance, from a fixed start vector.
  const mean = [0, 0, 0]
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c] += lab[i * 3 + c] / n
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    const d0 = lab[i * 3] - mean[0]
    const d1 = lab[i * 3 + 1] - mean[1]
    const d2 = lab[i * 3 + 2] - mean[2]
    const d = [d0, d1, d2]
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a * 3 + b] += d[a] * d[b]
  }
  let axis = [1, 0.3, 0.2]
  for (let it = 0; it < 30; it++) {
    const next = [0, 1, 2].map((a) => cov[a * 3] * axis[0] + cov[a * 3 + 1] * axis[1] + cov[a * 3 + 2] * axis[2])
    const norm = Math.hypot(next[0], next[1], next[2])
    if (norm < 1e-9) break
    axis = next.map((v) => v / norm)
  }
  const order = Array.from({ length: n }, (_, i) => i)
  const proj = order.map((i) => (lab[i * 3] - mean[0]) * axis[0] + (lab[i * 3 + 1] - mean[1]) * axis[1] + (lab[i * 3 + 2] - mean[2]) * axis[2])
  order.sort((a, b) => proj[a] - proj[b])
  const tail = Math.max(1, Math.floor(n * 0.1))
  const centres = [new Float64Array(3), new Float64Array(3)]
  for (let t = 0; t < tail; t++) {
    for (let c = 0; c < 3; c++) {
      centres[0][c] += lab[order[t] * 3 + c] / tail
      centres[1][c] += lab[order[n - 1 - t] * 3 + c] / tail
    }
  }

  const label = new Uint8Array(n)
  for (let it = 0; it < 40; it++) {
    let changed = it === 0
    const sums = [new Float64Array(3), new Float64Array(3)]
    const counts = [0, 0]
    for (let i = 0; i < n; i++) {
      let d0 = 0
      let d1 = 0
      for (let c = 0; c < 3; c++) {
        const v = lab[i * 3 + c]
        d0 += (v - centres[0][c]) ** 2
        d1 += (v - centres[1][c]) ** 2
      }
      const k = d1 < d0 ? 1 : 0
      if (k !== label[i]) changed = true
      label[i] = k
      counts[k]++
      for (let c = 0; c < 3; c++) sums[k][c] += lab[i * 3 + c]
    }
    for (let k = 0; k < 2; k++) if (counts[k]) for (let c = 0; c < 3; c++) centres[k][c] = sums[k][c] / counts[k]
    if (!changed) break
  }

  const rgbMean = [new Float64Array(3), new Float64Array(3)]
  const counts = [0, 0]
  for (let i = 0; i < n; i++) {
    counts[label[i]]++
    for (let c = 0; c < 3; c++) rgbMean[label[i]][c] += rgb[i * 3 + c]
  }
  for (let k = 0; k < 2; k++) if (counts[k]) for (let c = 0; c < 3; c++) rgbMean[k][c] /= counts[k]

  const ink = new Uint8Array(n)
  const certainty = new Float32Array(n)
  const distance = Math.hypot(centres[0][0] - centres[1][0], centres[0][1] - centres[1][1], centres[0][2] - centres[1][2])
  if (!counts[0] || !counts[1] || distance < SAME_COLOUR) {
    // One colour: a blank chart reads as paper, a uniformly dark one as ink.
    const dark = mean[0] < 50
    ink.fill(dark ? 1 : 0)
    certainty.fill(0)
    const avg = [0, 0, 0]
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) avg[c] += rgb[i * 3 + c] / n
    const colour = hex(avg[0], avg[1], avg[2])
    return { ink, certainty, colors: { paper: colour, ink: colour }, separation: 0 }
  }

  const chroma = (k: number) => Math.hypot(centres[k][1], centres[k][2])
  const lightnessGap = centres[0][0] - centres[1][0]
  let inkIndex: number
  if (Math.abs(lightnessGap) >= NEAR_LIGHTNESS) inkIndex = lightnessGap < 0 ? 0 : 1
  else inkIndex = chroma(0) >= chroma(1) ? 0 : 1
  const paperIndex = 1 - inkIndex
  const ci = centres[inkIndex]
  const cp = centres[paperIndex]
  const axisVec = [cp[0] - ci[0], cp[1] - ci[1], cp[2] - ci[2]]
  const axisLen2 = axisVec[0] ** 2 + axisVec[1] ** 2 + axisVec[2] ** 2
  const boundary = 0.5 + 0.5 * Math.max(-1, Math.min(1, bias))
  let spread = 0
  for (let i = 0; i < n; i++) {
    const t = ((lab[i * 3] - ci[0]) * axisVec[0] + (lab[i * 3 + 1] - ci[1]) * axisVec[1] + (lab[i * 3 + 2] - ci[2]) * axisVec[2]) / axisLen2
    ink[i] = t < boundary ? 1 : 0
    certainty[i] = Math.min(1, Math.abs(t - boundary) / 0.5)
    const own = label[i] === inkIndex ? ci : cp
    spread += (lab[i * 3] - own[0]) ** 2 + (lab[i * 3 + 1] - own[1]) ** 2 + (lab[i * 3 + 2] - own[2]) ** 2
  }
  const sigma = Math.sqrt(spread / n)
  return {
    ink,
    certainty,
    colors: {
      paper: hex(rgbMean[paperIndex][0], rgbMean[paperIndex][1], rgbMean[paperIndex][2]),
      ink: hex(rgbMean[inkIndex][0], rgbMean[inkIndex][1], rgbMean[inkIndex][2]),
    },
    separation: distance / (distance + 2 * sigma),
  }
}
