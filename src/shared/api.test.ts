import { describe, expect, it } from 'vitest'
import { EMAIL_MAX, emailError, normalizeEmail, PASSWORD_MAX, PASSWORD_MIN, passwordError } from './api'

describe('normalizeEmail (SPEC §9.2)', () => {
  it.each([
    ['ro@example.com', 'ro@example.com'],
    ['  Ro@Example.COM  ', 'ro@example.com'],
    ['\tRO@EXAMPLE.COM\n', 'ro@example.com'],
    ['', ''],
  ])('%j → %j', (raw, normalized) => {
    expect(normalizeEmail(raw)).toBe(normalized)
  })
})

describe('emailError', () => {
  const domain = '@example.com'
  it.each([
    'ro@example.com',
    '  Ro@Example.com  ',
    'a.b+tag@sub.example.co',
    'x'.repeat(EMAIL_MAX - domain.length) + domain,
  ])('accepts %j', (email) => {
    expect(emailError(email)).toBeNull()
  })

  it.each([
    ['', 'Email is required'],
    ['   ', 'Email is required'],
    ['x'.repeat(EMAIL_MAX - domain.length + 1) + domain, 'Email must be at most 254 characters'],
    ['ro @example.com', 'Email must not contain spaces'],
    ['ro@exa mple.com', 'Email must not contain spaces'],
    ['ro\t@example.com', 'Email must not contain spaces'],
    ['ro x@example.com', 'Email must not contain spaces'],
    ['roexample.com', 'Email must have exactly one @ with text on both sides'],
    ['ro@@example.com', 'Email must have exactly one @ with text on both sides'],
    ['ro@a@example.com', 'Email must have exactly one @ with text on both sides'],
    ['@example.com', 'Email must have exactly one @ with text on both sides'],
    ['ro@', 'Email must have exactly one @ with text on both sides'],
    ['ro@localhost', 'Email domain must contain a dot'],
    ['\x1b[2j\x1b]0;pwned\x07evil@x.co', 'Email must not contain control characters'],
    ['ro\x00@example.com', 'Email must not contain control characters'],
    ['ro@example.com\x7f', 'Email must not contain control characters'],
    ['ro\x9b2j@example.com', 'Email must not contain control characters'],
  ])('rejects %j', (email, error) => {
    expect(emailError(email)).toBe(error)
  })
})

describe('passwordError (length only, in code points)', () => {
  const tooShort = `Password must be at least ${PASSWORD_MIN} characters`
  const tooLong = `Password must be at most ${PASSWORD_MAX} characters`
  it.each([
    ['9 characters', 'x'.repeat(9), tooShort],
    ['10 characters', 'x'.repeat(10), null],
    ['10 spaces (no composition rules)', ' '.repeat(10), null],
    ['256 characters', 'x'.repeat(256), null],
    ['257 characters', 'x'.repeat(257), tooLong],
    // 🧶 is two UTF-16 units: nine of them are 18 units but 9 characters.
    ['9 emoji', '🧶'.repeat(9), tooShort],
    ['10 emoji', '🧶'.repeat(10), null],
    ['256 emoji (512 units)', '🧶'.repeat(256), null],
    ['257 emoji', '🧶'.repeat(257), tooLong],
    ['accented letters', 'pão-de-ló!', null],
    ['10 MB', 'x'.repeat(10 * 1024 * 1024), tooLong],
  ])('%s', (_, password, error) => {
    expect(passwordError(password)).toBe(error)
  })
})
