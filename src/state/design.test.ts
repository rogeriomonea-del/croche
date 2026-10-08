import { describe, expect, it } from 'vitest'
import { cellsOf, emptyMatrix, toggle, type DesignData } from '../core'
import { DEFAULT_NAME, designReducer, initialDesign, type Design } from './design'

const drawn: Design = {
  name: 'Diamonds',
  delta: [[3, 2], [9, 4], [13, 18]].reduce((d, [r, c]) => toggle(d, r, c), emptyMatrix(15, 20)),
  colors: { main: '#f3ead8', pattern: '#0f766e' },
}

describe('designReducer', () => {
  it('starts as an untitled 15 × 20 pattern', () => {
    expect(initialDesign.name).toBe(DEFAULT_NAME)
    expect(DEFAULT_NAME).toBe('Novo padrão')
    expect([initialDesign.delta.length, initialDesign.delta[0].length]).toEqual([15, 20])
    expect(cellsOf(initialDesign.delta)).toEqual([])
  })

  it('load replaces name, drawing and colors', () => {
    const loaded: DesignData = {
      name: 'Waves',
      delta: toggle(emptyMatrix(21, 30), 5, 7),
      colors: { main: '#ffffff', pattern: '#000000' },
    }
    const next = designReducer(drawn, { type: 'load', design: loaded })
    expect(next).toEqual(loaded)
    expect([next.delta.length, next.delta[0].length]).toEqual([21, 30])
  })

  it('load does not share the colors object with the loaded data', () => {
    const loaded: DesignData = { name: 'Waves', delta: emptyMatrix(5, 5), colors: { main: '#ffffff', pattern: '#000000' } }
    const next = designReducer(drawn, { type: 'load', design: loaded })
    const recolored = designReducer(next, { type: 'setColor', yarn: 'main', color: '#123456' })
    expect(recolored.colors.main).toBe('#123456')
    expect(loaded.colors.main).toBe('#ffffff')
  })

  it('rename changes only the name, kept exactly as typed', () => {
    const next = designReducer(drawn, { type: 'rename', name: 'Diamonds ' })
    expect(next.name).toBe('Diamonds ')
    expect(next.delta).toBe(drawn.delta)
    expect(next.colors).toBe(drawn.colors)
  })

  it('rename to the same name keeps the state', () => {
    expect(designReducer(drawn, { type: 'rename', name: 'Diamonds' })).toBe(drawn)
  })

  it('clear empties the drawing but keeps name, size and colors', () => {
    const next = designReducer(drawn, { type: 'clear' })
    expect(cellsOf(next.delta)).toEqual([])
    expect([next.delta.length, next.delta[0].length]).toEqual([15, 20])
    expect(next.name).toBe('Diamonds')
    expect(next.colors).toEqual(drawn.colors)
  })

  it('toggle flips one cell and keeps the name (§3.2)', () => {
    const next = designReducer(drawn, { type: 'toggle', r: 5, c: 5 })
    expect(cellsOf(next.delta)).toEqual([[3, 2], [5, 5], [9, 4], [13, 18]])
    expect(next.name).toBe('Diamonds')
    expect(cellsOf(designReducer(next, { type: 'toggle', r: 5, c: 5 }).delta)).toEqual(cellsOf(drawn.delta))
  })

  it('toggle reuses the rows it did not touch, so the grid redraws only the changed row', () => {
    const next = designReducer(drawn, { type: 'toggle', r: 5, c: 5 })
    next.delta.forEach((row, i) => (i === 4 ? expect(row).not.toBe(drawn.delta[i]) : expect(row).toBe(drawn.delta[i])))
  })

  it.each([1, 15])('toggle on locked row %i returns the same state (§4)', (r) => {
    expect(designReducer(drawn, { type: 'toggle', r, c: 3 })).toBe(drawn)
  })

  it('resize, colors and swap keep the name', () => {
    const resized = designReducer(drawn, { type: 'resize', rows: 21, cols: 30 })
    expect(resized.name).toBe('Diamonds')
    expect(cellsOf(resized.delta)).toEqual(cellsOf(drawn.delta))
    expect(designReducer(drawn, { type: 'setColor', yarn: 'pattern', color: '#aa0000' }).name).toBe('Diamonds')
    const swapped = designReducer(drawn, { type: 'swapColors' })
    expect(swapped.name).toBe('Diamonds')
    expect(swapped.colors).toEqual({ main: '#0f766e', pattern: '#f3ead8' })
  })
})
