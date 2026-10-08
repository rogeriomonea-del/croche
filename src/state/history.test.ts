import { describe, expect, it } from 'vitest'
import { deriveX, resolveClick } from '../core'
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
