import { describe, expect, it } from 'vitest'
import { boundCache } from './analysis-cache'

describe('boundCache', () => {
  it('keeps the base entry and the most recent others', () => {
    const byKey: Record<string, number> = { base: 0 }
    for (let i = 1; i <= 30; i++) byKey[`bias:${i}`] = i
    const kept = boundCache(byKey, 'base', 8)
    expect(Object.keys(kept)).toEqual(['base', ...Array.from({ length: 8 }, (_, i) => `bias:${23 + i}`)])
    expect(kept['bias:30']).toBe(30)
  })

  it('returns the same object while under the limit', () => {
    const byKey = { base: 1, a: 2 }
    expect(boundCache(byKey, 'base', 8)).toBe(byKey)
  })

  it('works when the base entry is not there', () => {
    expect(Object.keys(boundCache({ a: 1, b: 2, c: 3 }, 'base', 2))).toEqual(['b', 'c'])
  })
})
