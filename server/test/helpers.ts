import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { buildApp } from '../app'
import { loadConfig, type Config } from '../config'
import { openDatabase, type Database } from '../db'

export const ORIGIN = 'http://localhost:5173'
export const T0 = Date.parse('2026-10-08T12:00:00.000Z')
export const PASSWORD = 'correct horse battery'

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({ NODE_ENV: 'test', PUBLIC_ORIGIN: ORIGIN, STATIC_DIR: '/nonexistent-static-dir', LOG_LEVEL: 'silent' }),
    ...overrides,
  }
}

export interface TestApp {
  app: FastifyInstance
  db: Database
  config: Config
  clock: { now: number; advance(ms: number): void }
  close(): Promise<void>
}

export async function makeApp(overrides: Partial<Config> = {}): Promise<TestApp> {
  const config = testConfig(overrides)
  const db = openDatabase(':memory:')
  const clock = {
    now: T0,
    advance(ms: number) {
      this.now += ms
    },
  }
  const app = await buildApp({ config, db, now: () => clock.now })
  return {
    app,
    db,
    config,
    clock,
    async close() {
      await app.close()
      if (db.open) db.close()
    },
  }
}

export interface PostOptions {
  cookie?: string
  remoteAddress?: string
  origin?: string
}

export function postJson(app: FastifyInstance, url: string, body: unknown, opts: PostOptions = {}) {
  return app.inject({
    method: 'POST',
    url,
    payload: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(opts.origin ? { origin: opts.origin } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    remoteAddress: opts.remoteAddress,
  })
}

export function get(app: FastifyInstance, url: string, cookie?: string) {
  return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })
}

/** The Set-Cookie header lines of a response. */
export function setCookies(res: LightMyRequestResponse): string[] {
  const header = res.headers['set-cookie']
  if (header === undefined) return []
  return Array.isArray(header) ? header : [header]
}

/** `name=value` of the first Set-Cookie line, ready to send back as a Cookie header. */
export function sessionCookie(res: LightMyRequestResponse): string {
  const line = setCookies(res)[0]
  if (!line) throw new Error(`No Set-Cookie in response ${res.statusCode}: ${res.body}`)
  return line.split(';')[0]
}
