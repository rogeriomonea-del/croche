import { afterEach, describe, expect, it, vi } from 'vitest'
import { DAY_MS } from '../context'
import { get, makeApp, PASSWORD, postJson, sessionCookie, setCookies, type TestApp } from '../test/helpers'
import { getDummyHash, verifyPassword } from './passwords'
import { hashToken, SESSION_REFRESH_MS } from './sessions'
import { assignLoginAlias } from './users'
import { normalizeLoginIdentifier } from '../../src/shared/login'

// verifyPassword keeps its real behaviour; the spy only records who paid for an argon2 verify.
vi.mock('./passwords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./passwords')>()
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) }
})

// SPEC §9.2: argon2id, m = 19 MiB, t = 2, p = 1.
const ARGON2ID_PREFIX = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/
const CLEARED_HOST_COOKIE = /^__Host-mosaic_session=; Max-Age=0; Path=\/;.*HttpOnly.*Secure.*SameSite=Lax/

let t: TestApp
afterEach(async () => {
  await t?.close()
})

async function signup(email = 'ro@example.com', password = PASSWORD, remoteAddress?: string) {
  return postJson(t.app, '/api/auth/signup', { email, password }, { remoteAddress })
}

async function login(email = 'ro@example.com', password = PASSWORD, remoteAddress?: string) {
  return postJson(t.app, '/api/auth/login', { email, password }, { remoteAddress })
}

function countSessions(): number {
  return (t.db.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n
}

describe('GET /api/auth/config', () => {
  it('reports whether sign-up is open', async () => {
    t = await makeApp({ allowSignup: false })
    expect((await get(t.app, '/api/auth/config')).json()).toEqual({ signupEnabled: false })
    await t.close()
    t = await makeApp({ allowSignup: true })
    expect((await get(t.app, '/api/auth/config')).json()).toEqual({ signupEnabled: true })
  })
})

describe('POST /api/auth/signup', () => {
  it('is 403 signup_disabled when ALLOW_SIGNUP is off', async () => {
    t = await makeApp({ allowSignup: false })
    const res = await signup()
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: { code: 'signup_disabled', message: expect.any(String) } })
    expect(setCookies(res)).toEqual([])
  })

  it('creates the user, answers 201 with it and sets an insecure session cookie', async () => {
    t = await makeApp({ allowSignup: true, cookieSecure: false })
    const res = await signup(' Ro@Example.COM ')
    expect(res.statusCode).toBe(201)
    const { user } = res.json()
    expect(user).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), email: 'ro@example.com', createdAt: '2026-10-08T12:00:00.000Z' })

    const [cookie] = setCookies(res)
    expect(cookie).toMatch(/^mosaic_session=[A-Za-z0-9_-]{43};/)
    const attrs = cookie.split('; ').slice(1)
    expect(attrs).toEqual(expect.arrayContaining(['Max-Age=2592000', 'Path=/', 'HttpOnly', 'SameSite=Lax']))
    expect(attrs).not.toContain('Secure')
    expect(cookie).not.toMatch(/Domain=/i)
  })

  it('uses the __Host- cookie with Secure when COOKIE_SECURE is on', async () => {
    t = await makeApp({ allowSignup: true, cookieSecure: true })
    const res = await signup()
    expect(res.statusCode).toBe(201)
    const [cookie] = setCookies(res)
    expect(cookie).toMatch(/^__Host-mosaic_session=[A-Za-z0-9_-]{43};/)
    expect(cookie.split('; ')).toEqual(expect.arrayContaining(['Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure', 'Max-Age=2592000']))
    // The cookie it set is the one it reads back.
    const me = await get(t.app, '/api/auth/me', sessionCookie(res))
    expect(me.statusCode).toBe(200)
  })

  it('hashes the password with argon2id at the SPEC parameters', async () => {
    t = await makeApp({ allowSignup: true })
    expect((await signup()).statusCode).toBe(201)
    const { password_hash } = t.db.prepare('SELECT password_hash FROM users').get() as { password_hash: string }
    expect(password_hash).toMatch(ARGON2ID_PREFIX)
    // The dummy verify for unknown e-mails costs what a real one does.
    expect(await getDummyHash()).toMatch(ARGON2ID_PREFIX)
  })

  it('stores only the SHA-256 of the session token', async () => {
    t = await makeApp({ allowSignup: true })
    const token = sessionCookie(await signup()).split('=')[1]
    const rows = t.db.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>
    expect(rows).toEqual([{ token_hash: hashToken(token) }])
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is 409 email_taken for an existing e-mail in any case', async () => {
    t = await makeApp({ allowSignup: true })
    expect((await signup('ro@example.com')).statusCode).toBe(201)
    const res = await signup('RO@EXAMPLE.com')
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('email_taken')
  })

  it('is 400 invalid_input naming each bad field', async () => {
    t = await makeApp({ allowSignup: true })
    const res = await signup('not-an-email', 'short')
    expect(res.statusCode).toBe(400)
    const { error } = res.json()
    expect(error.code).toBe('invalid_input')
    expect(Object.keys(error.details.fields).sort()).toEqual(['email', 'password'])
    expect(error.details.fields.password).toMatch(/at least 10/)

    const longPassword = await signup('ro@example.com', 'x'.repeat(257))
    expect(longPassword.json().error.details.fields).toEqual({ password: expect.stringMatching(/at most 256/) })
  })

  it('rejects missing, mistyped and unknown fields by schema', async () => {
    t = await makeApp({ allowSignup: true })
    const missing = await postJson(t.app, '/api/auth/signup', { email: 'ro@example.com' })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().error.details.fields).toEqual({ password: 'Required' })

    const extra = await postJson(t.app, '/api/auth/signup', { email: 'ro@example.com', password: PASSWORD, admin: true })
    expect(extra.statusCode).toBe(400)
    expect(extra.json().error.details.fields).toEqual({ admin: 'Unknown field' })

    // No coercion: a number is not a password.
    const typed = await postJson(t.app, '/api/auth/signup', { email: 'ro@example.com', password: 12345678901 })
    expect(typed.statusCode).toBe(400)
    expect(typed.json().error.details.fields).toEqual({ password: expect.stringMatching(/string/) })

    const notObject = await postJson(t.app, '/api/auth/signup', ['ro@example.com', PASSWORD])
    expect(notObject.statusCode).toBe(400)
    expect(notObject.json().error.details.fields).toHaveProperty('body')
    expect(countSessions()).toBe(0)
  })
})

describe('POST /api/auth/login', () => {
  it('accepts Unicode aliases already normalized by the frontend', async () => {
    t = await makeApp({ allowSignup: true })
    const created = await signup()
    const userId = created.json().user.id
    assignLoginAlias(t.db, userId, 'J\u030cana Fios')
    const composed = await login(normalizeLoginIdentifier('J\u030cana Fios'))
    expect(composed.statusCode).toBe(200)
    expect(composed.json().user.id).toBe(userId)
    expect((await login('ǰana fios')).statusCode).toBe(200)
    assignLoginAlias(t.db, userId, 'İ'.repeat(40))
    expect((await login(normalizeLoginIdentifier('İ'.repeat(40)))).statusCode).toBe(200)
    expect(() => assignLoginAlias(t.db, userId, 'İ'.repeat(41))).toThrow(/normalized/)
    // Failed reassignment preserves the current working login.
    expect((await login(normalizeLoginIdentifier('İ'.repeat(40)))).statusCode).toBe(200)
  })

  it('accepts the assigned login name with normalized case and spacing, and keeps e-mail login', async () => {
    t = await makeApp({ allowSignup: true })
    const created = await signup()
    assignLoginAlias(t.db, created.json().user.id, '  José   dos Fios ')
    const res = await login('  JOSE\u0301   DOS FIOS ')
    expect(res.statusCode).toBe(200)
    expect(res.json().user).toEqual({ ...created.json().user, displayName: 'José dos Fios' })
    expect((await get(t.app, '/api/auth/me', sessionCookie(res))).json()).toEqual(res.json())
    expect((await login('RO@example.com')).json()).toEqual(res.json())
  })

  it('keeps alias failures indistinguishable and verifies an unknown name against the dummy hash', async () => {
    t = await makeApp({ allowSignup: true })
    const created = await signup()
    assignLoginAlias(t.db, created.json().user.id, 'Artista dos Fios')
    const wrong = await login('Artista dos Fios', 'wrong password!')
    const verify = vi.mocked(verifyPassword)
    verify.mockClear()
    const unknown = await login('Artista Desconhecido', PASSWORD)
    expect(wrong.statusCode).toBe(401)
    expect(unknown.statusCode).toBe(401)
    expect(wrong.rawPayload.equals(unknown.rawPayload)).toBe(true)
    expect(verify.mock.calls).toEqual([[await getDummyHash(), PASSWORD]])
    expect(setCookies(wrong)).toEqual([])
    expect(setCookies(unknown)).toEqual([])
  })

  it('shares the account throttle across alias, e-mail and authenticated password checks', async () => {
    t = await makeApp({ allowSignup: true })
    const created = await signup()
    assignLoginAlias(t.db, created.json().user.id, 'Artista dos Fios')
    const cookie = sessionCookie(created)
    for (let i = 0; i < 10; i++) {
      const identifier = i % 2 ? '  ARTISTA   DOS FIOS ' : 'RO@example.com'
      expect((await login(identifier, 'wrong password!', `10.5.0.${i}`)).statusCode).toBe(401)
    }
    expect((await login('Artista dos Fios', PASSWORD, '10.6.0.1')).statusCode).toBe(429)
    expect((await login('ro@example.com', PASSWORD, '10.6.0.2')).statusCode).toBe(429)
    const change = await postJson(t.app, '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'a whole new passphrase' }, { cookie, remoteAddress: '10.6.0.3' })
    expect(change.statusCode).toBe(429)
    const remove = await postJson(t.app, '/api/auth/delete-account', { password: PASSWORD }, { cookie, remoteAddress: '10.6.0.4' })
    expect(remove.statusCode).toBe(429)
    t.clock.advance(15 * 60 * 1000)
    expect((await login('Artista dos Fios', PASSWORD, '10.6.0.5')).statusCode).toBe(200)
  })

  it('rejects malformed login names as invalid input and still refuses alias signup', async () => {
    t = await makeApp({ allowSignup: true })
    expect((await login('bad@alias')).statusCode).toBe(400)
    const invalid = await login('name\x00control')
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.details.fields.email).toMatch(/control/)
    expect((await signup('Artista dos Fios')).statusCode).toBe(400)
  })

  it('signs in with any case of the e-mail and sets a new session cookie', async () => {
    t = await makeApp({ allowSignup: true })
    await signup()
    const res = await login('  RO@example.com')
    expect(res.statusCode).toBe(200)
    expect(res.json().user.email).toBe('ro@example.com')
    const cookie = sessionCookie(res)
    expect(cookie).toMatch(/^mosaic_session=/)
    expect((await get(t.app, '/api/auth/me', cookie)).json().user.email).toBe('ro@example.com')
  })

  it('answers wrong password and unknown e-mail with byte-identical 401 bodies', async () => {
    t = await makeApp({ allowSignup: true })
    await signup()
    const wrong = await login('ro@example.com', 'wrong password!')
    const unknown = await login('nobody@example.com', PASSWORD)
    expect(wrong.statusCode).toBe(401)
    expect(unknown.statusCode).toBe(401)
    expect(wrong.json().error.code).toBe('invalid_credentials')
    expect(wrong.rawPayload.equals(unknown.rawPayload)).toBe(true)
    expect(setCookies(wrong)).toEqual([])
    expect(setCookies(unknown)).toEqual([])
  })

  it('verifies against the dummy hash for an unknown e-mail, once, as for a known one', async () => {
    t = await makeApp({ allowSignup: true })
    await signup()
    const verify = vi.mocked(verifyPassword)
    const { password_hash } = t.db.prepare('SELECT password_hash FROM users').get() as { password_hash: string }

    verify.mockClear()
    expect((await login('nobody@example.com', PASSWORD)).statusCode).toBe(401)
    expect(verify.mock.calls).toEqual([[await getDummyHash(), PASSWORD]])

    verify.mockClear()
    expect((await login('ro@example.com', 'wrong password!')).statusCode).toBe(401)
    expect(verify.mock.calls).toEqual([[password_hash, 'wrong password!']])
  })

  it('replaces the session the browser came in with', async () => {
    t = await makeApp({ allowSignup: true })
    const first = sessionCookie(await signup())
    const res = await postJson(t.app, '/api/auth/login', { email: 'ro@example.com', password: PASSWORD }, { cookie: first })
    expect(res.statusCode).toBe(200)
    expect((await get(t.app, '/api/auth/me', first)).statusCode).toBe(401)
    expect((await get(t.app, '/api/auth/me', sessionCookie(res))).statusCode).toBe(200)
  })

  it('is 400 for an empty password', async () => {
    t = await makeApp()
    const res = await login('ro@example.com', '')
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details.fields).toEqual({ password: 'Password is required' })
  })
})

describe('GET /api/auth/me', () => {
  it('is 401 unauthenticated without a cookie', async () => {
    t = await makeApp()
    const res = await get(t.app, '/api/auth/me')
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: { code: 'unauthenticated', message: expect.any(String) } })
  })

  it('is 401 for a forged cookie and clears it', async () => {
    t = await makeApp()
    const res = await get(t.app, '/api/auth/me', `mosaic_session=${'A'.repeat(43)}`)
    expect(res.statusCode).toBe(401)
    expect(setCookies(res)[0]).toMatch(/^mosaic_session=; Max-Age=0;/)
  })

  it('clears a forged __Host- cookie with Secure when COOKIE_SECURE is on', async () => {
    t = await makeApp({ cookieSecure: true })
    const res = await get(t.app, '/api/auth/me', `__Host-mosaic_session=${'A'.repeat(43)}`)
    expect(res.statusCode).toBe(401)
    expect(setCookies(res)[0]).toMatch(CLEARED_HOST_COOKIE)
    expect(setCookies(res)[0]).not.toMatch(/Domain=/i)
  })

  it('returns the user for a live session', async () => {
    t = await makeApp({ allowSignup: true })
    const created = await signup()
    const res = await get(t.app, '/api/auth/me', sessionCookie(created))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ user: created.json().user })
    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('POST /api/auth/logout', () => {
  it('ends the session: the old cookie is 401 afterwards', async () => {
    t = await makeApp({ allowSignup: true })
    const cookie = sessionCookie(await signup())
    const res = await postJson(t.app, '/api/auth/logout', {}, { cookie })
    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
    expect(setCookies(res)[0]).toMatch(/^mosaic_session=; Max-Age=0; Path=\/;/)
    expect(countSessions()).toBe(0)
    expect((await get(t.app, '/api/auth/me', cookie)).statusCode).toBe(401)
  })

  it('clears the __Host- cookie with Secure when COOKIE_SECURE is on', async () => {
    t = await makeApp({ allowSignup: true, cookieSecure: true })
    const cookie = sessionCookie(await signup())
    const res = await postJson(t.app, '/api/auth/logout', {}, { cookie })
    expect(res.statusCode).toBe(204)
    expect(setCookies(res)[0]).toMatch(CLEARED_HOST_COOKIE)
    expect(setCookies(res)[0]).not.toMatch(/Domain=/i)
    expect(countSessions()).toBe(0)
  })

  it('is 204 without a session, with or without a JSON content type', async () => {
    t = await makeApp()
    expect((await t.app.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(204)
    const withHeader = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { 'content-type': 'application/json' } })
    expect(withHeader.statusCode).toBe(204)
  })
})

describe('session lifetime', () => {
  it('rejects and deletes a session past SESSION_TTL_DAYS', async () => {
    t = await makeApp({ allowSignup: true, sessionTtlDays: 30 })
    const cookie = sessionCookie(await signup())
    t.clock.advance(30 * DAY_MS)
    const res = await get(t.app, '/api/auth/me', cookie)
    expect(res.statusCode).toBe(401)
    expect(countSessions()).toBe(0)
  })

  it('slides: activity after an hour re-sends the cookie and pushes expiry forward', async () => {
    t = await makeApp({ allowSignup: true, sessionTtlDays: 30 })
    const cookie = sessionCookie(await signup())

    // Within the hour nothing is written and no cookie is re-sent.
    t.clock.advance(SESSION_REFRESH_MS)
    const quiet = await get(t.app, '/api/auth/me', cookie)
    expect(quiet.statusCode).toBe(200)
    expect(setCookies(quiet)).toEqual([])

    t.clock.advance(29 * DAY_MS)
    const renewed = await get(t.app, '/api/auth/me', cookie)
    expect(renewed.statusCode).toBe(200)
    const [line] = setCookies(renewed)
    expect(line.split(';')[0]).toBe(cookie)
    expect(line).toContain('Max-Age=2592000')
    const row = t.db.prepare('SELECT expires_at, last_seen_at FROM sessions').get() as { expires_at: number; last_seen_at: number }
    expect(row).toEqual({ last_seen_at: t.clock.now, expires_at: t.clock.now + 30 * DAY_MS })

    // Past the original 30 days, still signed in thanks to the renewal.
    t.clock.advance(2 * DAY_MS)
    expect((await get(t.app, '/api/auth/me', cookie)).statusCode).toBe(200)
  })

  it('follows a SESSION_TTL_DAYS other than the default for the cookie, the renewal and the expiry', async () => {
    t = await makeApp({ allowSignup: true, sessionTtlDays: 7 })
    const created = await signup()
    expect(setCookies(created)[0]).toContain('Max-Age=604800')
    const cookie = sessionCookie(created)

    t.clock.advance(SESSION_REFRESH_MS + 1)
    const renewed = await get(t.app, '/api/auth/me', cookie)
    expect(renewed.statusCode).toBe(200)
    expect(setCookies(renewed)[0]).toContain('Max-Age=604800')
    const row = t.db.prepare('SELECT expires_at FROM sessions').get() as { expires_at: number }
    expect(row.expires_at).toBe(t.clock.now + 7 * DAY_MS)

    // Seven idle days after the renewal, the session is gone.
    t.clock.advance(7 * DAY_MS)
    expect((await get(t.app, '/api/auth/me', cookie)).statusCode).toBe(401)
    expect(countSessions()).toBe(0)
  })

  it('purges expired sessions when the app starts', async () => {
    t = await makeApp({ allowSignup: true })
    await signup()
    t.db.prepare('UPDATE sessions SET expires_at = ?').run(t.clock.now - 1)
    const { buildApp } = await import('../app')
    const second = await buildApp({ config: t.config, db: t.db, now: () => t.clock.now })
    await second.close()
    expect(countSessions()).toBe(0)
  })
})

describe('POST /api/auth/password', () => {
  it('keeps the current session, ends the others, and switches the password', async () => {
    t = await makeApp({ allowSignup: true })
    const current = sessionCookie(await signup('ro@example.com', PASSWORD, '10.0.0.1'))
    const other = sessionCookie(await login('ro@example.com', PASSWORD, '10.0.0.2'))
    const res = await postJson(
      t.app,
      '/api/auth/password',
      { currentPassword: PASSWORD, newPassword: 'a whole new passphrase' },
      { cookie: current },
    )
    expect(res.statusCode).toBe(204)
    expect((await get(t.app, '/api/auth/me', current)).statusCode).toBe(200)
    expect((await get(t.app, '/api/auth/me', other)).statusCode).toBe(401)
    expect((await login('ro@example.com', PASSWORD, '10.0.0.3')).statusCode).toBe(401)
    expect((await login('ro@example.com', 'a whole new passphrase', '10.0.0.4')).statusCode).toBe(200)
  })

  it('is 401 invalid_credentials for a wrong current password and 400 for a weak new one', async () => {
    t = await makeApp({ allowSignup: true })
    const cookie = sessionCookie(await signup())
    const wrong = await postJson(t.app, '/api/auth/password', { currentPassword: 'not my password', newPassword: 'a whole new passphrase' }, { cookie })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json().error.code).toBe('invalid_credentials')
    const weak = await postJson(t.app, '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'short' }, { cookie })
    expect(weak.statusCode).toBe(400)
    expect(weak.json().error.details.fields).toEqual({ newPassword: expect.stringMatching(/at least 10/) })
  })

  it('locks the e-mail after 10 wrong current passwords, for this route and login alike', async () => {
    t = await makeApp({ allowSignup: true })
    const cookie = sessionCookie(await signup('ro@example.com', PASSWORD, '10.0.0.1'))
    const change = (currentPassword: string, i: number) =>
      postJson(t.app, '/api/auth/password', { currentPassword, newPassword: 'a whole new passphrase' }, { cookie, remoteAddress: `10.1.0.${i}` })
    for (let i = 0; i < 10; i++) expect((await change('not my password', i)).statusCode).toBe(401)
    const locked = await change(PASSWORD, 100)
    expect(locked.statusCode).toBe(429)
    expect(locked.json().error.code).toBe('rate_limited')
    expect(Number(locked.headers['retry-after'])).toBe(15 * 60)
    expect((await login('ro@example.com', PASSWORD, '10.0.0.2')).statusCode).toBe(429)
    t.clock.advance(15 * 60 * 1000)
    expect((await change(PASSWORD, 101)).statusCode).toBe(204)
  })

  it('allows 10 calls a minute per IP', async () => {
    t = await makeApp({ allowSignup: true })
    const cookie = sessionCookie(await signup('ro@example.com', PASSWORD, '10.0.0.1'))
    const change = () => postJson(t.app, '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'short' }, { cookie, remoteAddress: '10.2.0.1' })
    for (let i = 0; i < 10; i++) expect((await change()).statusCode).toBe(400)
    expect((await change()).statusCode).toBe(429)
  })

  it('is 401 unauthenticated without a session', async () => {
    t = await makeApp()
    const res = await postJson(t.app, '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'a whole new passphrase' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthenticated')
  })
})

describe('POST /api/auth/delete-account', () => {
  it('locks the e-mail after 10 wrong passwords and keeps the account', async () => {
    t = await makeApp({ allowSignup: true })
    const cookie = sessionCookie(await signup('ro@example.com', PASSWORD, '10.0.0.1'))
    const remove = (password: string, i: number) => postJson(t.app, '/api/auth/delete-account', { password }, { cookie, remoteAddress: `10.3.0.${i}` })
    for (let i = 0; i < 10; i++) expect((await remove('not my password', i)).statusCode).toBe(401)
    const locked = await remove(PASSWORD, 100)
    expect(locked.statusCode).toBe(429)
    expect(locked.json().error.code).toBe('rate_limited')
    expect((await get(t.app, '/api/auth/me', cookie)).statusCode).toBe(200)
  })

  it('allows 10 calls a minute per IP', async () => {
    t = await makeApp({ allowSignup: true })
    const cookie = sessionCookie(await signup('ro@example.com', PASSWORD, '10.0.0.1'))
    const remove = () => postJson(t.app, '/api/auth/delete-account', { password: '' }, { cookie, remoteAddress: '10.4.0.1' })
    for (let i = 0; i < 10; i++) expect((await remove()).statusCode).toBe(400)
    expect((await remove()).statusCode).toBe(429)
  })

  it('deletes the user and, by cascade, their sessions and patterns', async () => {
    t = await makeApp({ allowSignup: true })
    const created = await signup('ro@example.com', PASSWORD, '10.0.0.1')
    const cookie = sessionCookie(created)
    await login('ro@example.com', PASSWORD, '10.0.0.2')
    const keeper = sessionCookie(await signup('other@example.com', PASSWORD, '10.0.0.3'))
    const userId = created.json().user.id
    assignLoginAlias(t.db, userId, 'Artista dos Fios')
    t.db
      .prepare('INSERT INTO patterns VALUES (?, ?, ?, 5, 5, ?, 1, ?, ?)')
      .run('7d3c1f9e-8a51-4b8e-9d1a-0c6a7b2f4e10', userId, 'p', '{}', t.clock.now, t.clock.now)

    const wrong = await postJson(t.app, '/api/auth/delete-account', { password: 'not my password' }, { cookie })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json().error.code).toBe('invalid_credentials')

    const res = await postJson(t.app, '/api/auth/delete-account', { password: PASSWORD }, { cookie })
    expect(res.statusCode).toBe(204)
    expect(setCookies(res)[0]).toMatch(/^mosaic_session=; Max-Age=0;/)
    const count = (sql: string) => (t.db.prepare(sql).get(userId) as { n: number }).n
    expect(count('SELECT count(*) AS n FROM users WHERE id = ?')).toBe(0)
    expect(count('SELECT count(*) AS n FROM sessions WHERE user_id = ?')).toBe(0)
    expect(count('SELECT count(*) AS n FROM patterns WHERE owner_id = ?')).toBe(0)
    expect(count('SELECT count(*) AS n FROM user_aliases WHERE user_id = ?')).toBe(0)
    expect((await get(t.app, '/api/auth/me', cookie)).statusCode).toBe(401)
    expect((await login('ro@example.com', PASSWORD, '10.0.0.4')).statusCode).toBe(401)
    expect((await login('Artista dos Fios', PASSWORD, '10.0.0.5')).statusCode).toBe(401)
    // Nobody else is affected.
    expect((await get(t.app, '/api/auth/me', keeper)).statusCode).toBe(200)
  })

  it('clears the __Host- cookie with Secure when COOKIE_SECURE is on', async () => {
    t = await makeApp({ allowSignup: true, cookieSecure: true })
    const cookie = sessionCookie(await signup())
    const res = await postJson(t.app, '/api/auth/delete-account', { password: PASSWORD }, { cookie })
    expect(res.statusCode).toBe(204)
    expect(setCookies(res)[0]).toMatch(CLEARED_HOST_COOKIE)
    expect(setCookies(res)[0]).not.toMatch(/Domain=/i)
  })
})
