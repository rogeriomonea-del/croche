/** Same layout as canvas ImageData: rows top to bottom, RGBA, 0-255. */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Throws a Portuguese message when the image cannot be analysed. */
export function assertImage(image: RgbaImage): void {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) {
    throw new Error('Imagem inválida: largura e altura precisam ser números inteiros maiores que zero.')
  }
  if (!(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) {
    throw new Error('Imagem inválida: a quantidade de pixels não corresponde à largura e à altura informadas.')
  }
}

/** The image composited onto white when any pixel is translucent; the same object otherwise. */
export function opaque(image: RgbaImage): RgbaImage {
  const { data } = image
  let translucent = false
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      translucent = true
      break
    }
  }
  if (!translucent) return image
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255
    out[i] = data[i] * a + 255 * (1 - a)
    out[i + 1] = data[i + 1] * a + 255 * (1 - a)
    out[i + 2] = data[i + 2] * a + 255 * (1 - a)
    out[i + 3] = 255
  }
  return { width: image.width, height: image.height, data: out }
}

/** Rec. 601 luma, 0-255, one value per pixel. */
export function luminance(image: RgbaImage): Float32Array {
  const { data } = image
  const out = new Float32Array(image.width * image.height)
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  return out
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

/**
 * Bounding box of the content, trimming uniform page/background margins. The background is the
 * median colour of the outer two-pixel ring; a pixel is content when one of its channels differs from
 * it by more than a tolerance derived from the ring's own noise. Rows and columns need a few content
 * pixels, so isolated specks (JPEG noise, dust) do not widen the box.
 */
export function findContentBox(image: RgbaImage): Box {
  assertImage(image)
  const flat = opaque(image)
  const { width: w, height: h, data } = flat
  const ring = Math.min(2, Math.floor(Math.min(w, h) / 2))
  if (ring < 1) return { x: 0, y: 0, width: w, height: h }

  const reds: number[] = []
  const greens: number[] = []
  const blues: number[] = []
  const perimeter = 2 * (w + h)
  const step = Math.max(1, Math.floor(perimeter / 4000))
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4
    reds.push(data[i])
    greens.push(data[i + 1])
    blues.push(data[i + 2])
  }
  for (let r = 0; r < ring; r++) {
    for (let x = 0; x < w; x += step) {
      take(x, r)
      take(x, h - 1 - r)
    }
    for (let y = 0; y < h; y += step) {
      take(r, y)
      take(w - 1 - r, y)
    }
  }
  const br = median(reds)
  const bg = median(greens)
  const bb = median(blues)
  const deviations = reds.map((_, i) => Math.max(Math.abs(reds[i] - br), Math.abs(greens[i] - bg), Math.abs(blues[i] - bb)))
  const tolerance = Math.max(28, 4 * 1.4826 * median(deviations))

  const rowCount = new Uint32Array(h)
  const colCount = new Uint32Array(w)
  for (let y = 0; y < h; y++) {
    let i = y * w * 4
    for (let x = 0; x < w; x++, i += 4) {
      if (Math.abs(data[i] - br) > tolerance || Math.abs(data[i + 1] - bg) > tolerance || Math.abs(data[i + 2] - bb) > tolerance) {
        rowCount[y]++
        colCount[x]++
      }
    }
  }
  const minRow = Math.max(2, Math.ceil(0.004 * w))
  const minCol = Math.max(2, Math.ceil(0.004 * h))
  let top = 0
  while (top < h && rowCount[top] < minRow) top++
  if (top === h) return { x: 0, y: 0, width: w, height: h }
  let bottom = h - 1
  while (bottom > top && rowCount[bottom] < minRow) bottom--
  let left = 0
  while (left < w && colCount[left] < minCol) left++
  if (left === w) return { x: 0, y: 0, width: w, height: h }
  let right = w - 1
  while (right > left && colCount[right] < minCol) right--
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}
