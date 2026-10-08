import { isIP } from 'node:net'

// SPEC §9.5: every setting comes from the environment and is validated once, at boot.

export type NodeEnv = 'development' | 'production' | 'test'
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
/** What Fastify's `trustProxy` accepts: off, every hop, a hop count, or trusted addresses/CIDRs. */
export type TrustProxy = boolean | number | string[]

export interface Config {
  nodeEnv: NodeEnv
  host: string
  port: number
  databasePath: string
  /** Scheme + host + port, no trailing slash: the exact value browsers send in `Origin`. */
  publicOrigin: string
  allowSignup: boolean
  cookieSecure: boolean
  trustProxy: TrustProxy
  sessionTtlDays: number
  maxPatternsPerUser: number
  staticDir: string
  logLevel: LogLevel
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'production', 'test']
const LOG_LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']
const DEV_ORIGIN = 'http://localhost:5173'

class Invalid {
  constructor(readonly reason: string) {}
}

type Env = Record<string, string | undefined>

/** Reads and validates the configuration; throws one Error that lists every invalid variable. */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = []
  // An empty value (common in env files) means "use the default".
  const raw = (name: string): string | undefined => {
    const v = env[name]?.trim()
    return v === undefined || v === '' ? undefined : v
  }
  function read<T>(name: string, fallback: T, parse: (v: string) => T | Invalid): T {
    const v = raw(name)
    if (v === undefined) return fallback
    const result = parse(v)
    if (result instanceof Invalid) {
      problems.push(`${name}: ${result.reason} (got ${JSON.stringify(v)})`)
      return fallback
    }
    return result
  }

  const nodeEnv = read('NODE_ENV', 'development', oneOf(NODE_ENVS))
  const production = nodeEnv === 'production'

  let publicOrigin = read('PUBLIC_ORIGIN', DEV_ORIGIN, parseOrigin)
  if (production && raw('PUBLIC_ORIGIN') === undefined) {
    problems.push('PUBLIC_ORIGIN: required when NODE_ENV=production (e.g. https://mosaic.example.com)')
    publicOrigin = ''
  }

  const config: Config = {
    nodeEnv,
    host: raw('HOST') ?? '127.0.0.1',
    port: read('PORT', 3000, integerIn(1, 65535)),
    databasePath: raw('DATABASE_PATH') ?? './data/mosaic.db',
    publicOrigin,
    allowSignup: read('ALLOW_SIGNUP', false, boolean),
    cookieSecure: read('COOKIE_SECURE', production, boolean),
    trustProxy: read('TRUST_PROXY', false, parseTrustProxy),
    sessionTtlDays: read('SESSION_TTL_DAYS', 30, integerIn(1, 3650)),
    maxPatternsPerUser: read('MAX_PATTERNS_PER_USER', 500, integerIn(1, 1_000_000)),
    staticDir: raw('STATIC_DIR') ?? './dist',
    logLevel: read('LOG_LEVEL', 'info', oneOf(LOG_LEVELS)),
  }
  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  }
  return config
}

function oneOf<T extends string>(values: readonly T[]) {
  return (v: string): T | Invalid =>
    (values as readonly string[]).includes(v) ? (v as T) : new Invalid(`must be one of ${values.join(', ')}`)
}

function integerIn(min: number, max: number) {
  return (v: string): number | Invalid => {
    const n = /^\d+$/.test(v) ? Number(v) : NaN
    return n >= min && n <= max ? n : new Invalid(`must be an integer from ${min} to ${max}`)
  }
}

function boolean(v: string): boolean | Invalid {
  if (v === 'true' || v === '1') return true
  if (v === 'false' || v === '0') return false
  return new Invalid('must be true, false, 1 or 0')
}

function parseTrustProxy(v: string): TrustProxy | Invalid {
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^\d+$/.test(v)) {
    const hops = Number(v)
    return hops <= 100 ? hops : new Invalid('hop count must be at most 100')
  }
  const entries = v.split(',').map((s) => s.trim())
  const bad = entries.filter((e) => !isAddressOrCidr(e))
  if (bad.length > 0) {
    return new Invalid(`must be true, false, a hop count, or a comma-separated list of IPs/CIDRs (invalid: ${bad.join(', ')})`)
  }
  return entries
}

function isAddressOrCidr(entry: string): boolean {
  const [address, prefix, ...rest] = entry.split('/')
  const family = isIP(address)
  if (family === 0 || rest.length > 0) return false
  if (prefix === undefined) return true
  return /^\d+$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128)
}

function parseOrigin(v: string): string | Invalid {
  const invalid = new Invalid('must be an http(s) origin without a path, like https://mosaic.example.com')
  let url: URL
  try {
    url = new URL(v)
  } catch {
    return invalid
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return invalid
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return invalid
  return url.origin
}
