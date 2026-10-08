import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const tsx = join(root, 'node_modules', '.bin', 'tsx')

it('creates the database and its backups owner-only, even under umask 022', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mosaic-umask-'))
  try {
    const env = { PATH: process.env.PATH, DATABASE_PATH: join(dir, 'data', 'mosaic.db') }
    const backup = join(dir, 'data', 'backups', 'b.db')
    execFileSync('sh', ['-c', 'umask 022 && exec "$0" server/cli.ts db:backup "$1"', tsx, backup], { cwd: root, env })
    for (const path of ['data', 'data/mosaic.db', 'data/backups', 'data/backups/b.db']) {
      expect(statSync(join(dir, path)).mode & 0o077, path).toBe(0)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 30_000)
