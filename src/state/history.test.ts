import { describe, expect, it } from 'vitest'
import { cellsOf, cellYarn, conflicts, deriveX, otherYarn, resolveClick } from '../core'
import { historyReducer, initialHistory } from './history'

describe('studio gesture history', () => {
  it('undoes and redoes a whole stroke, not each animation frame', () => {
    let state = historyReducer(initialHistory, { type: 'strokeStart' })
    state = historyReducer(state, { type: 'paint', cells: [{ r: 4, c: 2 }], value: true })
    state = historyReducer(state, {
      type: 'paint',
      cells: [
        { r: 4, c: 3 },
        { r: 4, c: 2 },
      ],
      value: true,
    })
    state = historyReducer(state, { type: 'strokeEnd' })
    expect(state.past).toHaveLength(1)
    const painted = state.present
    state = historyReducer(state, { type: 'undo' })
    expect(state.present.delta).toEqual(initialHistory.present.delta)
    state = historyReducer(state, { type: 'redo' })
    expect(state.present).toBe(painted)
    expect(deriveX(state.present.delta)[4].slice(1, 3)).toEqual([true, true])
  })
  it('keeps protected rows intact and erases idempotently', () => {
    let state = historyReducer(initialHistory, {
      type: 'paint',
      cells: [
        { r: 1, c: 1 },
        { r: 15, c: 1 },
      ],
      value: true,
    })
    expect(state).toBe(initialHistory)
    state = historyReducer(state, { type: 'paint', cells: [{ r: 6, c: 3 }], value: true })
    state = historyReducer(state, { type: 'paint', cells: [{ r: 6, c: 3 }], value: false })
    expect(state.present.delta[5][2]).toBe(false)
    expect(historyReducer(state, { type: 'paint', cells: [{ r: 6, c: 3 }], value: false })).toBe(state)
  })
  it('resolves a chart stroke to the underlying deviation and never stores X independently', () => {
    const target = resolveClick('schematic', 7, 4, 15)
    expect(target.ok).toBe(true)
    if (!target.ok) throw Error('Expected editable cell')
    const state = historyReducer(initialHistory, { type: 'paint', cells: [target], value: true })
    expect(state.present.delta[5][3]).toBe(true)
    expect(state.present.delta[6][3]).toBe(false)
    expect(deriveX(state.present.delta)[6][3]).toBe(true)
  })
  it('paints one yarn when a simulation stroke crosses rows, without conflicts', () => {
    const column = [3, 4, 5, 6, 7, 8].map((r) => resolveClick('simulation', r, 5, 15))
    const cells = column.map((target) => {
      if (!target.ok) throw Error('Expected editable cell')
      return target
    })
    const yarn = otherYarn(cellYarn(initialHistory.present.delta, 3, 5))
    let state = historyReducer(initialHistory, { type: 'strokeStart' })
    state = historyReducer(state, { type: 'paint', cells: cells.slice(0, 3), value: yarn })
    state = historyReducer(state, { type: 'paint', cells: cells.slice(2), value: yarn })
    state = historyReducer(state, { type: 'strokeEnd' })
    expect(cells.map(({ r, c }) => cellYarn(state.present.delta, r, c))).toEqual(Array(6).fill('pattern'))
    expect(cellsOf(conflicts(deriveX(state.present.delta)))).toEqual([])
    expect(state.past).toHaveLength(1)
  })
  it('keeps a cleared drawing restorable after a long colour drag and typing a name', () => {
    let state = historyReducer(initialHistory, { type: 'toggle', r: 4, c: 2 })
    const drawing = state.present.delta
    state = historyReducer(state, { type: 'clear' })
    for (let i = 0; i < 120; i++) {
      state = historyReducer(state, { type: 'setColor', yarn: 'pattern', color: `#0000${(i + 16).toString(16).padStart(2, '0')}` })
    }
    let name = ''
    for (const letter of 'Um nome bem comprido para o padrão de teste') {
      name += letter
      state = historyReducer(state, { type: 'rename', name })
    }
    expect(state.past).toHaveLength(4)
    state = historyReducer(state, { type: 'undo' })
    expect(state.present.name).toBe(initialHistory.present.name)
    state = historyReducer(state, { type: 'undo' })
    expect(state.present.colors).toEqual(initialHistory.present.colors)
    state = historyReducer(state, { type: 'undo' })
    expect(state.present.delta).toBe(drawing)
  })
  it('records each yarn separately and applies a palette as one step', () => {
    let state = historyReducer(initialHistory, { type: 'setColor', yarn: 'main', color: '#111111' })
    state = historyReducer(state, { type: 'setColor', yarn: 'pattern', color: '#222222' })
    state = historyReducer(state, { type: 'setColor', yarn: 'main', color: '#333333' })
    expect(state.past).toHaveLength(3)
    const before = state.present.colors
    state = historyReducer(state, { type: 'setPalette', colors: { main: '#f1ddca', pattern: '#a85943' } })
    expect(state.present.colors).toEqual({ main: '#f1ddca', pattern: '#a85943' })
    state = historyReducer(state, { type: 'undo' })
    expect(state.present.colors).toEqual(before)
  })
  it('clears redo on a fresh edit and resets history when opening another document', () => {
    let state = historyReducer(initialHistory, { type: 'toggle', r: 4, c: 2 })
    state = historyReducer(state, { type: 'undo' })
    state = historyReducer(state, { type: 'rename', name: 'A new study' })
    expect(state.future).toEqual([])
    state = historyReducer(state, { type: 'load', design: initialHistory.present })
    expect(state.past).toEqual([])
    expect(state.future).toEqual([])
  })
})
