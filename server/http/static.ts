import { existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../config'
import { sendError } from './errors'
import { isApiPath } from './security'

/**
 * The built SPA (SPEC §9.1): files from STATIC_DIR, and index.html for any other GET outside /api
 * so client-side routes survive a reload. Also owns the 404 handler, which stays JSON under /api.
 */
export async function registerStatic(app: FastifyInstance, config: Config): Promise<void> {
  const root = resolve(config.staticDir)
  const enabled = existsSync(join(root, 'index.html'))
  if (enabled) {
    await app.register(fastifyStatic, {
      root,
      prefix: '/',
      cacheControl: false,
      setHeaders(reply, filePath) {
        // Vite fingerprints everything under assets/, so those names never change content.
        const immutable = relative(root, filePath).startsWith(`assets${sep}`)
        reply.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
      },
    })
  } else {
    app.log.warn({ staticDir: root }, 'STATIC_DIR has no index.html; serving the API only')
  }

  app.setNotFoundHandler({ preHandler: app.rateLimit() }, async (request, reply) => {
    const path = request.url
    const spaRoute = (request.method === 'GET' || request.method === 'HEAD') && !isApiPath(path) && !path.startsWith('/assets/')
    // A missing /assets file is a stale or wrong link: HTML in its place would only break more loudly.
    if (enabled && spaRoute) return reply.code(200).sendFile('index.html')
    return sendError(reply, 404, 'not_found', 'Not found')
  })
}
