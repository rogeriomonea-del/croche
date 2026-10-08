import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodePhotoFile, PHOTO_MAX_BYTES } from './photo-image'

const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0])

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

  it('reports an unavailable browser decoder without weakening the content security policy', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    await expect(decodePhotoFile(new File([pngHeader], 'image.png'))).rejects.toThrow('navegador não suporta')
  })
})
