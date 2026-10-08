import type { FastifyInstance, FastifyRequest } from 'fastify'
import { toCsv } from '../../src/core/csv'
import { deriveX } from '../../src/core/deriveX'
import { exportDocument, fromDocument, parseDocument, type PatternDocument } from '../../src/core/document'
import { fileSlug } from '../../src/lib/format'
import type { Pattern, PatternSummary, RevisionConflictDetails } from '../../src/shared/api'
import { currentUser } from '../auth/guard'
import type { AppContext } from '../context'
import { ApiError } from '../http/errors'
import { createPattern, deletePattern, findPattern, listPatterns, PatternQuotaError, toPattern, updatePattern } from './repository'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The envelope is checked here; whether the document is a valid pattern is parseDocument's call, so
// `document` takes any JSON value and a bad one is reported as invalid_document with its paths.
const createBodySchema = {
  type: 'object',
  required: ['document'],
  additionalProperties: false,
  properties: { document: {} },
}
const updateBodySchema = {
  type: 'object',
  required: ['revision', 'document'],
  additionalProperties: false,
  properties: { revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, document: {} },
}

interface IdParams {
  id: string
}

const notFound = () => new ApiError(404, 'not_found', 'Pattern not found')

/** The :id of the route; anything that is not a UUID cannot name a pattern, so it is a 404 too. */
function patternId(request: FastifyRequest<{ Params: IdParams }>): string {
  const { id } = request.params
  if (!UUID_RE.test(id)) throw notFound()
  return id.toLowerCase()
}

function validDocument(input: unknown): PatternDocument {
  const parsed = parseDocument(input)
  if (!parsed.ok) throw new ApiError(400, 'invalid_document', 'The pattern document is invalid', { errors: parsed.errors })
  return parsed.document
}

/** The slug is ASCII letters, digits and '-' only, so no name can break out of the header. */
function attachment(stem: string, extension: string): string {
  return `attachment; filename="${fileSlug(stem)}${extension}"`
}

export async function registerPatternRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { config, db, now } = ctx

  await app.register(async (scope) => {
    // Every route here needs a session, checked before the body is even read: an anonymous client
    // gets 401 whatever it sends.
    scope.addHook('onRequest', scope.requireUser)

    function storedPattern(request: FastifyRequest<{ Params: IdParams }>) {
      const row = findPattern(db, currentUser(request).id, patternId(request))
      if (!row) throw notFound()
      return row
    }

    scope.get('/api/patterns', async (request): Promise<{ patterns: PatternSummary[] }> => ({
      patterns: listPatterns(db, currentUser(request).id),
    }))

    scope.post<{ Body: { document: unknown } }>(
      '/api/patterns',
      { schema: { body: createBodySchema } },
      async (request, reply): Promise<{ pattern: Pattern }> => {
        const user = currentUser(request)
        const document = validDocument(request.body.document)
        let row
        try {
          row = createPattern(db, user.id, document, now(), config.maxPatternsPerUser)
        } catch (err) {
          if (err instanceof PatternQuotaError) {
            throw new ApiError(403, 'pattern_quota_exceeded', `You can keep at most ${err.max} patterns; delete one to save another`)
          }
          throw err
        }
        reply.code(201)
        return { pattern: toPattern(row) }
      },
    )

    scope.get<{ Params: IdParams }>('/api/patterns/:id', async (request): Promise<{ pattern: Pattern }> => ({
      pattern: toPattern(storedPattern(request)),
    }))

    scope.put<{ Params: IdParams; Body: { revision: number; document: unknown } }>(
      '/api/patterns/:id',
      { schema: { body: updateBodySchema } },
      async (request): Promise<{ pattern: Pattern }> => {
        const user = currentUser(request)
        const id = patternId(request)
        const document = validDocument(request.body.document)
        const result = updatePattern(db, user.id, id, request.body.revision, document, now())
        if (result.ok) return { pattern: toPattern(result.row) }
        if (!result.current) throw notFound()
        const details: RevisionConflictDetails = { current: toPattern(result.current) }
        throw new ApiError(409, 'revision_conflict', 'This pattern was changed elsewhere since it was opened', details)
      },
    )

    scope.delete<{ Params: IdParams }>('/api/patterns/:id', async (request, reply) => {
      if (!deletePattern(db, currentUser(request).id, patternId(request))) throw notFound()
      return reply.code(204).send()
    })

    scope.get<{ Params: IdParams }>('/api/patterns/:id/export.json', async (request, reply) => {
      const document = toPattern(storedPattern(request)).document
      return reply
        .type('application/json; charset=utf-8')
        .header('content-disposition', attachment(document.name, '.mosaic.json'))
        .send(JSON.stringify(exportDocument(document), null, 2) + '\n')
    })

    scope.get<{ Params: IdParams }>('/api/patterns/:id/export.csv', async (request, reply) => {
      const document = toPattern(storedPattern(request)).document
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', attachment(document.name, '.csv'))
        .send(toCsv(deriveX(fromDocument(document).delta)))
    })
  })
}
