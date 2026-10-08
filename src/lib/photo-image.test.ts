import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { declaredSize, decodePhotoFile, PHOTO_MAX_BYTES } from './photo-image'

const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0])

const u16be = (n: number) => [n >> 8, n & 255]
const u32be = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]
const u32le = (n: number) => u32be(n).reverse()
const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0))
const png = (width: number, height: number) =>
  new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, ...ascii('IHDR'), ...u32be(width), ...u32be(height), 8, 0, 0, 0, 0])
// SOI, an APP1 (EXIF-like) segment of 300 bytes, then a progressive SOF2 frame header.
const jpeg = (width: number, height: number) =>
  new Uint8Array([255, 216, 255, 225, ...u16be(300), ...new Array(298).fill(0), 255, 194, ...u16be(17), 8, ...u16be(height), ...u16be(width), 3])
const webp = (chunk: string, body: number[]) =>
  new Uint8Array([...ascii('RIFF'), ...u32le(100), ...ascii('WEBP'), ...ascii(chunk), ...u32le(80), ...body, ...new Array(16).fill(0)])

afterEach(() => vi.unstubAllGlobals())

describe('local photo decoding boundaries', () => {
  it('rejects empty and oversized files before decoding', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await expect(decodePhotoFile(new File([], 'empty.png'))).rejects.toThrow('12 MB')
    await expect(decodePhotoFile(new File([new Uint8Array(PHOTO_MAX_BYTES + 1)], 'huge.png'))).rejects.toThrow('12 MB')
    expect(decode).not.toHaveBeenCalled()
  })

  it('checks file signatures rather than trusting an image extension or MIME type', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await expect(decodePhotoFile(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'fake.png', { type: 'image/png' }))).rejects.toThrow('PNG, JPEG ou WebP')
    expect(decode).not.toHaveBeenCalled()
  })

  it('handles corrupted photos with a useful error and does not leak decoder details', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decoder internal details')))
    await expect(decodePhotoFile(new File([pngHeader], 'broken.png'))).rejects.toThrow('Não foi possível ler esta foto')
  })

  it('rejects excessive decoded dimensions and always releases the bitmap', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 6000, height: 5000, close }))
    await expect(decodePhotoFile(new File([pngHeader], 'large.png'))).rejects.toThrow('24 megapixels')
    expect(close).toHaveBeenCalledOnce()
  })

  it('reads the declared size from PNG, JPEG and WebP headers', () => {
    expect(declaredSize(png(6000, 5000))).toEqual({ width: 6000, height: 5000 })
    expect(declaredSize(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024 })
    // VP8X stores width-1 and height-1 in 24 bits each.
    expect(declaredSize(webp('VP8X', [0, 0, 0, 0, 0x57, 0x1b, 0, 0x9f, 0x0f, 0]))).toEqual({ width: 7000, height: 4000 })
    // VP8L packs width-1 and height-1 in 14 bits each after the 0x2f signature.
    expect(declaredSize(webp('VP8L', [0x2f, ...u32le(1999 | (2999 << 14))]))).toEqual({ width: 2000, height: 3000 })
    expect(declaredSize(webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x06, 0xb0, 0x04]))).toEqual({ width: 1600, height: 1200 })
    expect(declaredSize(new Uint8Array(readFileSync(new URL('../../e2e/fixtures/woven-study.png', import.meta.url))))).not.toBeNull()
    expect(declaredSize(pngHeader)).toBeNull()
  })

  it('rejects a declared size above 24 megapixels before decoding anything', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await expect(decodePhotoFile(new File([png(6000, 5000)], 'bomb.png'))).rejects.toThrow('24 megapixels')
    await expect(decodePhotoFile(new File([png(20000, 20000)], 'bomb.png'))).rejects.toThrow('24 megapixels')
    await expect(decodePhotoFile(new File([jpeg(8000, 6000)], 'bomb.jpg'))).rejects.toThrow('24 megapixels')
    await expect(decodePhotoFile(new File([webp('VP8X', [0, 0, 0, 0, 0x1f, 0x4e, 0, 0x1f, 0x4e, 0])], 'bomb.webp'))).rejects.toThrow('24 megapixels')
    expect(decode).not.toHaveBeenCalled()
  })

  it('reports an unavailable browser decoder without weakening the content security policy', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    await expect(decodePhotoFile(new File([pngHeader], 'image.png'))).rejects.toThrow('navegador não suporta')
  })
})
