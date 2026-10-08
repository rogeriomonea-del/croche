import { photoPlacement, type PhotoFit, type PhotoPixels } from './photo-pattern'

export const PHOTO_MAX_BYTES = 12 * 1024 * 1024
export const PHOTO_MAX_PIXELS = 24_000_000

export interface DecodedPhoto {
  canvas: HTMLCanvasElement
  originalWidth: number
  originalHeight: number
}

/** Browser-only decode. No data/blob URLs, external services, metadata persistence or uploads. */
export async function decodePhotoFile(file: File): Promise<DecodedPhoto> {
  if (!file.size || file.size > PHOTO_MAX_BYTES) throw new Error('Escolha uma imagem de até 12 MB.')
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => header[i] === v)
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255
  const webp = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
  if (!png && !jpeg && !webp) throw new Error('Use uma fotografia PNG, JPEG ou WebP. HEIC e SVG não são aceitos.')
  if (typeof createImageBitmap !== 'function') throw new Error('Este navegador não suporta a leitura de fotos. Abra o ateliê em uma versão atual do Chrome, Firefox ou Safari.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('Não foi possível ler esta foto. Tente exportá-la novamente como PNG ou JPEG.')
  }
  try {
    if (bitmap.width * bitmap.height > PHOTO_MAX_PIXELS || !bitmap.width || !bitmap.height) {
      throw new Error('A foto ultrapassa 24 megapixels. Reduza a resolução e tente novamente.')
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
