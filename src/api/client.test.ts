import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyMatrix, toDocument } from '../core'
import type { Pattern } from '../shared/api'
import { ApiError, authApi, inputErrors, patternsApi, setOnUnauthenticated } from './client'

const fetchMock = vi.fn<typeof fetch>()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.lastCall!
  return { url: String(url), init: init ?? {} }
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return e as ApiError
  }
  throw new Error('expected the request to fail')
}

const document = toDocument({ name: 'Waves', delta: emptyMatrix(5, 5), colors: { main: '#ffffff', pattern: '#000000' } })
const pattern: Pattern = {
  id: '6f1c2b7e-5d1a-4c8e-9a51-0c6a3b0f9d21',
  name: 'Waves',
  rows: 5,
  cols: 5,
  colors: { A: '#ffffff', B: '#000000' },
  revision: 3,
  createdAt: '2026-10-08T10:00:00.000Z',
  updatedAt: '2026-10-08T11:00:00.000Z',
  document,
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  setOnUnauthenticated(null)
  vi.unstubAllGlobals()
})

describe('request', () => {
  it('turns the error envelope into an ApiError with every field', async () => {
    const details = { current: pattern }
    fetchMock.mockResolvedValue(json(409, { error: { code: 'revision_conflict', message: 'Someone saved first', details } }))
    const e = await caught(patternsApi.update(pattern.id, { revision: 2, document }))
    expect(e.status).toBe(409)
    expect(e.code).toBe('revision_conflict')
    expect(e.message).toBe('Someone saved first')
    expect(e.details).toEqual(details)
  })

  it('returns undefined for 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(patternsApi.remove(pattern.id)).resolves.toBeUndefined()
  })

  it('reports a network failure as internal with a readable message', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const e = await caught(authApi.me())
    expect([e.status, e.code]).toEqual([0, 'internal'])
    expect(e.message).toMatch(/could not reach the server/i)
  })

  it('reports an error that is not JSON as internal, naming the status', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }))
    const e = await caught(patternsApi.list())
    expect([e.status, e.code]).toEqual([502, 'internal'])
    expect(e.message).toContain('502 Bad Gateway')
  })

  it('reports JSON without the envelope as internal', async () => {
    fetchMock.mockResolvedValue(json(500, { message: 'boom' }))
    const e = await caught(patternsApi.list())
    expect([e.status, e.code]).toEqual([500, 'internal'])
  })

  it('reports an unreadable success body as internal', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))
    const e = await caught(patternsApi.list())
    expect(e.code).toBe('internal')
  })

  it('sends GET with the session cookie and no body', async () => {
    fetchMock.mockResolvedValue(json(200, { patterns: [] }))
    await expect(patternsApi.list()).resolves.toEqual([])
    const { url, init } = lastCall()
    expect(url).toBe('/api/patterns')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
    expect(init.body).toBeUndefined()
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('sends JSON with Content-Type on every mutating request, {} when there is nothing to say', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }))
    await authApi.logout()
    expect(lastCall().init.body).toBe('{}')
    await patternsApi.remove(pattern.id)
    expect(lastCall().init.body).toBe('{}')
    for (const call of fetchMock.mock.calls) {
      expect((call[1]?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
      expect(call[1]?.credentials).toBe('same-origin')
    }
  })
})

describe('endpoints', () => {
  it('login posts the credentials and returns the user', async () => {
    const user = { id: 'u1', email: 'ro@example.com', createdAt: '2026-10-08T10:00:00.000Z' }
    fetchMock.mockResolvedValue(json(200, { user }))
    await expect(authApi.login({ email: 'ro@example.com', password: 'correct horse' })).resolves.toEqual(user)
    const { url, init } = lastCall()
    expect([url, init.method]).toEqual(['/api/auth/login', 'POST'])
    expect(JSON.parse(String(init.body))).toEqual({ email: 'ro@example.com', password: 'correct horse' })
  })

  it('create posts { document } and returns the pattern', async () => {
    fetchMock.mockResolvedValue(json(201, { pattern }))
    await expect(patternsApi.create({ document })).resolves.toEqual(pattern)
    const { url, init } = lastCall()
    expect([url, init.method]).toEqual(['/api/patterns', 'POST'])
    expect(JSON.parse(String(init.body))).toEqual({ document })
  })

  it('update puts { revision, document } to the escaped id', async () => {
    fetchMock.mockResolvedValue(json(200, { pattern }))
    await patternsApi.update('a/b', { revision: 3, document })
    const { url, init } = lastCall()
    expect([url, init.method]).toEqual(['/api/patterns/a%2Fb', 'PUT'])
    expect(JSON.parse(String(init.body))).toEqual({ revision: 3, document })
  })

  it('get and remove address one pattern', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { pattern }))
    await expect(patternsApi.get(pattern.id)).resolves.toEqual(pattern)
    expect([lastCall().url, lastCall().init.method]).toEqual([`/api/patterns/${pattern.id}`, 'GET'])
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await patternsApi.remove(pattern.id)
    expect([lastCall().url, lastCall().init.method]).toEqual([`/api/patterns/${pattern.id}`, 'DELETE'])
  })

  it('config, me, password and delete-account hit their routes', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { signupEnabled: true }))
    await expect(authApi.config()).resolves.toEqual({ signupEnabled: true })
    expect(lastCall().url).toBe('/api/auth/config')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await authApi.changePassword({ currentPassword: 'old password', newPassword: 'new password' })
    expect(lastCall().url).toBe('/api/auth/password')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await authApi.deleteAccount({ password: 'old password' })
    expect(lastCall().url).toBe('/api/auth/delete-account')
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ password: 'old password' })
  })
})

describe('onUnauthenticated', () => {
  const unauthenticated = () => json(401, { error: { code: 'unauthenticated', message: 'Log in first' } })
  const wrongPassword = () => json(401, { error: { code: 'invalid_credentials', message: 'Wrong email or password' } })

  it('fires on a 401 from /api/patterns', async () => {
    const callback = vi.fn()
    setOnUnauthenticated(callback)
    fetchMock.mockResolvedValue(unauthenticated())
    const e = await caught(patternsApi.list())
    expect(e.status).toBe(401)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('fires on a 401 from a single pattern', async () => {
    const callback = vi.fn()
    setOnUnauthenticated(callback)
    fetchMock.mockResolvedValue(unauthenticated())
    await caught(patternsApi.update(pattern.id, { revision: 1, document }))
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does not fire on a 401 from /api/auth/login', async () => {
    const callback = vi.fn()
    setOnUnauthenticated(callback)
    fetchMock.mockResolvedValue(wrongPassword())
    const e = await caught(authApi.login({ email: 'ro@example.com', password: 'wrong password' }))
    expect(e.code).toBe('invalid_credentials')
    expect(callback).not.toHaveBeenCalled()
  })

  it('does not fire on a 401 from me, password or delete-account', async () => {
    const callback = vi.fn()
    setOnUnauthenticated(callback)
    fetchMock.mockResolvedValueOnce(unauthenticated())
    await caught(authApi.me())
    fetchMock.mockResolvedValueOnce(wrongPassword())
    await caught(authApi.changePassword({ currentPassword: 'wrong password', newPassword: 'new password' }))
    fetchMock.mockResolvedValueOnce(wrongPassword())
    await caught(authApi.deleteAccount({ password: 'wrong password' }))
    expect(callback).not.toHaveBeenCalled()
  })

  it('fires when the session died under password change or account deletion', async () => {
    const callback = vi.fn()
    setOnUnauthenticated(callback)
    fetchMock.mockResolvedValueOnce(unauthenticated())
    const e = await caught(authApi.changePassword({ currentPassword: 'old password', newPassword: 'new password' }))
    expect(e.code).toBe('unauthenticated')
    expect(callback).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValueOnce(unauthenticated())
    await caught(authApi.deleteAccount({ password: 'old password' }))
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('does not fire on other errors', async () => {
    const callback = vi.fn()
    setOnUnauthenticated(callback)
    fetchMock.mockResolvedValue(json(404, { error: { code: 'not_found', message: 'Not found' } }))
    await caught(patternsApi.get(pattern.id))
    expect(callback).not.toHaveBeenCalled()
  })
})

describe('inputErrors', () => {
  it('lists the per-field messages of invalid_input', () => {
    expect(inputErrors({ fields: { email: 'Email is required', password: 'Too short' } })).toEqual(['Email is required', 'Too short'])
  })

  it.each([undefined, null, {}, { fields: 'x' }])('is empty for %j', (details) => {
    expect(inputErrors(details)).toEqual([])
  })
})
