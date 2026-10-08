import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { deriveX, DOCUMENT_FORMAT, emptyMatrix, fromDocument, MAX_COLS, MAX_ROWS, toCsv, toDocument, toggle, type PatternDocument } from '../../src/core'
import type { Pattern } from '../../src/shared/api'
import { get, makeApp, PASSWORD, postJson, sessionCookie, T0, type TestApp } from '../test/helpers'
import { createPattern } from './repository'

let t: TestApp
afterEach(async () => {
  await t?.close()
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MISSING_ID = '7d3c1f9e-8a51-4b8e-9d1a-0c6a7b2f4e10'

// SPEC §5 Case B on 15×20, drawn with the same toggles as golden.test.ts.
const CASE_B: Array<[number, number]> = [[5, 5], [5, 8], [10, 8], [6, 5], [3, 12], [4, 12], [5, 12], [15, 10]]

function caseB(name = 'Losangos'): PatternDocument {
  const delta = CASE_B.reduce((d, [r, c]) => toggle(d, r, c), emptyMatrix(15, 20))
  return toDocument({ name, delta, colors: { main: '#f3ead8', pattern: '#0f766e' } })
}

function blank(rows = 15, cols = 20, name = 'Plain'): PatternDocument {
  return toDocument({ name, delta: emptyMatrix(rows, cols), colors: { main: '#ffffff', pattern: '#000000' } })
}

async function signup(email: string, remoteAddress: string): Promise<{ cookie: string; id: string }> {
  const res = await postJson(t.app, '/api/auth/signup', { email, password: PASSWORD }, { remoteAddress })
  expect(res.statusCode).toBe(201)
  return { cookie: sessionCookie(res), id: res.json().user.id }
}

async function start(overrides: Parameters<typeof makeApp>[0] = {}) {
  t = await makeApp({ allowSignup: true, ...overrides })
  const ro = await signup('ro@example.com', '10.0.0.1')
  const other = await signup('other@example.com', '10.0.0.2')
  return { ro, other }
}

function send(app: FastifyInstance, method: 'PUT' | 'DELETE', url: string, body: unknown, cookie?: string) {
  return app.inject({
    method,
    url,
    payload: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  })
}

async function create(cookie: string, document: unknown = blank()): Promise<Pattern> {
  const res = await postJson(t.app, '/api/patterns', { document }, { cookie })
  expect(res.statusCode).toBe(201)
  return res.json().pattern
}

function summaryOf({ document: _document, ...summary }: Pattern) {
  return summary
}

function storedRows() {
  return t.db.prepare('SELECT * FROM patterns ORDER BY created_at, id').all() as Array<Record<string, unknown>>
}

describe('pattern CRUD', () => {
  it('creates, reads, lists, updates and deletes a pattern', async () => {
    const { ro } = await start()
    const document = caseB()
    const created = await create(ro.cookie, document)
    expect(created).toEqual({
      id: expect.stringMatching(UUID),
      name: 'Losangos',
      rows: 15,
      cols: 20,
      colors: { A: '#f3ead8', B: '#0f766e' },
      revision: 1,
      createdAt: new Date(T0).toISOString(),
      updatedAt: new Date(T0).toISOString(),
      document,
    })
    const url = `/api/patterns/${created.id}`

    const read = await get(t.app, url, ro.cookie)
    expect(read.statusCode).toBe(200)
    expect(read.json()).toEqual({ pattern: created })

    const list = await get(t.app, '/api/patterns', ro.cookie)
    expect(list.statusCode).toBe(200)
    expect(list.json()).toEqual({ patterns: [summaryOf(created)] })

    t.clock.advance(5_000)
    const next = blank(17, 22, 'Ondas')
    const updated = await send(t.app, 'PUT', url, { revision: 1, document: next }, ro.cookie)
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toEqual({
      pattern: {
        id: created.id,
        name: 'Ondas',
        rows: 17,
        cols: 22,
        colors: { A: '#ffffff', B: '#000000' },
        revision: 2,
        createdAt: new Date(T0).toISOString(),
        updatedAt: new Date(T0 + 5_000).toISOString(),
        document: next,
      },
    })
    expect(storedRows()).toEqual([
      expect.objectContaining({ id: created.id, name: 'Ondas', rows: 17, cols: 22, revision: 2, updated_at: T0 + 5_000 }),
    ])
    expect((await get(t.app, url, ro.cookie)).json()).toEqual(updated.json())

    const removed = await send(t.app, 'DELETE', url, {}, ro.cookie)
    expect(removed.statusCode).toBe(204)
    expect(removed.body).toBe('')
    expect((await get(t.app, url, ro.cookie)).statusCode).toBe(404)
    const again = await send(t.app, 'DELETE', url, {}, ro.cookie)
    expect(again.statusCode).toBe(404)
    expect(again.json().error.code).toBe('not_found')
    expect((await get(t.app, '/api/patterns', ro.cookie)).json()).toEqual({ patterns: [] })
  })

  it('lists the user’s patterns most recently updated first, colors read from the stored document', async () => {
    const { ro, other } = await start()
    const first = await create(ro.cookie, { ...blank(5, 5, 'First'), colors: { A: '#AABBCC', B: '#112233' } })
    t.clock.advance(1_000)
    const second = await create(ro.cookie, blank(5, 5, 'Second'))
    t.clock.advance(1_000)
    await create(other.cookie, blank(5, 5, 'Not mine'))
    t.clock.advance(1_000)
    const touched = await send(t.app, 'PUT', `/api/patterns/${first.id}`, { revision: 1, document: first.document }, ro.cookie)
    expect(touched.statusCode).toBe(200)

    const { patterns } = (await get(t.app, '/api/patterns', ro.cookie)).json()
    expect(patterns.map((p: Pattern) => p.name)).toEqual(['First', 'Second'])
    expect(patterns).toEqual([summaryOf(touched.json().pattern), summaryOf(second)])
    expect(patterns[0].colors).toEqual({ A: '#aabbcc', B: '#112233' })
  })

  it('stores the canonical document: unknown keys and derived dropped, name trimmed, colors lowercased', async () => {
    const { ro } = await start()
    const canonical = blank(5, 6, 'Losangos')
    const sent = {
      ...canonical,
      name: '  Losangos  ',
      colors: { A: '#FFFFFF', B: '#000000', C: '#123456' },
      derived: { chart: [], instructions: ['Row 1: nonsense'], conflicts: [] },
      author: 'someone',
    }
    const created = await create(ro.cookie, sent)
    expect(created.document).toEqual(canonical)
    expect(Object.keys(created.document)).toEqual(['format', 'version', 'name', 'rows', 'cols', 'colors', 'cells'])
    const [row] = storedRows()
    expect(JSON.parse(row.document as string)).toEqual(canonical)
    expect(row).toMatchObject({ name: 'Losangos', rows: 5, cols: 6, revision: 1 })

    const updated = await send(t.app, 'PUT', `/api/patterns/${created.id}`, { revision: 1, document: { ...sent, extra: true } }, ro.cookie)
    expect(updated.json().pattern.document).toEqual(canonical)
    expect(JSON.parse(storedRows()[0].document as string)).toEqual(canonical)
  })

  it('saves and reads back a pattern of the largest size', async () => {
    const { ro } = await start()
    const document = blank(MAX_ROWS, MAX_COLS, 'Grande')
    const created = await create(ro.cookie, document)
    expect(created).toMatchObject({ rows: MAX_ROWS, cols: MAX_COLS, document })
    expect((await get(t.app, `/api/patterns/${created.id}`, ro.cookie)).json()).toEqual({ pattern: created })
  })
})

describe('document validation', () => {
  const valid = caseB()
  const rowOf = (s: string, i: number, ch: string) => s.slice(0, i) + ch + s.slice(i + 1)
  const cases: Array<[string, unknown, string]> = [
    ['a deviation on row 1', { ...valid, cells: [rowOf(valid.cells[0], 3, '1'), ...valid.cells.slice(1)] }, 'cells[0]: row 1 is the base row and cannot deviate'],
    ['a deviation on the top row', { ...valid, cells: [...valid.cells.slice(0, 14), rowOf(valid.cells[14], 9, '1')] }, 'cells[14]: row 15 is the top row and cannot deviate'],
    ['an even row count', { ...valid, rows: 14, cells: valid.cells.slice(0, 14) }, 'rows: must be odd'],
    ['121 columns', { ...valid, cols: 121, cells: valid.cells.map((r) => r + '0'.repeat(101)) }, 'cols: must be between 5 and 120'],
    ['a bad color', { ...valid, colors: { A: '#f3ead8', B: 'teal' } }, 'colors.B: expected a hex color #rrggbb'],
    ['fewer cell rows than rows', { ...valid, cells: valid.cells.slice(0, 14) }, 'cells: expected 15 rows, got 14'],
    ['a cell row of the wrong length', { ...valid, cells: valid.cells.map((r, i) => (i === 3 ? r.slice(1) : r)) }, 'cells[3]: expected 20 characters, got 19'],
    ['a document that is not an object', 'Losangos', 'document: expected an object'],
    ['an unsupported version', { ...valid, version: 2 }, 'version: unsupported, expected 1'],
  ]

  it.each(cases)('POST rejects %s with 400 invalid_document', async (_label, document, error) => {
    const { ro } = await start()
    const res = await postJson(t.app, '/api/patterns', { document }, { cookie: ro.cookie })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: { code: 'invalid_document', message: expect.any(String), details: { errors: expect.arrayContaining([error]) } },
    })
    expect(storedRows()).toEqual([])
  })

  it.each(cases)('PUT rejects %s with 400 invalid_document and keeps the stored pattern', async (_label, document, error) => {
    const { ro } = await start()
    const created = await create(ro.cookie, valid)
    const res = await send(t.app, 'PUT', `/api/patterns/${created.id}`, { revision: 1, document }, ro.cookie)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: 'invalid_document', message: expect.any(String), details: { errors: expect.arrayContaining([error]) } })
    expect((await get(t.app, `/api/patterns/${created.id}`, ro.cookie)).json()).toEqual({ pattern: created })
  })

  it('rejects a malformed envelope as 400 invalid_input', async () => {
    const { ro } = await start()
    const document = blank()
    for (const body of [{}, { document, extra: 1 }, { pattern: document }]) {
      const res = await postJson(t.app, '/api/patterns', body, { cookie: ro.cookie })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('invalid_input')
    }
    const created = await create(ro.cookie, document)
    const url = `/api/patterns/${created.id}`
    for (const body of [{ document }, { revision: 0, document }, { revision: '1', document }, { revision: 1.5, document }, { revision: 1, document, x: 1 }]) {
      const res = await send(t.app, 'PUT', url, body, ro.cookie)
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('invalid_input')
    }
    expect(storedRows()).toEqual([expect.objectContaining({ id: created.id, revision: 1 })])
  })
})

describe('ownership and ids', () => {
  it('answers 404 for another user’s pattern on every route and leaves it untouched', async () => {
    const { ro, other } = await start()
    const theirs = await create(other.cookie, caseB())
    const url = `/api/patterns/${theirs.id}`
    const attempts = [
      () => get(t.app, url, ro.cookie),
      () => send(t.app, 'PUT', url, { revision: 1, document: blank() }, ro.cookie),
      // A stale revision must not turn into a 409 that hands over the stored pattern.
      () => send(t.app, 'PUT', url, { revision: 7, document: blank() }, ro.cookie),
      () => send(t.app, 'DELETE', url, {}, ro.cookie),
      () => get(t.app, `${url}/export.json`, ro.cookie),
      () => get(t.app, `${url}/export.csv`, ro.cookie),
    ]
    for (const attempt of attempts) {
      const res = await attempt()
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } })
    }
    expect((await get(t.app, '/api/patterns', ro.cookie)).json()).toEqual({ patterns: [] })
    expect((await get(t.app, url, other.cookie)).json()).toEqual({ pattern: theirs })
  })

  it('answers 404 for an id that is not a UUID, and for a UUID that names nothing', async () => {
    const { ro } = await start()
    await create(ro.cookie)
    for (const id of ['not-a-uuid', '1', "' OR 1=1 --", `${MISSING_ID}x`, MISSING_ID]) {
      const url = `/api/patterns/${encodeURIComponent(id)}`
      for (const res of [
        await get(t.app, url, ro.cookie),
        await send(t.app, 'PUT', url, { revision: 1, document: blank() }, ro.cookie),
        await send(t.app, 'DELETE', url, {}, ro.cookie),
        await get(t.app, `${url}/export.json`, ro.cookie),
        await get(t.app, `${url}/export.csv`, ro.cookie),
      ]) {
        expect(res.statusCode).toBe(404)
        expect(res.json().error.code).toBe('not_found')
      }
    }
    expect(storedRows()).toHaveLength(1)
  })
})

describe('PUT /api/patterns/:id revisions', () => {
  it('answers 409 revision_conflict with the stored pattern for a stale revision', async () => {
    const { ro } = await start()
    const created = await create(ro.cookie, blank(5, 5, 'Mine'))
    const url = `/api/patterns/${created.id}`
    t.clock.advance(1_000)
    const first = await send(t.app, 'PUT', url, { revision: 1, document: blank(5, 5, 'Tab one') }, ro.cookie)
    expect(first.statusCode).toBe(200)
    expect(first.json().pattern.revision).toBe(2)

    t.clock.advance(1_000)
    const stale = await send(t.app, 'PUT', url, { revision: 1, document: blank(7, 7, 'Tab two') }, ro.cookie)
    expect(stale.statusCode).toBe(409)
    const stored = (await get(t.app, url, ro.cookie)).json().pattern
    expect(stored).toEqual(first.json().pattern)
    expect(stale.json()).toEqual({ error: { code: 'revision_conflict', message: expect.any(String), details: { current: stored } } })

    // A revision from the future is just as stale.
    expect((await send(t.app, 'PUT', url, { revision: 3, document: blank() }, ro.cookie)).statusCode).toBe(409)
    const resolved = await send(t.app, 'PUT', url, { revision: 2, document: blank(7, 7, 'Tab two') }, ro.cookie)
    expect(resolved.statusCode).toBe(200)
    expect(resolved.json().pattern).toMatchObject({ name: 'Tab two', revision: 3, updatedAt: new Date(T0 + 2_000).toISOString() })
  })
})

describe('MAX_PATTERNS_PER_USER', () => {
  it('refuses the create past the limit with 403 pattern_quota_exceeded, per user', async () => {
    const { ro, other } = await start({ maxPatternsPerUser: 2 })
    const first = await create(ro.cookie)
    await create(ro.cookie)
    const third = await postJson(t.app, '/api/patterns', { document: blank() }, { cookie: ro.cookie })
    expect(third.statusCode).toBe(403)
    expect(third.json()).toEqual({ error: { code: 'pattern_quota_exceeded', message: expect.any(String) } })
    expect(storedRows()).toHaveLength(2)

    // Someone else's library does not count, and updating is not creating.
    await create(other.cookie)
    expect((await send(t.app, 'PUT', `/api/patterns/${first.id}`, { revision: 1, document: blank() }, ro.cookie)).statusCode).toBe(200)

    expect((await send(t.app, 'DELETE', `/api/patterns/${first.id}`, {}, ro.cookie)).statusCode).toBe(204)
    await create(ro.cookie)
  })
})

describe('exports', () => {
  it('exports §5 Case B as the SPEC §10 document with derived chart, instructions and conflicts', async () => {
    const { ro } = await start()
    const created = await create(ro.cookie, caseB('Losangos'))
    const res = await get(t.app, `/api/patterns/${created.id}/export.json`, ro.cookie)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(res.headers['content-disposition']).toBe('attachment; filename="losangos.mosaic.json"')

    const exported = res.json()
    expect(exported).toMatchObject({ ...created.document, format: DOCUMENT_FORMAT })
    const special: Record<number, string> = {
      4: 'Row 4: 8 sc, 1 dc and 11 sc',
      5: 'Row 5: 8 sc, 1 dc and 11 sc',
      6: 'Row 6: 8 sc, 1 dc, 3 sc, 1 dc, 2 sc, 1 dc and 4 sc',
      7: 'Row 7: 15 sc, 1 dc and 4 sc',
      11: 'Row 11: 12 sc, 1 dc and 7 sc',
    }
    expect(exported.derived.instructions).toEqual(Array.from({ length: 15 }, (_, i) => special[i + 1] ?? `Row ${i + 1}: 20 sc`))
    expect(exported.derived.conflicts).toEqual([[4, 12], [5, 12], [6, 5], [6, 12], [7, 5]])
    const X = deriveX(fromDocument(created.document).delta)
    expect(exported.derived.chart).toEqual(X.map((row) => row.map((v) => (v ? '1' : '0')).join('')))
  })

  it('exports the X chart as plain RFC 4180 CSV', async () => {
    const { ro } = await start()
    const created = await create(ro.cookie, caseB('Losangos'))
    const res = await get(t.app, `/api/patterns/${created.id}/export.csv`, ro.cookie)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(res.headers['content-disposition']).toBe('attachment; filename="losangos.csv"')
    const lines = res.body.split('\r\n')
    expect(lines[0]).toBe(['Row', 'Yarn', ...Array.from({ length: 20 }, (_, j) => 20 - j)].join(','))
    expect(lines[1]).toBe(`15,A,${Array(20).fill(0).join(',')}`)
    expect(res.body).not.toMatch(/^sep=/m)
    expect(res.body).toBe(toCsv(deriveX(fromDocument(created.document).delta)))
  })

  it('keeps Content-Disposition a plain ASCII filename whatever the name holds', async () => {
    const { ro } = await start()
    const viaApi = await create(ro.cookie, blank(5, 5, 'a"b; X-Evil: 1'))
    // Control characters cannot get past parseDocument, so plant one the way a damaged row would hold it.
    const planted = createPattern(t.db, ro.id, { ...blank(5, 5), name: 'a"b\r\nX-Evil: 1' }, T0, 10)
    const unnamed = await create(ro.cookie, blank(5, 5, 'Coração 🧶'))
    const emoji = await create(ro.cookie, blank(5, 5, '🧶🧶'))

    const expectations: Array<[string, string]> = [
      [viaApi.id, 'a-b-x-evil-1'],
      [planted.id, 'a-b-x-evil-1'],
      [unnamed.id, 'coracao'],
      [emoji.id, 'pattern'],
    ]
    for (const [id, slug] of expectations) {
      for (const [ext, suffix] of [['json', '.mosaic.json'], ['csv', '.csv']]) {
        const res = await get(t.app, `/api/patterns/${id}/export.${ext}`, ro.cookie)
        expect(res.statusCode).toBe(200)
        expect(res.headers['content-disposition']).toBe(`attachment; filename="${slug}${suffix}"`)
        expect(res.headers['x-evil']).toBeUndefined()
      }
    }
  })
})

describe('sessions', () => {
  it('answers 401 unauthenticated on every route without a session, before looking at the body', async () => {
    const { ro } = await start()
    const created = await create(ro.cookie)
    const url = `/api/patterns/${created.id}`
    const forged = 'mosaic_session=' + 'A'.repeat(43)
    for (const cookie of [undefined, forged]) {
      for (const res of [
        await get(t.app, '/api/patterns', cookie),
        await postJson(t.app, '/api/patterns', { document: blank() }, { cookie }),
        await postJson(t.app, '/api/patterns', { nonsense: true }, { cookie }),
        await get(t.app, url, cookie),
        await send(t.app, 'PUT', url, { revision: 1, document: blank(7, 7) }, cookie),
        await send(t.app, 'DELETE', url, {}, cookie),
        await get(t.app, `${url}/export.json`, cookie),
        await get(t.app, `${url}/export.csv`, cookie),
        await get(t.app, '/api/patterns/not-a-uuid', cookie),
      ]) {
        expect(res.statusCode).toBe(401)
        expect(res.json()).toEqual({ error: { code: 'unauthenticated', message: expect.any(String) } })
      }
    }
    expect(storedRows()).toEqual([expect.objectContaining({ id: created.id, revision: 1, rows: 15 })])
  })

  it('deleting the account removes that user’s patterns and no one else’s', async () => {
    const { ro, other } = await start()
    await create(ro.cookie)
    await create(ro.cookie, caseB())
    const kept = await create(other.cookie)
    const res = await postJson(t.app, '/api/auth/delete-account', { password: PASSWORD }, { cookie: ro.cookie })
    expect(res.statusCode).toBe(204)
    expect(storedRows()).toEqual([expect.objectContaining({ id: kept.id, owner_id: other.id })])
    expect((await get(t.app, '/api/patterns', other.cookie)).json()).toEqual({ patterns: [summaryOf(kept)] })
  })
})
