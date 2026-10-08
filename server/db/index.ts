import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { MIGRATIONS } from './migrations'

export type Database = BetterSqlite3.Database

export interface OpenOptions {
  /** Apply pending migrations right away (the default); `db:migrate` opens without it to report progress. */
  migrate?: boolean
}

/** Opens (creating if needed) the SQLite database at `path`, or an in-memory one for ':memory:'. */
export function openDatabase(path: string, { migrate: runMigrations = true }: OpenOptions = {}): Database {
  const inMemory = path === ':memory:'
  if (!inMemory) mkdirSync(dirname(path), { recursive: true })
  const db = new BetterSqlite3(path)
  try {
    if (!inMemory) db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
    if (runMigrations) migrate(db)
  } catch (err) {
    db.close()
    throw err
  }
  return db
}

export function schemaVersion(db: Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

export const LATEST_VERSION = MIGRATIONS.length

/**
 * Brings the schema to the latest version. Each migration runs in its own transaction together
 * with the `user_version` bump, so a crash leaves the database at a whole version. Idempotent.
 */
export function migrate(db: Database): { from: number; to: number } {
  const from = schemaVersion(db)
  if (from > LATEST_VERSION) {
    throw new Error(`Database schema version ${from} is newer than this build supports (${LATEST_VERSION}); refusing to run`)
  }
  for (let v = from; v < LATEST_VERSION; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return { from, to: LATEST_VERSION }
}
