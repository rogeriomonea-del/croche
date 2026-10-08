import { buildApp } from './app'
import { loadConfig, type Config } from './config'
import { openDatabase } from './db'

const SHUTDOWN_TIMEOUT_MS = 10_000

let config: Config
try {
  config = loadConfig()
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}

const db = openDatabase(config.databasePath)
const app = await buildApp({ config, db })

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  app.log.info({ signal }, 'shutting down')
  // In-flight requests get a bounded grace period; a hung one must not keep the process alive.
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref()
  try {
    await app.close()
  } finally {
    db.close()
  }
  process.exit(0)
}
process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))

try {
  await app.listen({ host: config.host, port: config.port })
} catch (err) {
  app.log.fatal({ err }, 'could not start listening')
  db.close()
  process.exit(1)
}
