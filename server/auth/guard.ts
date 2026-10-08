import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { User } from '../../src/shared/api'
import { sessionTtlMs, type AppContext } from '../context'
import { ApiError } from '../http/errors'
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookies'
import { resolveSession } from './sessions'
import { toUser } from './users'

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `app.requireUser`; null on routes that do not use it. */
    user: User | null
    /** SHA-256 of the session token that authenticated this request. */
    sessionTokenHash: string | null
  }
  interface FastifyInstance {
    /** preHandler: 401 `unauthenticated` without a live session, else sets `request.user`. */
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export function registerAuthGuard(app: FastifyInstance, { config, db, now }: AppContext): void {
  app.decorateRequest('user', null)
  app.decorateRequest('sessionTokenHash', null)
  app.decorate('requireUser', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readSessionCookie(request, config)
    const session = token === undefined ? null : resolveSession(db, token, now(), sessionTtlMs(config))
    if (token === undefined || !session) {
      // A stale cookie would otherwise be sent, and rejected, on every request.
      if (token !== undefined) clearSessionCookie(reply, config)
      throw new ApiError(401, 'unauthenticated', 'Sign in to continue')
    }
    if (session.renewed) setSessionCookie(reply, config, token)
    request.user = toUser(session.user)
    request.sessionTokenHash = session.tokenHash
  })
}

/** The signed-in user on a route guarded by `app.requireUser`. */
export function currentUser(request: FastifyRequest): User {
  if (!request.user) throw new ApiError(401, 'unauthenticated', 'Sign in to continue')
  return request.user
}
