import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAuthGuard } from './auth/guard'
import { getDummyHash } from './auth/passwords'
import { registerAuthRoutes } from './auth/routes'
import { purgeExpiredSessions } from './auth/sessions'
import { LoginThrottle } from './auth/throttle'
import type { Config, TrustProxy } from './config'
import type { AppContext } from './context'
import type { Database } from './db'
import { ApiError, registerErrorHandler } from './http/errors'
import { registerJsonOnly } from './http/json'
import { isApiPath, registerSecurity } from './http/security'
import { registerStatic } from './http/static'

export const BODY_LIMIT = 256 * 1024
const PURGE_INTERVAL_MS = 60 * 60 * 1000

export interface BuildAppOptions {
  config: Config
  db: Database
  /** Epoch milliseconds; tests inject a clock to expire and renew sessions. */
  now?: () => number
}

/**
 * Fastify 5 treats a numeric trustProxy as "trust nothing", which would put every visitor behind
 * the reverse proxy in one rate-limit bucket. A hop count keeps its Express meaning instead: trust
 * the nearest `hops` addresses. That trusts the peer unchecked, so it is only safe while the
 * server is reachable through the proxy alone (HOST=127.0.0.1); an address list is stricter.
 */
export function trustProxyOption(value: TrustProxy): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (typeof value !== 'number') return value
  return (_address, hop) => hop < value
}

export async function buildApp({ config, db, now = Date.now }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Bodies are never logged (Fastify's serializers leave them out); these keep credentials out
      // of any log line that does include headers.
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
    bodyLimit: BODY_LIMIT,
    trustProxy: trustProxyOption(config.trustProxy),
    ajv: {
      // Reject what the schema does not describe instead of silently dropping or converting it.
      customOptions: { removeAdditional: false, coerceTypes: false, allErrors: true },
    },
  })

  const ctx: AppContext = { config, db, now, loginThrottle: new LoginThrottle() }

  registerErrorHandler(app)
  registerJsonOnly(app)
  await app.register(cookie)
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: 60_000,
    // SPEC §9.3 limits /api; the SPA's files are cheap and cached.
    allowList: (request) => !isApiPath(request.url),
    errorResponseBuilder: () => new ApiError(429, 'rate_limited', 'Too many requests; try again later'),
  })
  await registerSecurity(app, config)
  registerAuthGuard(app, ctx)

  app.get('/api/health', async () => {
    db.prepare('SELECT 1').get()
    return { ok: true }
  })
  registerAuthRoutes(app, ctx)
  await registerStatic(app, config)

  const purge = () => {
    purgeExpiredSessions(db, now())
    ctx.loginThrottle.sweep(now())
  }
  purge()
  const timer = setInterval(() => {
    try {
      purge()
    } catch (err) {
      app.log.error({ err }, 'expired session purge failed')
    }
  }, PURGE_INTERVAL_MS)
  timer.unref()
  app.addHook('onClose', async () => clearInterval(timer))

  // Hash the dummy password now rather than on the first login for an unknown e-mail.
  await getDummyHash()
  return app
}
