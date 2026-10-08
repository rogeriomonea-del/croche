// SPEC §9.3: 10 failed logins for one e-mail within 15 minutes lock that e-mail until the window
// closes, whatever IP the attempts come from. In memory: a restart forgives, which is acceptable
// for one process on one VPS, and the per-IP limit still applies.

export interface LoginThrottleOptions {
  maxFailures?: number
  windowMs?: number
  /** Upper bound on tracked e-mails, so a spray of random addresses cannot grow memory forever. */
  maxEntries?: number
}

interface Entry {
  windowStart: number
  failures: number
}

export class LoginThrottle {
  readonly maxFailures: number
  readonly windowMs: number
  readonly maxEntries: number
  // Insertion order = window start order, so the first of equals is the oldest.
  private readonly entries = new Map<string, Entry>()

  constructor({ maxFailures = 10, windowMs = 15 * 60 * 1000, maxEntries = 10_000 }: LoginThrottleOptions = {}) {
    this.maxFailures = maxFailures
    this.windowMs = windowMs
    this.maxEntries = maxEntries
  }

  /** Milliseconds until `email` may try again, or 0 when it is not locked. */
  lockedFor(email: string, now: number): number {
    const entry = this.live(email, now)
    if (!entry || entry.failures < this.maxFailures) return 0
    return entry.windowStart + this.windowMs - now
  }

  recordFailure(email: string, now: number): void {
    const entry = this.live(email, now)
    if (entry) {
      entry.failures++
      return
    }
    if (this.entries.size >= this.maxEntries) this.sweep(now)
    if (this.entries.size >= this.maxEntries && !this.evictLeastFailed()) return
    this.entries.set(email, { windowStart: now, failures: 1 })
  }

  reset(email: string): void {
    this.entries.delete(email)
  }

  /** Drops entries whose window has closed. */
  sweep(now: number): void {
    for (const [email, entry] of this.entries) {
      if (now - entry.windowStart >= this.windowMs) this.entries.delete(email)
    }
  }

  get size(): number {
    return this.entries.size
  }

  /**
   * Makes room by dropping the entry with the fewest failures (the oldest among equals), so a spray
   * of one-off addresses cannot push out the count of an account under attack. A locked entry is
   * never dropped: when every entry is locked the new address goes untracked instead.
   */
  private evictLeastFailed(): boolean {
    let victim: string | undefined
    let fewest = this.maxFailures
    for (const [email, entry] of this.entries) {
      if (entry.failures < fewest) {
        victim = email
        fewest = entry.failures
      }
    }
    if (victim === undefined) return false
    this.entries.delete(victim)
    return true
  }

  private live(email: string, now: number): Entry | undefined {
    const entry = this.entries.get(email)
    if (entry && now - entry.windowStart >= this.windowMs) {
      this.entries.delete(email)
      return undefined
    }
    return entry
  }
}
