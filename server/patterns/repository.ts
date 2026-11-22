import { randomUUID } from 'node:crypto'
import type { PatternDocument } from '../../src/core/document'
import type { Pattern, PatternSummary } from '../../src/shared/api'
import type { Database } from '../db'

// Every query is scoped by owner_id: another user's pattern is indistinguishable from a missing one.

export interface PatternRow {
  id: string
  owner_id: string
  name: string
  rows: number
  cols: number
  /** Canonical PatternDocument JSON, as returned by parseDocument. */
  document: string
  revision: number
  created_at: number
  updated_at: number
}

type SummaryRow = Omit<PatternRow, 'owner_id' | 'document'> & { color_a: string; color_b: string }

export class PatternQuotaError extends Error {
  constructor(readonly max: number) {
    super(`The user already has ${max} patterns`)
    this.name = 'PatternQuotaError'
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

function toSummary(row: Omit<PatternRow, 'owner_id' | 'document'>, colors: { A: string; B: string }): PatternSummary {
  return {
    id: row.id,
    name: row.name,
    rows: row.rows,
    cols: row.cols,
    colors: { A: colors.A, B: colors.B },
    revision: row.revision,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

export function toPattern(row: PatternRow): Pattern {
  const document = JSON.parse(row.document) as PatternDocument
  return { ...toSummary(row, document.colors), document }
}

/** Most recently updated first. */
export function listPatterns(db: Database, ownerId: string): PatternSummary[] {
  // Colors come out of the JSON in SQLite, so listing never parses every pattern's cells.
  const rows = db
    .prepare<[string], SummaryRow>(
      `SELECT id, name, rows, cols, revision, created_at, updated_at,
         json_extract(document, '$.colors.A') AS color_a, json_extract(document, '$.colors.B') AS color_b
       FROM patterns WHERE owner_id = ?
       ORDER BY updated_at DESC, created_at DESC, id`,
    )
    .all(ownerId)
  return rows.map((row) => toSummary(row, { A: row.color_a, B: row.color_b }))
}

export function findPattern(db: Database, ownerId: string, id: string): PatternRow | undefined {
  return db.prepare<[string, string], PatternRow>('SELECT * FROM patterns WHERE id = ? AND owner_id = ?').get(id, ownerId)
}

/** `document` must be canonical (from parseDocument). Throws PatternQuotaError at `maxPatterns`. */
export function createPattern(db: Database, ownerId: string, document: PatternDocument, now: number, maxPatterns: number): PatternRow {
  const row: PatternRow = {
    id: randomUUID(),
    owner_id: ownerId,
    name: document.name,
    rows: document.rows,
    cols: document.cols,
    document: JSON.stringify(document),
    revision: 1,
    created_at: now,
    updated_at: now,
  }
  // IMMEDIATE takes the write lock before counting, so a second process (the CLI) cannot slip an
  // insert in between the count and this one.
  db.transaction(() => {
    const { n } = db.prepare<[string], { n: number }>('SELECT count(*) AS n FROM patterns WHERE owner_id = ?').get(ownerId)!
    if (n >= maxPatterns) throw new PatternQuotaError(maxPatterns)
    db.prepare(
      `INSERT INTO patterns (id, owner_id, name, rows, cols, document, revision, created_at, updated_at)
       VALUES (@id, @owner_id, @name, @rows, @cols, @document, @revision, @created_at, @updated_at)`,
    ).run(row)
  }).immediate()
  return row
}

export type UpdateResult = { ok: true; row: PatternRow } | { ok: false; current: PatternRow | undefined }

/**
 * Replaces the document only if the stored revision is still `revision` (optimistic concurrency).
 * On failure `current` is the stored pattern, or undefined when the user has no such pattern.
 */
export function updatePattern(
  db: Database,
  ownerId: string,
  id: string,
  revision: number,
  document: PatternDocument,
  now: number,
): UpdateResult {
  return db.transaction((): UpdateResult => {
    const row = db
      .prepare<[Record<string, unknown>], PatternRow>(
        `UPDATE patterns
         SET name = @name, rows = @rows, cols = @cols, document = @document, revision = revision + 1, updated_at = @now
         WHERE id = @id AND owner_id = @ownerId AND revision = @revision
         RETURNING *`,
      )
      .get({
        id,
        ownerId,
        revision,
        now,
        name: document.name,
        rows: document.rows,
        cols: document.cols,
        document: JSON.stringify(document),
      })
    return row ? { ok: true, row } : { ok: false, current: findPattern(db, ownerId, id) }
  })()
}

export function deletePattern(db: Database, ownerId: string, id: string): boolean {
  return db.prepare('DELETE FROM patterns WHERE id = ? AND owner_id = ?').run(id, ownerId).changes > 0
}
