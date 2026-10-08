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

  it('stays within maxEntries: expired entries go first, then the oldest', () => {
    const throttle = new LoginThrottle({ maxEntries: 3, maxFailures: 1 })
    throttle.recordFailure('old@x.io', 0)
    throttle.recordFailure('b@x.io', WINDOW / 2)
    throttle.recordFailure('c@x.io', WINDOW / 2)
    // old@ has expired by now and is swept to make room.
    throttle.recordFailure('d@x.io', WINDOW)
    expect(throttle.size).toBe(3)
    expect(throttle.lockedFor('b@x.io', WINDOW)).toBeGreaterThan(0)
    // Nothing expired: the oldest live entry is evicted.
    throttle.recordFailure('e@x.io', WINDOW)
    expect(throttle.size).toBe(3)
    expect(throttle.lockedFor('b@x.io', WINDOW)).toBe(0)
    expect(throttle.lockedFor('e@x.io', WINDOW)).toBeGreaterThan(0)
    for (let i = 0; i < 1000; i++) throttle.recordFailure(`spray${i}@x.io`, WINDOW)
    expect(throttle.size).toBe(3)
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
