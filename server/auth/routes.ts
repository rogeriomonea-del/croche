import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  emailError,
  normalizeEmail,
  PASSWORD_MAX,
  passwordError,
  type AuthConfig,
  type ChangePasswordRequest,
  type Credentials,
  type DeleteAccountRequest,
  type User,
} from '../../src/shared/api'
import { sessionTtlMs, type AppContext } from '../context'
import { ApiError, invalidInput } from '../http/errors'
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookies'
import { currentUser } from './guard'
import { getDummyHash, hashPassword, verifyPassword } from './passwords'
import { createSession, deleteSession, deleteUserSessions, hashToken } from './sessions'
import { deleteUser, EmailTakenError, findUserByEmail, findUserById, insertUser, toUser, updatePasswordHash } from './users'

// SPEC §9.3: 10 per minute per IP on every endpoint that checks a password.
const AUTH_RATE_LIMIT = { max: 10, timeWindow: 60_000 }

function bodySchema<K extends string>(...keys: K[]) {
  return {
    type: 'object',
    required: keys,
    additionalProperties: false,
    properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])),
  }
}

const invalidCredentials = () => new ApiError(401, 'invalid_credentials', 'Incorrect e-mail or password')

/** Login only checks what any stored account must satisfy, so tightening the signup rules later locks no one out. */
function loginPasswordError(password: string): string | null {
  if (password === '') return 'Password is required'
  // Fewer UTF-16 units than the maximum cannot be too many code points.
  return password.length > PASSWORD_MAX ? passwordError(password) : null
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, db, now, loginThrottle } = ctx
  const ttl = sessionTtlMs(config)

  function startSession(reply: FastifyReply, userId: string) {
    const { token } = createSession(db, userId, now(), ttl)
    setSessionCookie(reply, config, token)
  }

  // Wrong passwords count against the e-mail wherever they are typed, so a borrowed session cannot
  // guess the password any faster than a login form can.
  function assertNotLocked(reply: FastifyReply, email: string) {
    const lockedMs = loginThrottle.lockedFor(email, now())
    if (lockedMs > 0) {
      reply.header('retry-after', Math.ceil(lockedMs / 1000))
      throw new ApiError(429, 'rate_limited', 'Too many wrong passwords for this account; try again later')
    }
  }

  async function checkSessionPassword(reply: FastifyReply, user: User, password: string): Promise<boolean> {
    assertNotLocked(reply, user.email)
    const row = findUserById(db, user.id)
    const ok = row !== undefined && (await verifyPassword(row.password_hash, password))
    if (ok) loginThrottle.reset(user.email)
    else loginThrottle.recordFailure(user.email, now())
    return ok
  }

  app.get('/api/auth/config', async (): Promise<AuthConfig> => ({ signupEnabled: config.allowSignup }))

  app.post<{ Body: Credentials }>(
    '/api/auth/signup',
    {
      schema: { body: bodySchema('email', 'password') },
      config: { rateLimit: AUTH_RATE_LIMIT },
      // Before validation, so a closed server answers the same whatever the body.
      preValidation: async () => {
        if (!config.allowSignup) throw new ApiError(403, 'signup_disabled', 'Sign-up is disabled on this server')
      },
    },
    async (request, reply): Promise<{ user: User }> => {
      const email = normalizeEmail(request.body.email)
      const fields: Record<string, string> = {}
      const emailProblem = emailError(email)
      const passwordProblem = passwordError(request.body.password)
      if (emailProblem) fields.email = emailProblem
      if (passwordProblem) fields.password = passwordProblem
      if (emailProblem || passwordProblem) throw invalidInput(fields)

      const emailTaken = () => new ApiError(409, 'email_taken', 'An account with this e-mail already exists')
      if (findUserByEmail(db, email)) throw emailTaken()
      const passwordHash = await hashPassword(request.body.password)
      let user
      try {
        user = insertUser(db, email, passwordHash, now())
      } catch (err) {
        // Two sign-ups for one address raced past the check above.
        if (err instanceof EmailTakenError) throw emailTaken()
        throw err
      }
      startSession(reply, user.id)
      reply.code(201)
      return { user: toUser(user) }
    },
  )

  app.post<{ Body: Credentials }>(
    '/api/auth/login',
    { schema: { body: bodySchema('email', 'password') }, config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply): Promise<{ user: User }> => {
      const email = normalizeEmail(request.body.email)
      const { password } = request.body
      const fields: Record<string, string> = {}
      const emailProblem = emailError(email)
      const passwordProblem = loginPasswordError(password)
      if (emailProblem) fields.email = emailProblem
      if (passwordProblem) fields.password = passwordProblem
      if (emailProblem || passwordProblem) throw invalidInput(fields)

      assertNotLocked(reply, email)

      const user = findUserByEmail(db, email)
      let ok = false
      if (user) ok = await verifyPassword(user.password_hash, password)
      // Unknown e-mails pay for a verification too, so response time does not reveal which exist.
      else await verifyPassword(await getDummyHash(), password)
      if (!user || !ok) {
        loginThrottle.recordFailure(email, now())
        throw invalidCredentials()
      }
      loginThrottle.reset(email)

      // A fresh token on every sign-in; the one the browser held (if any) stops working.
      const previous = readSessionCookie(request, config)
      if (previous !== undefined) deleteSession(db, hashToken(previous))
      startSession(reply, user.id)
      return { user: toUser(user) }
    },
  )

  app.post('/api/auth/logout', async (request, reply) => {
    const token = readSessionCookie(request, config)
    if (token !== undefined) deleteSession(db, hashToken(token))
    clearSessionCookie(reply, config)
    return reply.code(204).send()
  })

  app.get('/api/auth/me', { preHandler: app.requireUser }, async (request): Promise<{ user: User }> => ({
    user: currentUser(request),
  }))

  app.post<{ Body: ChangePasswordRequest }>(
    '/api/auth/password',
    {
      schema: { body: bodySchema('currentPassword', 'newPassword') },
      config: { rateLimit: AUTH_RATE_LIMIT },
      preHandler: app.requireUser,
    },
    async (request, reply) => {
      const user = currentUser(request)
      const { currentPassword, newPassword } = request.body
      const fields: Record<string, string> = {}
      const currentProblem = loginPasswordError(currentPassword)
      const newProblem = passwordError(newPassword)
      if (currentProblem) fields.currentPassword = currentProblem
      if (newProblem) fields.newPassword = newProblem
      if (currentProblem || newProblem) throw invalidInput(fields)

      if (!(await checkSessionPassword(reply, user, currentPassword))) {
        throw new ApiError(401, 'invalid_credentials', 'Current password is incorrect')
      }
      const passwordHash = await hashPassword(newPassword)
      db.transaction(() => {
        updatePasswordHash(db, user.id, passwordHash, now())
        // Whoever else held a session (perhaps the reason for the change) is signed out.
        deleteUserSessions(db, user.id, request.sessionTokenHash ?? undefined)
      })()
      return reply.code(204).send()
    },
  )

  app.post<{ Body: DeleteAccountRequest }>(
    '/api/auth/delete-account',
    { schema: { body: bodySchema('password') }, config: { rateLimit: AUTH_RATE_LIMIT }, preHandler: app.requireUser },
    async (request, reply) => {
      const user = currentUser(request)
      const passwordProblem = loginPasswordError(request.body.password)
      if (passwordProblem) throw invalidInput({ password: passwordProblem })
      if (!(await checkSessionPassword(reply, user, request.body.password))) {
        throw new ApiError(401, 'invalid_credentials', 'Password is incorrect')
      }
      // Sessions and patterns follow through ON DELETE CASCADE.
      deleteUser(db, user.id)
      clearSessionCookie(reply, config)
      return reply.code(204).send()
    },
  )
}
