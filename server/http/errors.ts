import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify'
import type { ApiErrorBody, ApiErrorCode } from '../../src/shared/api'

/** An expected failure with a client-facing code (SPEC §9.4). Throw it from any handler or hook. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function errorBody(code: ApiErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } }
}

export function sendError(reply: FastifyReply, status: number, code: ApiErrorCode, message: string, details?: unknown) {
  return reply.code(status).type('application/json; charset=utf-8').send(errorBody(code, message, details))
}

/** Field name → problem, for `invalid_input` details. */
export function invalidInput(fields: Record<string, string>): ApiError {
  return new ApiError(400, 'invalid_input', 'Some fields are invalid', { fields })
}

type ValidationIssue = NonNullable<FastifyError['validation']>[number]

function fieldsOf(issues: ValidationIssue[]): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of issues) {
    const path = issue.instancePath.split('/').filter(Boolean)
    let message = issue.message ? issue.message[0].toUpperCase() + issue.message.slice(1) : 'Is invalid'
    if (issue.keyword === 'required') {
      path.push(String(issue.params.missingProperty))
      message = 'Required'
    } else if (issue.keyword === 'additionalProperties') {
      path.push(String(issue.params.additionalProperty))
      message = 'Unknown field'
    }
    fields[path.join('.') || 'body'] ??= message
  }
  return fields
}

/**
 * Every error leaves as the SPEC §9.4 envelope, including Fastify's own (validation, body parsing,
 * rate limiting). Unexpected errors become a generic 500; the real one only goes to the log.
 */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) {
      return sendError(reply, error.statusCode, error.code, error.message, error.details)
    }
    if (error.validation) {
      return sendError(reply, 400, 'invalid_input', 'Some fields are invalid', { fields: fieldsOf(error.validation) })
    }
    const status = error.statusCode ?? 500
    if (status === 413) return sendError(reply, 413, 'payload_too_large', 'Request body is too large')
    if (status === 415) return sendError(reply, 415, 'unsupported_media_type', 'Content-Type must be application/json')
    if (status === 429) return sendError(reply, 429, 'rate_limited', 'Too many requests; try again later')
    if (status === 404) return sendError(reply, 404, 'not_found', 'Not found')
    // Remaining 4xx come from Fastify's body parsing (malformed JSON, empty body, bad lengths): their
    // messages describe the request, not the server.
    if (status >= 400 && status < 500) return sendError(reply, status, 'invalid_input', error.message)
    request.log.error({ err: error }, 'unhandled error')
    return sendError(reply, 500, 'internal', 'Internal server error')
  })
}
