import { createHash, randomBytes } from 'node:crypto'
import type { Database } from '../db'
import type { UserRow } from './users'

// SPEC §9.2: the cookie carries 32 random bytes; the database only ever sees their SHA-256, so a
// leaked database (or backup) holds no usable session.

/** Sliding expiry is written back at most this often, not on every request. */
export const SESSION_REFRESH_MS = 60 * 60 * 1000
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export interface SessionRow {
  token_hash: string
  user_id: string
  created_at: number
  expires_at: number
  last_seen_at: number
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createSession(db: Database, userId: string, now: number, ttlMs: number): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  ).run(tokenHash, userId, now, now + ttlMs, now)
  return { token, tokenHash }
}

export interface ResolvedSession {
  tokenHash: string
  user: Pick<UserRow, 'id' | 'email' | 'created_at'>
  /** The expiry was pushed forward: the cookie should be sent again with a fresh Max-Age. */
  renewed: boolean
}

/** The live session for a cookie value, renewing it when due. Expired sessions are deleted. */
export function resolveSession(db: Database, token: string, now: number, ttlMs: number): ResolvedSession | null {
  if (!TOKEN_RE.test(token)) return null
  const tokenHash = hashToken(token)
  const row = db
    .prepare<[string], SessionRow & { email: string; user_created_at: number }>(
      `SELECT s.*, u.email, u.created_at AS user_created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash)
  if (!row) return null
  if (row.expires_at <= now) {
    deleteSession(db, tokenHash)
    return null
  }
  const renewed = now - row.last_seen_at > SESSION_REFRESH_MS
  if (renewed) {
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(now, now + ttlMs, tokenHash)
  }
  return { tokenHash, user: { id: row.user_id, email: row.email, created_at: row.user_created_at }, renewed }
}

export function deleteSession(db: Database, tokenHash: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
}

/** Ends every session of the user except `keepTokenHash`; returns how many were ended. */
export function deleteUserSessions(db: Database, userId: string, keepTokenHash?: string): number {
  return db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?').run(userId, keepTokenHash ?? null).changes
}

export function purgeExpiredSessions(db: Database, now: number): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes
}
