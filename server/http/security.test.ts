import { connect, type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createUser } from '../admin'
import { get, makeApp, ORIGIN, PASSWORD, postJson, sessionCookie, type TestApp } from '../test/helpers'

let t: TestApp
afterEach(async () => {
  await t?.close()
})

const LOGIN = '/api/auth/login'

/** Sends `request` as written (inject cannot send an absolute-form target); resolves to the status code. */
function rawStatus(port: number, request: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(request))
    let response = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => (response += chunk))
    socket.on('end', () => resolve(Number(response.split(' ')[1])))
    socket.on('error', reject)
  })
}

describe('Origin check (SPEC §9.3)', () => {
  it('rejects a state-changing request from another origin with 403 bad_origin', async () => {
    t = await makeApp()
    const res = await postJson(t.app, LOGIN, { email: 'ro@example.com', password: PASSWORD }, { origin: 'https://evil.example' })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: { code: 'bad_origin', message: expect.any(String) } })
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const other = await t.app.inject({ method, url: '/api/anything', headers: { origin: 'null' } })
      expect(other.json().error.code).toBe('bad_origin')
    }
  })

  it('lets the configured origin and requests without Origin through', async () => {
    t = await makeApp()
    await createUser(t.db, 'ro@example.com', PASSWORD)
    const same = await postJson(t.app, LOGIN, { email: 'ro@example.com', password: PASSWORD }, { origin: ORIGIN })
    expect(same.statusCode).toBe(200)
    const none = await postJson(t.app, LOGIN, { email: 'ro@example.com', password: PASSWORD })
    expect(none.statusCode).toBe(200)
  })

  it('does not apply to safe methods', async () => {
    t = await makeApp()
    const res = await t.app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://evil.example' } })
    expect(res.statusCode).toBe(200)
  })
})

describe('request bodies', () => {
  it('is 415 unsupported_media_type for a body that is not JSON', async () => {
    t = await makeApp()
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const res = await t.app.inject({
        method: 'POST',
        url: LOGIN,
        headers: { 'content-type': type },
        payload: '{"email":"ro@example.com","password":"correct horse battery"}',
      })
      expect(res.statusCode, type).toBe(415)
      expect(res.json().error.code).toBe('unsupported_media_type')
    }
    const untyped = await t.app.inject({ method: 'POST', url: LOGIN, payload: Buffer.from('{}') })
    expect(untyped.statusCode).toBe(415)
  })

  it('is 413 payload_too_large above 256 KiB', async () => {
    t = await makeApp()
    const res = await postJson(t.app, LOGIN, { email: 'ro@example.com', password: 'x'.repeat(300 * 1024) })
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('payload_too_large')
  })

  it('is 400 invalid_input for malformed JSON', async () => {
    t = await makeApp()
    const res = await t.app.inject({ method: 'POST', url: LOGIN, headers: { 'content-type': 'application/json' }, payload: '{"email":' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('invalid_input')
  })
})

describe('rate limits (SPEC §9.3)', () => {
  it('allows 10 logins a minute per IP; the 11th is 429 rate_limited', async () => {
    t = await makeApp()
    // Distinct e-mails, so the per-e-mail lockout is not what trips.
    for (let i = 0; i < 10; i++) {
      const res = await postJson(t.app, LOGIN, { email: `user${i}@example.com`, password: PASSWORD }, { remoteAddress: '203.0.113.7' })
      expect(res.statusCode).toBe(401)
    }
    const blocked = await postJson(t.app, LOGIN, { email: 'user10@example.com', password: PASSWORD }, { remoteAddress: '203.0.113.7' })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toEqual({ error: { code: 'rate_limited', message: expect.any(String) } })
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    // Another IP is unaffected.
    const elsewhere = await postJson(t.app, LOGIN, { email: 'user10@example.com', password: PASSWORD }, { remoteAddress: '203.0.113.8' })
    expect(elsewhere.statusCode).toBe(401)
  })

  it('limits sign-up the same way', async () => {
    t = await makeApp({ allowSignup: true })
    for (let i = 0; i < 10; i++) {
      const res = await postJson(t.app, '/api/auth/signup', { email: `bad${i}`, password: PASSWORD }, { remoteAddress: '203.0.113.9' })
      expect(res.statusCode).toBe(400)
    }
    const blocked = await postJson(t.app, '/api/auth/signup', { email: 'ok@example.com', password: PASSWORD }, { remoteAddress: '203.0.113.9' })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().error.code).toBe('rate_limited')
  })

  it('allows 300 /api requests a minute per IP', async () => {
    t = await makeApp()
    for (let i = 0; i < 300; i++) {
      const res = await t.app.inject({ method: 'GET', url: '/api/health', remoteAddress: '198.51.100.1' })
      expect(res.statusCode).toBe(200)
    }
    const blocked = await t.app.inject({ method: 'GET', url: '/api/health', remoteAddress: '198.51.100.1' })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().error.code).toBe('rate_limited')
    const unknownRoute = await t.app.inject({ method: 'GET', url: '/api/nope', remoteAddress: '198.51.100.1' })
    expect(unknownRoute.statusCode).toBe(429)
  })

  it('counts /api requests the router reaches through a percent-encoded path', async () => {
    t = await makeApp()
    // The router decodes /%61pi to /api; the limits must follow the route, not the raw URL.
    for (let i = 0; i < 10; i++) {
      const res = await postJson(t.app, '/%61pi/auth/login', { email: `user${i}@example.com`, password: PASSWORD }, { remoteAddress: '203.0.113.20' })
      expect(res.statusCode).toBe(401)
    }
    const blocked = await postJson(t.app, '/%61pi/auth/login', { email: 'user10@example.com', password: PASSWORD }, { remoteAddress: '203.0.113.20' })
    expect(blocked.statusCode).toBe(429)

    for (let i = 0; i < 300; i++) await t.app.inject({ method: 'GET', url: '/%61pi/health', remoteAddress: '203.0.113.21' })
    expect((await t.app.inject({ method: 'GET', url: '/%61pi/health', remoteAddress: '203.0.113.21' })).statusCode).toBe(429)
    expect((await t.app.inject({ method: 'GET', url: '/%61pi/nope', remoteAddress: '203.0.113.21' })).statusCode).toBe(429)
  })

  it('counts absolute-form request targets as /api requests', async () => {
    t = await makeApp()
    await t.app.listen({ host: '127.0.0.1', port: 0 })
    const { port } = t.app.server.address() as AddressInfo
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const body = JSON.stringify({ email: `user${i}@example.com`, password: PASSWORD })
      const head = [
        'POST http://evil.example/api/auth/login HTTP/1.1',
        'Host: evil.example',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
      ]
      statuses.push(await rawStatus(port, `${head.join('\r\n')}\r\n\r\n${body}`))
    }
    expect(statuses).toEqual([...Array(10).fill(401), 429])
  })

  it('locks an e-mail after 10 failures in 15 minutes, from any IP, even with the right password', async () => {
    t = await makeApp()
    await createUser(t.db, 'ro@example.com', PASSWORD)
    for (let i = 0; i < 10; i++) {
      const res = await postJson(t.app, LOGIN, { email: 'ro@example.com', password: 'wrong password' }, { remoteAddress: `192.0.2.${i + 1}` })
      expect(res.statusCode).toBe(401)
    }
    const locked = await postJson(t.app, LOGIN, { email: 'RO@example.com', password: PASSWORD }, { remoteAddress: '192.0.2.100' })
    expect(locked.statusCode).toBe(429)
    expect(locked.json().error.code).toBe('rate_limited')
    expect(Number(locked.headers['retry-after'])).toBe(15 * 60)

    // Other accounts are not locked.
    await createUser(t.db, 'other@example.com', PASSWORD)
    expect((await postJson(t.app, LOGIN, { email: 'other@example.com', password: PASSWORD }, { remoteAddress: '192.0.2.101' })).statusCode).toBe(200)

    t.clock.advance(15 * 60 * 1000 - 1)
    expect((await postJson(t.app, LOGIN, { email: 'ro@example.com', password: PASSWORD }, { remoteAddress: '192.0.2.102' })).statusCode).toBe(429)
    t.clock.advance(1)
    expect((await postJson(t.app, LOGIN, { email: 'ro@example.com', password: PASSWORD }, { remoteAddress: '192.0.2.103' })).statusCode).toBe(200)
  })

  it('counts failures for unknown e-mails too, so locking reveals nothing', async () => {
    t = await makeApp()
    for (let i = 0; i < 10; i++) {
      await postJson(t.app, LOGIN, { email: 'ghost@example.com', password: 'wrong password' }, { remoteAddress: `192.0.2.${i + 1}` })
    }
    const res = await postJson(t.app, LOGIN, { email: 'ghost@example.com', password: 'wrong password' }, { remoteAddress: '192.0.2.200' })
    expect(res.statusCode).toBe(429)
  })

  it('forgets earlier failures after a successful login', async () => {
    t = await makeApp()
    await createUser(t.db, 'ro@example.com', PASSWORD)
    for (let i = 0; i < 9; i++) {
      await postJson(t.app, LOGIN, { email: 'ro@example.com', password: 'wrong password' }, { remoteAddress: `192.0.2.${i + 1}` })
    }
    expect((await postJson(t.app, LOGIN, { email: 'ro@example.com', password: PASSWORD }, { remoteAddress: '192.0.2.50' })).statusCode).toBe(200)
    await postJson(t.app, LOGIN, { email: 'ro@example.com', password: 'wrong password' }, { remoteAddress: '192.0.2.51' })
    expect((await postJson(t.app, LOGIN, { email: 'ro@example.com', password: PASSWORD }, { remoteAddress: '192.0.2.52' })).statusCode).toBe(200)
  })
})

describe('error envelope and headers', () => {
  it('answers unknown /api routes with a JSON 404 not_found', async () => {
    t = await makeApp()
    for (const [method, url] of [['GET', '/api/nope'], ['POST', '/api/nope'], ['GET', '/api'], ['DELETE', '/api/patterns/x/y']] as const) {
      const res = await t.app.inject({ method, url })
      expect(res.statusCode, `${method} ${url}`).toBe(404)
      expect(res.headers['content-type']).toMatch(/^application\/json/)
      expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
    }
  })

  it('turns an unexpected error into a generic 500 internal', async () => {
    t = await makeApp()
    t.db.close()
    const res = await get(t.app, '/api/health')
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: 'internal', message: 'Internal server error' } })
    expect(res.body).not.toMatch(/database|sqlite/i)
  })

  it('sends the security headers', async () => {
    t = await makeApp()
    const res = await get(t.app, '/api/health')
    expect(res.json()).toEqual({ ok: true })
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain('unsafe-inline')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['strict-transport-security']).toBeUndefined()
  })

  it('marks /api responses no-store however the path is spelled', async () => {
    t = await makeApp({ allowSignup: true })
    const cookie = sessionCookie(await postJson(t.app, '/api/auth/signup', { email: 'ro@example.com', password: PASSWORD }))
    for (const url of ['/api/auth/me', '/%61pi/auth/me', '/%61pi/nope']) {
      expect((await get(t.app, url, cookie)).headers['cache-control'], url).toBe('no-store')
    }
  })

  it('sends HSTS only with COOKIE_SECURE', async () => {
    t = await makeApp({ cookieSecure: true })
    const res = await get(t.app, '/api/health')
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000')
  })

  it('never echoes the session token outside Set-Cookie', async () => {
    t = await makeApp({ allowSignup: true })
    const res = await postJson(t.app, '/api/auth/signup', { email: 'ro@example.com', password: PASSWORD })
    const token = sessionCookie(res).split('=')[1]
    expect(res.body).not.toContain(token)
  })
})
