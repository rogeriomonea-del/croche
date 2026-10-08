import { randomBytes } from 'node:crypto'
import { hash, verify, type Algorithm, type Options } from '@node-rs/argon2'

// SPEC §9.2 / OWASP: argon2id, 19 MiB, 2 passes, 1 lane. Algorithm is an ambient const enum,
// which isolated modules cannot read, so its value (Argon2id = 2) is spelled out.
const ARGON2_OPTIONS: Options = {
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS)
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    // A malformed stored hash must read as a failed login, not a 500 that tells the two apart.
    return false
  }
}

let dummyHash: Promise<string> | undefined

/** A hash of a random secret, so logins for unknown e-mails cost the same as real ones. */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url'))
  return dummyHash
}
