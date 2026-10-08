import type { FastifyInstance } from 'fastify'

/**
 * JSON is the only body format the API speaks (SPEC §9.3): any other content type, including
 * Fastify's default text/plain and the CSRF-friendly form encodings, gets 415 before parsing.
 * An empty JSON body reads as no body, so a client that always sends the header can still POST
 * /auth/logout; routes that need a body reject it in validation.
 */
export function registerJsonOnly(app: FastifyInstance): void {
  const parseJson = app.getDefaultJsonParser('error', 'error')
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (body === '') return done(null, undefined)
    parseJson(request, body as string, done)
  })
}
