import { randomUUID } from 'node:crypto'
import type { User } from '../../src/shared/api'
import type { Database } from '../db'

export interface UserRow {
  id: string
  email: string
  password_hash: string
  created_at: number
  updated_at: number
}

export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`A user with e-mail ${email} already exists`)
    this.name = 'EmailTakenError'
  }
}

export function toUser(row: Pick<UserRow, 'id' | 'email' | 'created_at'>): User {
  return { id: row.id, email: row.email, createdAt: new Date(row.created_at).toISOString() }
}

/** `email` must already be normalized. */
export function findUserByEmail(db: Database, email: string): UserRow | undefined {
  return db.prepare<[string], UserRow>('SELECT * FROM users WHERE email = ?').get(email)
}

export function findUserById(db: Database, id: string): UserRow | undefined {
  return db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(id)
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

/** Sessions and patterns go with the user (ON DELETE CASCADE). */
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
