// Keeps the screen awake while crocheting (Screen Wake Lock API). The browser drops the lock when
// the page is hidden, so it is requested again when the page becomes visible. Silent no-op where
// the API is missing or the request is refused.

export interface ScreenWakeLock {
  readonly supported: boolean
  /** Ask to keep the screen on until disable() (re-acquired after the page comes back). */
  enable(): Promise<void>
  disable(): Promise<void>
}

interface Sentinel {
  released: boolean
  release(): Promise<void>
}

export interface WakeLockEnvironment {
  navigator?: { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
}

const SILENT: ScreenWakeLock = { supported: false, enable: async () => {}, disable: async () => {} }

export function createWakeLock(
  env: WakeLockEnvironment | undefined = typeof window === 'undefined' ? undefined : { navigator: window.navigator as WakeLockEnvironment['navigator'], document },
): ScreenWakeLock {
  const api = env?.navigator?.wakeLock
  const doc = env?.document
  if (!api || typeof api.request !== 'function' || !doc) return SILENT

  let wanted = false
  let sentinel: Sentinel | null = null
  let pending: Promise<void> | null = null

  async function acquire(): Promise<void> {
    if (!wanted || doc!.visibilityState !== 'visible') return
    if (sentinel && !sentinel.released) return
    if (pending) return pending
    pending = (async () => {
      try {
        const lock = await api!.request('screen')
        if (wanted) sentinel = lock
        else await lock.release().catch(() => {})
      } catch {
        // Refused (battery saver, permissions policy, page not visible): nothing to do.
      } finally {
        pending = null
      }
    })()
    return pending
  }

  const onVisibility = () => {
    void acquire()
  }

  return {
    supported: true,
    async enable() {
      if (!wanted) {
        wanted = true
        doc.addEventListener('visibilitychange', onVisibility)
      }
      await acquire()
    },
    async disable() {
      if (wanted) {
        wanted = false
        doc.removeEventListener('visibilitychange', onVisibility)
      }
      if (pending) await pending
      const lock = sentinel
      sentinel = null
      if (lock && !lock.released) await lock.release().catch(() => {})
    },
  }
}
