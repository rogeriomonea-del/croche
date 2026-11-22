import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Config } from '../config'

// SPEC §9.2. The __Host- prefix makes browsers refuse the cookie unless it is Secure, Path=/ and has
// no Domain, so a sibling subdomain cannot plant one; it requires Secure, hence the switch.
export function sessionCookieName(config: Config): string {
  return config.cookieSecure ? '__Host-mosaic_session' : 'mosaic_session'
}

function baseOptions(config: Config) {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: config.cookieSecure } as const
}

export function readSessionCookie(request: FastifyRequest, config: Config): string | undefined {
  return request.cookies[sessionCookieName(config)]
}

export function setSessionCookie(reply: FastifyReply, config: Config, token: string): void {
  reply.setCookie(sessionCookieName(config), token, { ...baseOptions(config), maxAge: config.sessionTtlDays * 24 * 60 * 60 })
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(sessionCookieName(config), baseOptions(config))
}
