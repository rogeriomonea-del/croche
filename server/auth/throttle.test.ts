import { describe, expect, it } from 'vitest'
import { LoginThrottle } from './throttle'

const WINDOW = 15 * 60 * 1000

describe('LoginThrottle', () => {
  it('locks at the 10th failure for the rest of the window, counted from the first', () => {
    const throttle = new LoginThrottle()
    for (let i = 0; i < 9; i++) throttle.recordFailure('a@x.io', i * 1000)
    expect(throttle.lockedFor('a@x.io', 9000)).toBe(0)
    throttle.recordFailure('a@x.io', 9000)
    expect(throttle.lockedFor('a@x.io', 9000)).toBe(WINDOW - 9000)
    expect(throttle.lockedFor('a@x.io', WINDOW - 1)).toBe(1)
    expect(throttle.lockedFor('a@x.io', WINDOW)).toBe(0)
  })

  it('starts a new window once the old one has closed', () => {
    const throttle = new LoginThrottle({ maxFailures: 2 })
    throttle.recordFailure('a@x.io', 0)
    throttle.recordFailure('a@x.io', WINDOW)
    expect(throttle.lockedFor('a@x.io', WINDOW)).toBe(0)
    throttle.recordFailure('a@x.io', WINDOW + 1)
    expect(throttle.lockedFor('a@x.io', WINDOW + 1)).toBe(WINDOW - 1)
  })

  it('stays within maxEntries: expired entries go first, then the fewest failures, never a locked one', () => {
    const throttle = new LoginThrottle({ maxEntries: 3, maxFailures: 3 })
    throttle.recordFailure('old@x.io', 0)
    for (let i = 0; i < 2; i++) throttle.recordFailure('b@x.io', WINDOW / 2)
    throttle.recordFailure('c@x.io', WINDOW / 2)
    // old@ has expired by now and is swept to make room.
    throttle.recordFailure('d@x.io', WINDOW)
    expect(throttle.size).toBe(3)
    // Nothing expired: the oldest of the least-failed (c@, 1 failure) goes, not b@ (2).
    throttle.recordFailure('e@x.io', WINDOW)
    expect(throttle.size).toBe(3)
    throttle.recordFailure('b@x.io', WINDOW)
    expect(throttle.lockedFor('b@x.io', WINDOW)).toBeGreaterThan(0)
    for (let i = 0; i < 1000; i++) throttle.recordFailure(`spray${i}@x.io`, WINDOW)
    expect(throttle.size).toBe(3)
    expect(throttle.lockedFor('b@x.io', WINDOW)).toBeGreaterThan(0)
  })

  it('keeps a locked e-mail locked after maxEntries other addresses fail', () => {
    const throttle = new LoginThrottle()
    for (let i = 0; i < 10; i++) throttle.recordFailure('victim@x.io', i)
    for (let i = 0; i < throttle.maxEntries; i++) throttle.recordFailure(`junk${i}@x.io`, 1000 + i)
    expect(throttle.size).toBe(throttle.maxEntries)
    expect(throttle.lockedFor('victim@x.io', 20_000)).toBe(WINDOW - 20_000)
  })

  it('keeps a nearly locked e-mail counting through a spray', () => {
    const throttle = new LoginThrottle({ maxEntries: 100 })
    for (let i = 0; i < 9; i++) throttle.recordFailure('victim@x.io', i)
    for (let i = 0; i < 1000; i++) throttle.recordFailure(`junk${i}@x.io`, 100 + i)
    throttle.recordFailure('victim@x.io', 2000)
    expect(throttle.lockedFor('victim@x.io', 2000)).toBe(WINDOW - 2000)
  })

  it('leaves new addresses untracked rather than drop a locked one when every entry is locked', () => {
    const throttle = new LoginThrottle({ maxEntries: 2, maxFailures: 1 })
    throttle.recordFailure('a@x.io', 0)
    throttle.recordFailure('b@x.io', 0)
    throttle.recordFailure('c@x.io', 0)
    expect(throttle.size).toBe(2)
    expect(throttle.lockedFor('a@x.io', 0)).toBeGreaterThan(0)
    expect(throttle.lockedFor('b@x.io', 0)).toBeGreaterThan(0)
    expect(throttle.lockedFor('c@x.io', 0)).toBe(0)
  })

  it('sweep drops closed windows; reset forgets an e-mail', () => {
    const throttle = new LoginThrottle()
    throttle.recordFailure('a@x.io', 0)
    throttle.recordFailure('b@x.io', 10)
    throttle.sweep(WINDOW + 5)
    expect(throttle.size).toBe(1)
    throttle.reset('b@x.io')
    expect(throttle.size).toBe(0)
  })
})
