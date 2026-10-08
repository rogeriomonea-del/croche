import { describe, expect, it } from 'vitest'
import { cellYarn, cellsOf, conflicts, deriveX, emptyMatrix, instructions, parseDocument, toDocument, type Matrix } from '../core'
import { automaticPhotoThreshold, convertPhotoPixels, photoPlacement, type PhotoPixels } from './photo-pattern'

const settings = { threshold: 128, invert: false, name: 'Minha fotografia', colors: { main: '#f3ead8', pattern: '#52384e' } }

function pixels(width = 5, height = 7, value = 255): PhotoPixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([value, value, value, 255], i)
  return { width, height, data }
}

function render(delta: Matrix): PhotoPixels {
  const picture = pixels(delta[0].length, delta.length)
  for (let y = 0; y < picture.height; y++) {
    for (let c = 0; c < picture.width; c++) {
      const value = cellYarn(delta, picture.height - y, c + 1) === 'pattern' ? 0 : 255
      picture.data.set([value, value, value, 255], (y * picture.width + c) * 4)
    }
  }
  return picture
}

describe('photograph to valid overlay mosaic', () => {
  it('preserves asymmetric geometry, bottom-first row orientation, and left-to-right columns', () => {
    const expected = emptyMatrix(7, 5)
    expected[1][0] = true
    expected[3][3] = true
    expected[5][1] = true
    const result = convertPhotoPixels(render(expected), settings)
    expect(result.design.delta).toEqual(expected)
    expect(result.adaptedCells).toBe(0)
    expect(result.instructions).toEqual(instructions(deriveX(expected)))
    expect(result.instructions[2]).toBe('Row 3: 4 sc and 1 dc')
    expect(result.doubleCrochets).toBe(3)
    expect(result.singleCrochets).toBe(32)
  })

  it('keeps one boolean per cell and produces a valid round-trippable document', () => {
    const result = convertPhotoPixels(pixels(), settings)
    expect(Object.keys(result.design).sort()).toEqual(['colors', 'delta', 'name'])
    expect(result.design.delta.flat().every((cell) => typeof cell === 'boolean')).toBe(true)
    expect(parseDocument(toDocument(result.design)).ok).toBe(true)
    expect(result.instructions.length).toBe(7)
  })

  it('holds the base and top rows in yarn A even when the whole photograph wants yarn B', () => {
    const result = convertPhotoPixels(pixels(5, 7, 0), settings)
    expect(result.design.delta[0]).toEqual(Array(5).fill(false))
    expect(result.design.delta[6]).toEqual(Array(5).fill(false))
    expect(result.adaptedCells).toBe(10)
    expect(cellsOf(deriveX(result.design.delta)).every(([row]) => row >= 3)).toBe(true)
  })

  it('handles the maximum 119 × 120 size without consecutive deviations or stitch conflicts', () => {
    const input = pixels(120, 119)
    for (let i = 0; i < input.data.length; i += 4) {
      const value = (i * 17 + (i % 23) * 51) % 256
      input.data.set([value, value, value, 255], i)
    }
    const result = convertPhotoPixels(input, settings)
    expect(result.design.delta).toHaveLength(119)
    expect(result.design.delta[0]).toHaveLength(120)
    expect(result.conflictCount).toBe(0)
    expect(cellsOf(conflicts(deriveX(result.design.delta)))).toEqual([])
    expect(parseDocument(toDocument(result.design)).ok).toBe(true)
    for (let r = 1; r < 119; r++) {
      for (let c = 0; c < 120; c++) expect(result.design.delta[r][c] && result.design.delta[r - 1][c]).toBe(false)
    }
  })

  it('chooses a minimum-error valid column, matching an exhaustive small-pattern oracle', () => {
    const input = pixels(5, 7)
    const gray = [0, 42, 90, 128, 170, 210, 255]
    for (let y = 0; y < 7; y++) {
      for (let c = 0; c < 5; c++) {
        const value = gray[(y * 3 + c * 4) % gray.length]
        input.data.set([value, value, value, 255], (y * 5 + c) * 4)
      }
    }
    for (const threshold of [35, 128, 221]) {
      for (const invert of [false, true]) {
        const result = convertPhotoPixels(input, { ...settings, threshold, invert })
        for (let c = 0; c < 5; c++) {
          const cost = (column: boolean[]) => column.reduce((sum, deviation, r) => {
            const value = input.data[((6 - r) * 5 + c) * 4]
            const wantsPattern = (value < threshold) !== invert
            const isPattern = (r % 2 === 1) !== deviation
            return sum + (isPattern === wantsPattern ? 0 : 1 + Math.abs(value - threshold))
          }, 0)
          let optimum = Infinity
          for (let mask = 0; mask < 32; mask++) {
            const column = [false, ...Array.from({ length: 5 }, (_, index) => Boolean(mask & (1 << index))), false]
            if (column.some((value, r) => value && column[r - 1])) continue
            optimum = Math.min(optimum, cost(column))
          }
          expect(cost(result.design.delta.map((row) => row[c]))).toBeCloseTo(optimum, 8)
        }
      }
    }
  })

  it('composites fully transparent pixels to white instead of interpreting their hidden black RGB', () => {
    const transparent = pixels(5, 7, 0)
    for (let i = 3; i < transparent.data.length; i += 4) transparent.data[i] = 0
    expect(convertPhotoPixels(transparent, settings).design.delta).toEqual(convertPhotoPixels(pixels(), settings).design.delta)
    expect(convertPhotoPixels(transparent, { ...settings, invert: true }).design.delta)
      .toEqual(convertPhotoPixels(pixels(), { ...settings, invert: true }).design.delta)
  })

  it('composites partially transparent pixels before thresholding', () => {
    const transparent = pixels(5, 7, 0)
    for (let i = 3; i < transparent.data.length; i += 4) transparent.data[i] = 128
    const result = convertPhotoPixels(transparent, { ...settings, threshold: 100 })
    expect(result.design.delta).toEqual(convertPhotoPixels(pixels(5, 7, 127), { ...settings, threshold: 100 }).design.delta)
  })

  it('inverts the desired motif without inverting the protected rows', () => {
    const normal = convertPhotoPixels(pixels(), settings)
    const inverted = convertPhotoPixels(pixels(), { ...settings, invert: true })
    expect(normal.design.delta).not.toEqual(inverted.design.delta)
    expect(inverted.design.delta[0].some(Boolean)).toBe(false)
    expect(inverted.design.delta[6].some(Boolean)).toBe(false)
    expect(inverted.adaptedCells).toBe(10)
  })

  it('responds to a changed threshold and permits the extreme endpoints', () => {
    const source = pixels(5, 7, 130)
    expect(convertPhotoPixels(source, { ...settings, threshold: 128 }).design.delta)
      .not.toEqual(convertPhotoPixels(source, { ...settings, threshold: 150 }).design.delta)
    expect(convertPhotoPixels(source, { ...settings, threshold: 0 }).conflictCount).toBe(0)
    expect(convertPhotoPixels(source, { ...settings, threshold: 255 }).conflictCount).toBe(0)
  })

  it('normalizes names and colors through the existing document contract without mutating input', () => {
    const input = pixels()
    const before = input.data.slice()
    const options = { ...settings, name: '  Olá\n\uD800  ', colors: { main: '#FFFFFF', pattern: '#000000' } }
    const result = convertPhotoPixels(input, options)
    expect(result.design.name).toBe('Olá')
    expect(result.design.colors).toEqual({ main: '#ffffff', pattern: '#000000' })
    expect(options.colors.main).toBe('#FFFFFF')
    expect(input.data).toEqual(before)
    expect(convertPhotoPixels(input, { ...settings, name: '' }).design.name).toBe('Estudo a partir de fotografia')
    expect([...convertPhotoPixels(input, { ...settings, name: '🧶'.repeat(120) }).design.name]).toHaveLength(100)
  })

  it.each([[4, 5], [121, 5], [5, 4], [5, 6], [5, 121], [5.5, 5], [NaN, 5]])('rejects dimensions %s × %s', (width, height) => {
    expect(() => convertPhotoPixels({ width, height, data: new Uint8ClampedArray(0) }, settings)).toThrow('Escolha')
  })

  it.each([-1, 256, NaN, Infinity])('rejects threshold %s', (threshold) => {
    expect(() => convertPhotoPixels(pixels(), { ...settings, threshold })).toThrow('contraste')
  })

  it('rejects truncated pixels and invalid yarn colors', () => {
    expect(() => convertPhotoPixels({ width: 5, height: 7, data: new Uint8ClampedArray(12) }, settings)).toThrow('pixels')
    expect(() => convertPhotoPixels(pixels(), { ...settings, colors: { main: 'linen', pattern: '#52384e' } })).toThrow('cores')
  })
})

describe('photo preparation', () => {
  it('selects a stable midpoint threshold for a clearly separated black and white photo', () => {
    const source = pixels()
    for (let i = 0; i < 60; i += 4) source.data.set([0, 0, 0, 255], i)
    expect(automaticPhotoThreshold(source)).toBe(128)
    expect(automaticPhotoThreshold(pixels())).toBe(128)
  })

  it('fits a photo without distortion and centers letterboxing', () => {
    expect(photoPlacement(200, 100, 20, 20, 'contain')).toEqual({ x: 0, y: 5, width: 20, height: 10 })
    expect(photoPlacement(100, 200, 20, 20, 'contain')).toEqual({ x: 5, y: 0, width: 10, height: 20 })
  })

  it('crops the center without distorting the photograph', () => {
    expect(photoPlacement(200, 100, 20, 20, 'cover')).toEqual({ x: -10, y: 0, width: 40, height: 20 })
    expect(photoPlacement(100, 200, 20, 20, 'cover')).toEqual({ x: 0, y: -10, width: 20, height: 40 })
  })

  it('rejects invalid source sizes', () => {
    expect(() => photoPlacement(0, 200, 20, 20, 'cover')).toThrow('dimensões')
    expect(() => photoPlacement(100, NaN, 20, 20, 'contain')).toThrow('dimensões')
  })
})
