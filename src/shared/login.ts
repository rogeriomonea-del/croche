import { emailError, normalizeEmail } from './api'

/** Admin-assigned names are separate from e-mail addresses and never contain @. */
export const LOGIN_ALIAS_MAX = 80

export function normalizeDisplayName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

function normalizeAliasKey(displayName: string): string {
  // Lowercasing can itself produce a composable sequence (e.g. J + caron → j + caron).
  // Keep the result canonical so client + server normalization is idempotent.
  return displayName.toLowerCase().normalize('NFC')
}

export function loginAliasError(raw: string): string | null {
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return 'Login name must not contain control characters'
  const name = normalizeDisplayName(raw)
  const length = [...name].length
  const normalizedLength = [...normalizeAliasKey(name)].length
  if (length < 3 || normalizedLength < 3) return 'Login name must be at least 3 characters in its displayed and normalized forms'
  // Some capitals expand when lowercased (İ → i + combining dot). A valid assigned name must
  // remain valid when the client sends its normalized key through the same validator.
  if (length > LOGIN_ALIAS_MAX || normalizedLength > LOGIN_ALIAS_MAX) {
    return `Login name must be at most ${LOGIN_ALIAS_MAX} characters in its displayed and normalized forms`
  }
  if (!/^[\p{L}\p{M}\p{N} ._'’\-]+$/u.test(name)) return 'Login name may contain letters, numbers, spaces, periods, apostrophes, underscores and hyphens'
  if (!/[\p{L}\p{N}]/u.test(name)) return 'Login name must contain a letter or number'
  return null
}

/** The legacy `email` login field accepts either this name or an unchanged e-mail address. */
export function normalizeLoginIdentifier(raw: string): string {
  return raw.includes('@') ? normalizeEmail(raw) : normalizeAliasKey(normalizeDisplayName(raw))
}

export function loginIdentifierError(raw: string): string | null {
  if (raw.trim() === '') return 'Login name or email is required'
  return raw.includes('@') ? emailError(raw) : loginAliasError(raw)
}
