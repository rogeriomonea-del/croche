import { runCli } from './admin'

// Entry point only; the commands live in admin.ts so tests can call them.
// The database and its backups hold password hashes: owner-only, whatever umask we started with.
process.umask(0o077)
process.exitCode = await runCli(process.argv.slice(2), {
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
})
