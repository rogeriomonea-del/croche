import { photoPlacement, type PhotoFit, type PhotoPixels } from './photo-pattern'

export const PHOTO_MAX_BYTES = 12 * 1024 * 1024
export const PHOTO_MAX_PIXELS = 24_000_000

export interface DecodedPhoto {
  canvas: HTMLCanvasElement
  originalWidth: number
  originalHeight: number
}

/** Room for the metadata (EXIF, ICC) a camera writes before a JPEG's frame header. */
const HEADER_BYTES = 256 * 1024
const TOO_LARGE = 'A foto ultrapassa 24 megapixels. Reduza a resolução e tente novamente.'

/**
 * Width and height as the PNG, JPEG or WebP header declares them, or null when the header does
 * not say within `bytes`. Read before decoding: a small, highly compressed file can declare
 * hundreds of megapixels, and decoding it first could exhaust the tab's memory.
 */
export function declaredSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length))
  const uint24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
  if (bytes.length >= 24 && bytes[0] === 137 && text(12, 4) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const chunk = text(12, 4)
    if (chunk === 'VP8X') return { width: uint24(24) + 1, height: uint24(27) + 1 }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    return null
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let i = 2
    while (i + 9 <= bytes.length) {
      if (bytes[i] !== 255) return null
      const marker = bytes[i + 1]
      if (marker === 255) {
        i++
        continue
      }
      // SOF0-SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but not the layout.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) }
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) i += 2
      else i += 2 + view.getUint16(i + 2)
    }
  }
  return null
}

/** Browser-only decode. No data/blob URLs, external services, metadata persistence or uploads. */
export async function decodePhotoFile(file: File): Promise<DecodedPhoto> {
  if (!file.size || file.size > PHOTO_MAX_BYTES) throw new Error('Escolha uma imagem de até 12 MB.')
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => header[i] === v)
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255
  const webp = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
  if (!png && !jpeg && !webp) throw new Error('Use uma fotografia PNG, JPEG ou WebP. HEIC e SVG não são aceitos.')
  const size = declaredSize(header)
  if (size && size.width * size.height > PHOTO_MAX_PIXELS) throw new Error(TOO_LARGE)
  if (typeof createImageBitmap !== 'function') throw new Error('Este navegador não suporta a leitura de fotos. Abra o ateliê em uma versão atual do Chrome, Firefox ou Safari.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('Não foi possível ler esta foto. Tente exportá-la novamente como PNG ou JPEG.')
  }
  try {
    if (bitmap.width * bitmap.height > PHOTO_MAX_PIXELS || !bitmap.width || !bitmap.height) {
      throw new Error(TOO_LARGE)
    }
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('O navegador não conseguiu abrir a área de imagem.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return { canvas, originalWidth: bitmap.width, originalHeight: bitmap.height }
  } finally {
    bitmap.close()
  }
}

export function samplePhoto(source: HTMLCanvasElement, rows: number, cols: number, fit: PhotoFit): PhotoPixels {
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('O navegador não conseguiu preparar a prévia do mosaico.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, cols, rows)
  const placement = photoPlacement(source.width, source.height, cols, rows, fit)
  context.drawImage(source, placement.x, placement.y, placement.width, placement.height)
  return context.getImageData(0, 0, cols, rows)
}
