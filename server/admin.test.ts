import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { backupDatabase, CliError, createUser, formatUserList, removeUser, runCli, setUserAlias, setUserPassword, type CliDeps } from './admin'
import { buildApp } from './app'
import { findUserByLogin, insertUser, LoginAliasTakenError } from './auth/users'
import { LATEST_VERSION, openDatabase } from './db'
import { get, makeApp, PASSWORD, postJson, sessionCookie, testConfig, type TestApp } from './test/helpers'

const dir = mkdtempSync(join(tmpdir(), 'mosaic-cli-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

let t: TestApp | undefined
afterEach(async () => {
  await t?.close()
  t = undefined
})

function cliDeps(env: Record<string, string>, stdinText?: string): CliDeps & { out: () => string; err: () => string } {
  let out = ''
  let err = ''
  const stdin = stdinText === undefined ? Object.assign(Readable.from([]), { isTTY: false }) : Readable.from([stdinText])
  return {
    env: { LOG_LEVEL: 'silent', ...env },
    stdin,
    stdout: { write: (s: string) => (out += s) },
    stderr: { write: (s: string) => (err += s) },
    out: () => out,
    err: () => err,
  }
}

describe('admin functions', () => {
  it('assigns a unique name, supports safe reassignment and rejects normalized duplicates', async () => {
    t = await makeApp()
    const first = await createUser(t.db, 'ro@example.com', PASSWORD)
    await createUser(t.db, 'other@example.com', PASSWORD)
    expect(setUserAlias(t.db, '  RO@example.com ', '  José   dos Fios ')).toBe('José dos Fios')
    expect(findUserByLogin(t.db, 'josé dos fios')?.id).toBe(first.id)
    expect(() => setUserAlias(t!.db, 'other@example.com', 'JOSE\u0301 DOS FIOS')).toThrow(LoginAliasTakenError)
    expect(findUserByLogin(t.db, 'josé dos fios')?.id).toBe(first.id)
    expect(setUserAlias(t.db, 'ro@example.com', 'Novo Ateliê')).toBe('Novo Ateliê')
    expect(findUserByLogin(t.db, 'josé dos fios')).toBeUndefined()
    expect(findUserByLogin(t.db, 'novo ateliê')?.id).toBe(first.id)
    expect(() => setUserAlias(t!.db, 'other@example.com', 'other@example.com')).toThrow(/letters/)
    expect(() => setUserAlias(t!.db, 'ghost@example.com', 'Missing Artist')).toThrow(/No user/)
  })

  it('creates a user who can then sign in through the API', async () => {
    t = await makeApp({ allowSignup: false })
    const user = await createUser(t.db, ' Ro@Example.com ', PASSWORD)
    expect(user.email).toBe('ro@example.com')
    const res = await postJson(t.app, '/api/auth/login', { email: 'ro@example.com', password: PASSWORD })
    expect(res.statusCode).toBe(200)
    expect(res.json().user).toEqual({ id: user.id, email: 'ro@example.com', createdAt: expect.any(String) })
  })

  it('refuses a duplicate, a bad e-mail and a short password', async () => {
    t = await makeApp()
    await createUser(t.db, 'ro@example.com', PASSWORD)
    await expect(createUser(t.db, 'RO@example.com', PASSWORD)).rejects.toThrow(/already exists/)
    await expect(createUser(t.db, 'nope', PASSWORD)).rejects.toBeInstanceOf(CliError)
    await expect(createUser(t.db, 'new@example.com', 'short')).rejects.toThrow(/at least 10/)
  })

  it('set-password changes the password and ends every session of that user', async () => {
    t = await makeApp()
    await createUser(t.db, 'ro@example.com', PASSWORD)
    await createUser(t.db, 'other@example.com', PASSWORD)
    const a = sessionCookie(await postJson(t.app, '/api/auth/login', { email: 'ro@example.com', password: PASSWORD }))
    const b = sessionCookie(await postJson(t.app, '/api/auth/login', { email: 'ro@example.com', password: PASSWORD }))
    const other = sessionCookie(await postJson(t.app, '/api/auth/login', { email: 'other@example.com', password: PASSWORD }))

    expect(await setUserPassword(t.db, 'ro@example.com', 'brand new passphrase')).toBe(2)
    expect((await get(t.app, '/api/auth/me', a)).statusCode).toBe(401)
    expect((await get(t.app, '/api/auth/me', b)).statusCode).toBe(401)
    expect((await get(t.app, '/api/auth/me', other)).statusCode).toBe(200)
    expect((await postJson(t.app, '/api/auth/login', { email: 'ro@example.com', password: PASSWORD })).statusCode).toBe(401)
    expect((await postJson(t.app, '/api/auth/login', { email: 'ro@example.com', password: 'brand new passphrase' })).statusCode).toBe(200)
    await expect(setUserPassword(t.db, 'ghost@example.com', 'brand new passphrase')).rejects.toThrow(/No user/)
  })

  it('removes a user and lists the rest', async () => {
    t = await makeApp()
    expect(formatUserList(t.db)).toBe('No users\n')
    await createUser(t.db, 'ro@example.com', PASSWORD, Date.parse('2026-10-08T12:00:00Z'))
    await createUser(t.db, 'gone@example.com', PASSWORD)
    removeUser(t.db, 'GONE@example.com')
    const lines = formatUserList(t.db).trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^EMAIL\s+CREATED\s+SESSIONS\s+PATTERNS\s+ID$/)
    expect(lines[1]).toMatch(/^ro@example\.com\s+2026-10-08T12:00:00\.000Z\s+0\s+0\s+[0-9a-f-]{36}$/)
    expect(() => removeUser(t!.db, 'gone@example.com')).toThrow(/No user/)
  })

  it('lists a stored address with control characters escaped', async () => {
    t = await makeApp()
    insertUser(t.db, '\x1b[2j\x07evil@x.co', 'hash', Date.parse('2026-10-08T12:00:00Z'))
    const listing = formatUserList(t.db)
    expect(listing).not.toMatch(/[\x1b\x07]/)
    expect(listing).toContain('\\x1b[2j\\x07evil@x.co')
  })

  it('backs up to a new file and refuses to overwrite', async () => {
    t = await makeApp()
    await createUser(t.db, 'ro@example.com', PASSWORD)
    const dest = join(dir, 'backups', 'one.db')
    await backupDatabase(t.db, dest)
    const copy = openDatabase(dest)
    expect(copy.prepare('SELECT email FROM users').all()).toEqual([{ email: 'ro@example.com' }])
    copy.close()
    await expect(backupDatabase(t.db, dest)).rejects.toThrow(/already exists/)
  })
})

describe('runCli', () => {
  it('user:alias assigns a login name without receiving or printing a password', async () => {
    const dbPath = join(dir, 'alias.db')
    const db = openDatabase(dbPath)
    await createUser(db, 'ro@example.com', PASSWORD)
    db.close()
    const deps = cliDeps({ DATABASE_PATH: dbPath })
    expect(await runCli(['user:alias', 'ro@example.com', 'Artista dos Fios'], deps)).toBe(0)
    expect(deps.out()).toBe('Login name set to Artista dos Fios for ro@example.com\n')
    expect(deps.err()).toBe('')
    expect(deps.out()).not.toContain(PASSWORD)
    const appDb = openDatabase(dbPath)
    const app = await buildApp({ config: testConfig({ databasePath: dbPath }), db: appDb })
    try {
      const res = await postJson(app, '/api/auth/login', { email: 'artista dos fios', password: PASSWORD })
      expect(res.statusCode).toBe(200)
      expect(res.json().user.displayName).toBe('Artista dos Fios')
    } finally {
      await app.close()
      appDb.close()
    }
    const badArgs = cliDeps({ DATABASE_PATH: dbPath })
    expect(await runCli(['user:alias', 'ro@example.com'], badArgs)).toBe(1)
    const passwordFlag = cliDeps({ DATABASE_PATH: dbPath })
    expect(await runCli(['user:alias', 'ro@example.com', 'Artista dos Fios', '--password-stdin'], passwordFlag)).toBe(1)
  })

  it('user:create --password-stdin, then the server accepts the login', async () => {
    const dbPath = join(dir, 'cli.db')
    const deps = cliDeps({ DATABASE_PATH: dbPath }, `${PASSWORD}\n`)
    expect(await runCli(['user:create', 'Ro@Example.com', '--password-stdin'], deps)).toBe(0)
    expect(deps.out()).toMatch(/^Created user ro@example\.com \([0-9a-f-]{36}\)\n$/)

    const db = openDatabase(dbPath)
    const app = await buildApp({ config: testConfig({ databasePath: dbPath }), db })
    try {
      const res = await postJson(app, '/api/auth/login', { email: 'ro@example.com', password: PASSWORD })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
      db.close()
    }

    const list = cliDeps({ DATABASE_PATH: dbPath })
    expect(await runCli(['user:list'], list)).toBe(0)
    expect(list.out()).toContain('ro@example.com')

    const del = cliDeps({ DATABASE_PATH: dbPath })
    expect(await runCli(['user:delete', 'ro@example.com'], del)).toBe(0)
    expect(del.out()).toBe('Deleted user ro@example.com\n')
  })

  it('refuses to prompt when stdin is not a terminal, before touching the database', async () => {
    const dbPath = join(dir, 'notty.db')
    for (const command of ['user:create', 'user:set-password']) {
      const deps = cliDeps({ DATABASE_PATH: dbPath })
      expect(await runCli([command, 'ro@example.com'], deps)).toBe(1)
      expect(deps.err()).toMatch(/not a terminal.*--password-stdin/)
    }
    expect(existsSync(dbPath)).toBe(false)
  })

  it('reports errors on stderr with exit code 1', async () => {
    const dbPath = join(dir, 'errors.db')
    const weak = cliDeps({ DATABASE_PATH: dbPath }, 'short\n')
    expect(await runCli(['user:create', 'ro@example.com', '--password-stdin'], weak)).toBe(1)
    expect(weak.err()).toMatch(/^Error: Password must be at least 10/)

    const none = cliDeps({ DATABASE_PATH: dbPath })
    expect(await runCli([], none)).toBe(1)
    expect(none.err()).toMatch(/^Usage/)

    const unknown = cliDeps({ DATABASE_PATH: dbPath })
    expect(await runCli(['user:frobnicate'], unknown)).toBe(1)
    expect(unknown.err()).toMatch(/Unknown command/)

    const badArgs = cliDeps({ DATABASE_PATH: dbPath })
    expect(await runCli(['user:delete'], badArgs)).toBe(1)

    const badConfig = cliDeps({ DATABASE_PATH: dbPath, PORT: 'x' })
    expect(await runCli(['user:list'], badConfig)).toBe(1)
    expect(badConfig.err()).toMatch(/PORT/)
  })

  it('db:migrate and db:backup', async () => {
    const dbPath = join(dir, 'migrate.db')
    const first = cliDeps({ DATABASE_PATH: dbPath })
    expect(await runCli(['db:migrate'], first)).toBe(0)
    expect(first.out()).toBe(`Schema migrated from version 0 to ${LATEST_VERSION}\n`)
    const second = cliDeps({ DATABASE_PATH: dbPath })
    expect(await runCli(['db:migrate'], second)).toBe(0)
    expect(second.out()).toBe(`Schema already at version ${LATEST_VERSION}\n`)

    const dest = join(dir, 'migrate-backup.db')
    const backup = cliDeps({ DATABASE_PATH: dbPath })
    expect(await runCli(['db:backup', dest], backup)).toBe(0)
    expect(existsSync(dest)).toBe(true)
  })
})
