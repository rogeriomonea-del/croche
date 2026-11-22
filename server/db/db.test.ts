import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LATEST_VERSION, migrate, openDatabase, schemaVersion } from './index'
import { MIGRATIONS } from './migrations'

const dir = mkdtempSync(join(tmpdir(), 'mosaic-db-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function tables(db: ReturnType<typeof openDatabase>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name)
}

describe('openDatabase', () => {
  it('creates the schema and turns foreign keys on', () => {
    const db = openDatabase(':memory:')
    expect(schemaVersion(db)).toBe(LATEST_VERSION)
    expect(tables(db)).toEqual(['patterns', 'sessions', 'user_aliases', 'users'])
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    db.close()
  })

  it('uses WAL for a file database and creates its directory', () => {
    const db = openDatabase(join(dir, 'nested', 'mosaic.db'))
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    db.close()
  })

  it('migrates once: a second run is a no-op that keeps the data', () => {
    const path = join(dir, 'twice.db')
    const db = openDatabase(path, { migrate: false })
    expect(schemaVersion(db)).toBe(0)
    expect(migrate(db)).toEqual({ from: 0, to: LATEST_VERSION })
    db.prepare("INSERT INTO users VALUES ('u1', 'ro@example.com', 'h', 1, 1)").run()
    expect(migrate(db)).toEqual({ from: LATEST_VERSION, to: LATEST_VERSION })
    db.close()

    const again = openDatabase(path)
    expect(schemaVersion(again)).toBe(LATEST_VERSION)
    expect(again.prepare('SELECT email FROM users').all()).toEqual([{ email: 'ro@example.com' }])
    again.close()
  })

  it('refuses a database from a newer build', () => {
    const path = join(dir, 'future.db')
    const db = openDatabase(path)
    db.pragma(`user_version = ${LATEST_VERSION + 1}`)
    db.close()
    expect(() => openDatabase(path)).toThrow(/newer than this build/)
  })

  it('upgrades an existing version 1 database without losing accounts, sessions or patterns', () => {
    const db = openDatabase(':memory:', { migrate: false })
    db.exec(MIGRATIONS[0])
    db.pragma('user_version = 1')
    db.prepare("INSERT INTO users VALUES ('u1', 'ro@example.com', 'h', 1, 1)").run()
    db.prepare("INSERT INTO sessions VALUES ('h', 'u1', 1, 2, 1)").run()
    db.prepare("INSERT INTO patterns VALUES ('p1', 'u1', 'n', 5, 5, '{}', 1, 1, 1)").run()
    expect(migrate(db)).toEqual({ from: 1, to: LATEST_VERSION })
    expect(db.prepare('SELECT * FROM users').get()).toEqual({ id: 'u1', email: 'ro@example.com', password_hash: 'h', created_at: 1, updated_at: 1 })
    expect(db.prepare('SELECT token_hash FROM sessions').all()).toEqual([{ token_hash: 'h' }])
    expect(db.prepare('SELECT id, document, revision FROM patterns').all()).toEqual([{ id: 'p1', document: '{}', revision: 1 }])
    db.prepare("INSERT INTO user_aliases VALUES ('u1', 'artista dos fios', 'Artista dos Fios')").run()
    expect(migrate(db)).toEqual({ from: LATEST_VERSION, to: LATEST_VERSION })
    expect(db.prepare('SELECT display_name FROM user_aliases').get()).toEqual({ display_name: 'Artista dos Fios' })
    db.close()
  })

  it('enforces foreign keys and cascades user deletion', () => {
    const db = openDatabase(':memory:')
    expect(() => db.prepare("INSERT INTO sessions VALUES ('h', 'ghost', 1, 2, 1)").run()).toThrow(/FOREIGN KEY/)
    expect(() => db.prepare("INSERT INTO user_aliases VALUES ('ghost', 'missing artist', 'Missing Artist')").run()).toThrow(/FOREIGN KEY/)
    db.prepare("INSERT INTO users VALUES ('u1', 'ro@example.com', 'h', 1, 1)").run()
    db.prepare("INSERT INTO sessions VALUES ('h', 'u1', 1, 2, 1)").run()
    db.prepare("INSERT INTO patterns VALUES ('p1', 'u1', 'n', 5, 5, '{}', 1, 1, 1)").run()
    db.prepare("INSERT INTO user_aliases VALUES ('u1', 'artista dos fios', 'Artista dos Fios')").run()
    db.prepare("DELETE FROM users WHERE id = 'u1'").run()
    expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM patterns').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM user_aliases').get()).toEqual({ n: 0 })
    db.close()
  })
})
