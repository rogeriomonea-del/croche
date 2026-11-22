// HTTP contract of the backend (SPEC §9.4): types and pure validators shared by the SPA and the
// server. No runtime dependencies, so it loads unchanged in the browser and in Node.
import type { PatternDocument } from '../core/document'

export const EMAIL_MAX = 254
export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 256

export type ApiErrorCode =
  | 'invalid_input'
  | 'invalid_document'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'signup_disabled'
  | 'email_taken'
  | 'not_found'
  | 'revision_conflict'
  | 'pattern_quota_exceeded'
  | 'bad_origin'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'rate_limited'
  | 'internal'

/**
 * Every error response. `details` depends on the code: `invalid_input` → InvalidInputDetails,
 * `invalid_document` → InvalidDocumentDetails, `revision_conflict` → RevisionConflictDetails.
 */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown }
}

/** Field name → what is wrong with it. */
export interface InvalidInputDetails {
  fields: Record<string, string>
}

/** The path-naming errors of `parseDocument`. */
export interface InvalidDocumentDetails {
  errors: string[]
}

export interface User {
  id: string
  email: string
  /** Optional admin-assigned login name; existing accounts omit this field. */
  displayName?: string
  createdAt: string
}

export interface AuthConfig {
  signupEnabled: boolean
}

export interface Credentials {
  /** E-mail for signup; e-mail or an admin-assigned login name for login. */
  email: string
  password: string
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

export interface DeleteAccountRequest {
  password: string
}

export interface PatternSummary {
  id: string
  name: string
  rows: number
  cols: number
  colors: { A: string; B: string }
  revision: number
  createdAt: string
  updatedAt: string
}

export interface Pattern extends PatternSummary {
  document: PatternDocument
}

export interface CreatePatternRequest {
  document: PatternDocument
}

export interface UpdatePatternRequest {
  revision: number
  document: PatternDocument
}

/** The stored pattern, so the client can show what it lost the race to. */
export interface RevisionConflictDetails {
  current: Pattern
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** SPEC §9.2 rules only, checked on the normalized value. */
export function emailError(email: string): string | null {
  const e = normalizeEmail(email)
  if (e.length === 0) return 'Email is required'
  if (e.length > EMAIL_MAX) return `Email must be at most ${EMAIL_MAX} characters`
  if (/\s/.test(e)) return 'Email must not contain spaces'
  // ESC, BEL and the like would reach the operator's terminal through the CLI's user listing.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(e)) return 'Email must not contain control characters'
  const parts = e.split('@')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return 'Email must have exactly one @ with text on both sides'
  if (!parts[1].includes('.')) return 'Email domain must contain a dot'
  return null
}

/** SPEC §9.2 (NIST 800-63B): length only, counted in code points so an emoji is one character. */
export function passwordError(password: string): string | null {
  // A code point is at most two UTF-16 units, so a longer string is too long without spreading it.
  const length = password.length > 2 * PASSWORD_MAX ? Infinity : [...password].length
  if (length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`
  if (length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters`
  return null
}
