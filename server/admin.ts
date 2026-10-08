import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { emailError, normalizeEmail, passwordError } from '../src/shared/api'
import { hashPassword } from './auth/passwords'
import { deleteUserSessions } from './auth/sessions'
import { assignLoginAlias, deleteUser, findUserByEmail, insertUser, listUsers, updatePasswordHash, type UserRow } from './auth/users'
import { loadConfig } from './config'
import { migrate, openDatabase, type Database } from './db'

// Operator commands behind server/cli.ts. Accounts can be created here even with ALLOW_SIGNUP=false
// (SPEC §9.2). Everything prints plain text; failures throw CliError and exit 1.

export class CliError extends Error {}

export async function createUser(db: Database, rawEmail: string, password: string, now = Date.now()): Promise<UserRow> {
  const email = normalizeEmail(rawEmail)
  assertValidEmail(email)
  if (findUserByEmail(db, email)) throw new CliError(`A user with e-mail ${email} already exists`)
  assertValidPassword(password)
  return insertUser(db, email, await hashPassword(password), now)
}

/** Sets a new password and ends every session of that user. Returns how many sessions ended. */
export async function setUserPassword(db: Database, rawEmail: string, password: string, now = Date.now()): Promise<number> {
  const user = requireUser(db, rawEmail)
  assertValidPassword(password)
  const passwordHash = await hashPassword(password)
  return db.transaction(() => {
    updatePasswordHash(db, user.id, passwordHash, now)
    return deleteUserSessions(db, user.id)
  })()
}

/** Removes the user with their sessions and patterns. */
export function removeUser(db: Database, rawEmail: string): UserRow {
  const user = requireUser(db, rawEmail)
  deleteUser(db, user.id)
  return user
}

/** Adds a friendly login name to an existing account. The e-mail remains a valid login. */
export function setUserAlias(db: Database, rawEmail: string, displayName: string): string {
  return assignLoginAlias(db, requireUser(db, rawEmail).id, displayName)
}

export function formatUserList(db: Database): string {
  const users = listUsers(db)
  if (users.length === 0) return 'No users\n'
  const rows = [
    ['EMAIL', 'CREATED', 'SESSIONS', 'PATTERNS', 'ID'],
    ...users.map((u) => [printable(u.email), new Date(u.created_at).toISOString(), String(u.sessions), String(u.patterns), u.id]),
  ]
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)))
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd()).join('\n') + '\n'
}

// Addresses stored before emailError rejected control characters must not drive the terminal.
function printable(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

/** Consistent copy of a live database (SQLite online backup), safe while the server runs. */
export async function backupDatabase(db: Database, dest: string): Promise<void> {
  if (existsSync(dest)) throw new CliError(`${dest} already exists; choose a new file name`)
  mkdirSync(dirname(dest), { recursive: true })
  await db.backup(dest)
}

function requireUser(db: Database, rawEmail: string): UserRow {
  const email = normalizeEmail(rawEmail)
  const user = findUserByEmail(db, email)
  if (!user) throw new CliError(`No user with e-mail ${email}`)
  return user
}

function assertValidEmail(email: string) {
  const problem = emailError(email)
  if (problem) throw new CliError(problem)
}

function assertValidPassword(password: string) {
  const problem = passwordError(password)
  if (problem) throw new CliError(problem)
}

// ---------------------------------------------------------------------------------------------
// Command line

interface Input extends NodeJS.ReadableStream {
  isTTY?: boolean
  setRawMode?: (mode: boolean) => unknown
}

export interface CliDeps {
  env: Record<string, string | undefined>
  stdin: Input
  stdout: { write(text: string): unknown }
  stderr: { write(text: string): unknown }
}

export const USAGE = `Usage: mosaic-cli <command>

  user:create <email> [--password-stdin]        create an account (works with ALLOW_SIGNUP=false)
  user:set-password <email> [--password-stdin]  set a new password and end that user's sessions
  user:alias <email> "<login name>"             assign or replace a unique login name
  user:delete <email>                           delete the account, its sessions and patterns
  user:list                                     list accounts
  db:backup <dest-file>                         write a consistent copy of the database
  db:migrate                                    apply pending schema migrations

Without --password-stdin the password is prompted for twice on the terminal.
With it, stdin holds the password as a single line.
`

/** Runs one command; resolves to the process exit code. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv
  const passwordStdin = rest.includes('--password-stdin')
  const args = rest.filter((a) => a !== '--password-stdin')
  if (command === undefined) {
    deps.stderr.write(USAGE)
    return 1
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    deps.stdout.write(USAGE)
    return 0
  }
  const arity: Record<string, number> = {
    'user:create': 1,
    'user:set-password': 1,
    'user:alias': 2,
    'user:delete': 1,
    'user:list': 0,
    'db:backup': 1,
    'db:migrate': 0,
  }
  if (!(command in arity)) {
    deps.stderr.write(`Unknown command: ${command}\n\n${USAGE}`)
    return 1
  }
  const takesPassword = command === 'user:create' || command === 'user:set-password'
  if (args.length !== arity[command] || (passwordStdin && !takesPassword)) {
    deps.stderr.write(`Wrong arguments for ${command}\n\n${USAGE}`)
    return 1
  }
  if (takesPassword && !passwordStdin && !canPrompt(deps.stdin)) {
    deps.stderr.write(`Error: ${NOT_A_TTY}\n`)
    return 1
  }

  let db: Database | undefined
  try {
    const config = loadConfig(deps.env)
    db = openDatabase(config.databasePath, { migrate: command !== 'db:migrate' })
    const out = (line: string) => deps.stdout.write(`${line}\n`)
    const [arg] = args
    switch (command) {
      case 'user:create': {
        // Check the address before asking for a password that would be thrown away.
        const email = normalizeEmail(arg)
        assertValidEmail(email)
        if (findUserByEmail(db, email)) throw new CliError(`A user with e-mail ${email} already exists`)
        const user = await createUser(db, email, await readPassword(deps, passwordStdin))
        out(`Created user ${user.email} (${user.id})`)
        break
      }
      case 'user:set-password': {
        const email = requireUser(db, arg).email
        const ended = await setUserPassword(db, email, await readPassword(deps, passwordStdin))
        out(`Password updated for ${email}; ended ${ended} session(s)`)
        break
      }
      case 'user:delete':
        out(`Deleted user ${removeUser(db, arg).email}`)
        break
      case 'user:alias':
        out(`Login name set to ${setUserAlias(db, arg, args[1])} for ${normalizeEmail(arg)}`)
        break
      case 'user:list':
        deps.stdout.write(formatUserList(db))
        break
      case 'db:backup':
        await backupDatabase(db, arg)
        out(`Backup written to ${arg}`)
        break
      case 'db:migrate': {
        const { from, to } = migrate(db)
        out(from === to ? `Schema already at version ${to}` : `Schema migrated from version ${from} to ${to}`)
        break
      }
    }
    return 0
  } catch (err) {
    deps.stderr.write(`Error: ${(err as Error).message}\n`)
    return 1
  } finally {
    db?.close()
  }
}

async function readPassword(deps: CliDeps, fromStdin: boolean): Promise<string> {
  if (fromStdin) {
    const text = await readAll(deps.stdin)
    const password = text.replace(/\r?\n$/, '')
    if (/[\r\n]/.test(password)) throw new CliError('--password-stdin expects a single line')
    return password
  }
  if (!canPrompt(deps.stdin)) throw new CliError(NOT_A_TTY)
  const first = await promptHidden('Password: ', deps)
  assertValidPassword(first)
  const second = await promptHidden('Repeat password: ', deps)
  if (first !== second) throw new CliError('Passwords do not match')
  return first
}

const NOT_A_TTY = 'stdin is not a terminal; pipe the password in and pass --password-stdin'

function canPrompt(stdin: Input): boolean {
  return stdin.isTTY === true && typeof stdin.setRawMode === 'function'
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/** Reads one line from a TTY in raw mode, so the password is never echoed. */
function promptHidden(prompt: string, { stdin, stderr }: CliDeps): Promise<string> {
  return new Promise((resolve, reject) => {
    stderr.write(prompt)
    let value = ''
    const finish = (error: CliError | null) => {
      stdin.removeListener('data', onData)
      stdin.setRawMode!(false)
      stdin.pause()
      stderr.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const onData = (chunk: Buffer | string) => {
      for (const ch of chunk.toString()) {
        if (ch === '\r' || ch === '\n') return finish(null)
        if (ch === '\u0003') return finish(new CliError('Cancelled'))
        if (ch === '\u0004') return finish(value === '' ? new CliError('Cancelled') : null)
        if (ch === '\u007f' || ch === '\b') value = [...value].slice(0, -1).join('')
        else value += ch
      }
    }
    stdin.setRawMode!(true)
    stdin.on('data', onData)
    stdin.resume()
  })
}
