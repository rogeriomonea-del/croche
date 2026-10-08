import { runCli } from './admin'

// Entry point only; the commands live in admin.ts so tests can call them.
process.exitCode = await runCli(process.argv.slice(2), {
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
})
