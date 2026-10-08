import type { LoginThrottle } from './auth/throttle'
import type { Config } from './config'
import type { Database } from './db'

/** What route modules need from the app; built once in buildApp. */
export interface AppContext {
  config: Config
  db: Database
  /** Epoch milliseconds; injectable so tests can move time. */
  now: () => number
  loginThrottle: LoginThrottle
}

export const DAY_MS = 24 * 60 * 60 * 1000

export function sessionTtlMs(config: Config): number {
  return config.sessionTtlDays * DAY_MS
}
