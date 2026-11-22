import { describe, expect, it, vi } from 'vitest'
import { createWakeLock, type WakeLockEnvironment } from './wake-lock'

class FakeSentinel {
  released = false
  release = vi.fn(async () => {
    this.released = true
  })
}

function environment() {
  const listeners = new Set<() => void>()
  const sentinels: FakeSentinel[] = []
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: vi.fn((_type: string, fn: () => void) => listeners.add(fn)),
    removeEventListener: vi.fn((_type: string, fn: () => void) => listeners.delete(fn)),
  }
  const request = vi.fn(async (type: 'screen') => {
    expect(type).toBe('screen')
    const s = new FakeSentinel()
    sentinels.push(s)
    return s
  })
  const env = { navigator: { wakeLock: { request } }, document: doc } as unknown as WakeLockEnvironment
  const fire = async () => {
    for (const fn of [...listeners]) fn()
    await Promise.resolve()
    await Promise.resolve()
  }
  return { env, doc, request, sentinels, listeners, fire }
}

describe('createWakeLock', () => {
  it('is an unsupported no-op without navigator.wakeLock', async () => {
    const lock = createWakeLock({ navigator: {}, document: environment().doc as unknown as WakeLockEnvironment['document'] })
    expect(lock.supported).toBe(false)
    await expect(lock.enable()).resolves.toBeUndefined()
    await expect(lock.disable()).resolves.toBeUndefined()
    expect(createWakeLock(undefined).supported).toBe(false)
  })

  it('requests a screen lock on enable and releases it on disable', async () => {
    const { env, request, sentinels, listeners } = environment()
    const lock = createWakeLock(env)
    await lock.enable()
    expect(request).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(1)
    await lock.enable()
    expect(request).toHaveBeenCalledTimes(1)
    await lock.disable()
    expect(sentinels[0].release).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(0)
  })

  it('re-acquires after the page becomes visible again', async () => {
    const { env, doc, request, sentinels, fire } = environment()
    const lock = createWakeLock(env)
    await lock.enable()
    // The browser releases the lock when the page is hidden.
    sentinels[0].released = true
    doc.visibilityState = 'hidden'
    await fire()
    expect(request).toHaveBeenCalledTimes(1)
    doc.visibilityState = 'visible'
    await fire()
    expect(request).toHaveBeenCalledTimes(2)
    await lock.disable()
    expect(sentinels[1].release).toHaveBeenCalledTimes(1)
  })

  it('does not request while hidden or after disable', async () => {
    const { env, doc, request, fire } = environment()
    doc.visibilityState = 'hidden'
    const lock = createWakeLock(env)
    await lock.enable()
    expect(request).not.toHaveBeenCalled()
    await lock.disable()
    doc.visibilityState = 'visible'
    await fire()
    expect(request).not.toHaveBeenCalled()
  })

  it('stays silent when the request is refused', async () => {
    const { env, request } = environment()
    request.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    const lock = createWakeLock(env)
    await expect(lock.enable()).resolves.toBeUndefined()
    await expect(lock.disable()).resolves.toBeUndefined()
  })

  it('releases a lock that arrives after disable', async () => {
    const { env, request } = environment()
    let resolve!: (s: FakeSentinel) => void
    const late = new FakeSentinel()
    request.mockImplementationOnce(() => new Promise<FakeSentinel>((r) => (resolve = r)))
    const lock = createWakeLock(env)
    const enabling = lock.enable()
    const disabling = lock.disable()
    resolve(late)
    await enabling
    await disabling
    expect(late.release).toHaveBeenCalledTimes(1)
  })
})
