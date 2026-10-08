import helmet from '@fastify/helmet'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../config'
import { ApiError } from './errors'

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isApiPath(url: string): boolean {
  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')
}

/** SPEC §9.3 headers, Origin check and body content type. */
export async function registerSecurity(app: FastifyInstance, config: Config) {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    // Sent over plain HTTP, HSTS would be ignored at best and pin a dev host to HTTPS at worst.
    strictTransportSecurity: config.cookieSecure ? { maxAge: 31_536_000, includeSubDomains: false } : false,
  })

  // Browsers send Origin on every cross-site POST/PUT/PATCH/DELETE, so a missing header means the
  // request did not come from another site's page (curl, the CLI, old same-origin forms).
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (STATE_CHANGING.has(request.method) && origin !== undefined && origin !== config.publicOrigin) {
      throw new ApiError(403, 'bad_origin', 'Request origin is not allowed')
    }
    // Responses carry account data; no cache in between should keep a copy.
    if (isApiPath(request.url)) reply.header('cache-control', 'no-store')
  })
}
