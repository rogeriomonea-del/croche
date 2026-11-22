import { describe, expect, it } from 'vitest'
import { formatUpdated } from './format'

describe('formatUpdated', () => {
  const now = new Date('2026-10-08T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const minute = 60_000

  it.each([
    [ago(5_000), 'just now'],
    [ago(-30_000), 'just now'],
    [ago(5 * minute), '5 min ago'],
    [ago(3 * 60 * minute + 59 * minute), '3 h ago'],
    [ago(30 * 60 * minute), 'yesterday'],
    [ago(4 * 24 * 60 * minute), '4 days ago'],
  ])('%s → %s', (iso, text) => {
    expect(formatUpdated(iso, now)).toBe(text)
  })

  it('falls back to a short date after a week', () => {
    // ICU versions differ on 'Sep' and 'Sept'.
    expect(formatUpdated('2026-09-01T12:00:00Z', now, 'en-GB')).toMatch(/^1 Sept? 2026$/)
  })

  it('is empty for an unreadable date', () => {
    expect(formatUpdated('not a date', now)).toBe('')
  })
})
