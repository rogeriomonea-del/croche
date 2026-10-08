import { randomUUID } from 'node:crypto'
import type { User } from '../../src/shared/api'
import { normalizeDisplayName, normalizeLoginIdentifier, loginAliasError } from '../../src/shared/login'
import type { Database } from '../db'

export interface UserRow {
  id: string
  email: string
  password_hash: string
  created_at: number
  updated_at: number
  display_name?: string | null
}

export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`A user with e-mail ${email} already exists`)
    this.name = 'EmailTakenError'
  }
}

export function toUser(row: Pick<UserRow, 'id' | 'email' | 'created_at' | 'display_name'>): User {
  return {
    id: row.id,
    email: row.email,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    createdAt: new Date(row.created_at).toISOString(),
  }
}

const USER_WITH_ALIAS = 'SELECT u.*, a.display_name FROM users u LEFT JOIN user_aliases a ON a.user_id = u.id'

/** `email` must already be normalized. */
export function findUserByEmail(db: Database, email: string): UserRow | undefined {
  return db.prepare<[string], UserRow>(`${USER_WITH_ALIAS} WHERE u.email = ?`).get(email)
}

export function findUserById(db: Database, id: string): UserRow | undefined {
  return db.prepare<[string], UserRow>(`${USER_WITH_ALIAS} WHERE u.id = ?`).get(id)
}

/** `identifier` is normalized and validated with the shared login helpers. */
export function findUserByLogin(db: Database, identifier: string): UserRow | undefined {
  return identifier.includes('@')
    ? findUserByEmail(db, identifier)
    : db.prepare<[string], UserRow>(`${USER_WITH_ALIAS} WHERE a.login_key = ?`).get(identifier)
}

export class LoginAliasTakenError extends Error {
  constructor() {
    super('This login name is already assigned to another account')
    this.name = 'LoginAliasTakenError'
  }
}

/** Assigns or replaces one unique login name without changing the account's e-mail. */
export function assignLoginAlias(db: Database, userId: string, rawName: string): string {
  const problem = loginAliasError(rawName)
  if (problem) throw new Error(problem)
  const displayName = normalizeDisplayName(rawName)
  try {
    db.prepare(
      `INSERT INTO user_aliases (user_id, login_key, display_name) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET login_key = excluded.login_key, display_name = excluded.display_name`,
    ).run(userId, normalizeLoginIdentifier(displayName), displayName)
  } catch (err) {
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new LoginAliasTakenError()
    throw err
  }
  return displayName
}

/** `email` must already be normalized and validated. Throws EmailTakenError on a duplicate. */
export function insertUser(db: Database, email: string, passwordHash: string, now: number): UserRow {
  const row: UserRow = { id: randomUUID(), email, password_hash: passwordHash, created_at: now, updated_at: now }
  try {
    db.prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (@id, @email, @password_hash, @created_at, @updated_at)',
    ).run(row)
  } catch (err) {
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new EmailTakenError(email)
    throw err
  }
  return row
}

export function updatePasswordHash(db: Database, userId: string, passwordHash: string, now: number): void {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, userId)
}

/** Sessions, patterns and login names go with the user (ON DELETE CASCADE). */
export function deleteUser(db: Database, userId: string): boolean {
  return db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes > 0
}

export function listUsers(db: Database): Array<UserRow & { sessions: number; patterns: number }> {
  return db
    .prepare<[], UserRow & { sessions: number; patterns: number }>(
      `SELECT u.*,
         (SELECT count(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
         (SELECT count(*) FROM patterns p WHERE p.owner_id = u.id) AS patterns
       FROM users u ORDER BY u.created_at, u.email`,
    )
    .all()
}
