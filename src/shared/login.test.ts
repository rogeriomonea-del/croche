import { describe, expect, it } from 'vitest'
import { loginAliasError, loginIdentifierError, normalizeDisplayName, normalizeLoginIdentifier } from './login'

describe('login identifiers', () => {
  it('keeps the existing e-mail normalization and validation', () => {
    expect(normalizeLoginIdentifier('  RO@Example.COM ')).toBe('ro@example.com')
    expect(loginIdentifierError('  RO@Example.COM ')).toBeNull()
    expect(loginIdentifierError('ro@localhost')).toBe('Email domain must contain a dot')
  })

  it('normalizes alias case, repeated spaces and canonically equivalent Unicode', () => {
    expect(normalizeDisplayName('  Jose\u0301   dos\u00a0Fios  ')).toBe('José dos Fios')
    expect(normalizeLoginIdentifier('  JOSE\u0301   DOS FIOS  ')).toBe('josé dos fios')
    expect(loginIdentifierError('  JOSE\u0301   DOS FIOS  ')).toBeNull()
  })

  it('stays idempotent when lowercasing creates a canonically composable sequence', () => {
    const key = normalizeLoginIdentifier('J\u030cana Fios')
    expect(key).toBe('ǰana fios')
    expect(normalizeLoginIdentifier(key)).toBe(key)
    expect(loginIdentifierError(key)).toBeNull()
  })

  it('applies the maximum to both display names and expanded normalized keys', () => {
    expect(loginAliasError('İ'.repeat(40))).toBeNull()
    expect(loginIdentifierError(normalizeLoginIdentifier('İ'.repeat(40)))).toBeNull()
    expect(loginAliasError('İ'.repeat(41))).toMatch(/displayed and normalized/)
    expect(loginAliasError('İ'.repeat(80))).toMatch(/displayed and normalized/)
    expect(loginAliasError('J\u030c'.repeat(41))).toMatch(/displayed and normalized/)
  })

  it('requires three characters even when normalizing composes two display characters', () => {
    expect(loginAliasError('J\u030ca')).toMatch(/at least 3/)
    expect(loginAliasError('J\u030cana')).toBeNull()
  })

  it.each(['Artista dos Fios', 'Ana-Maria', 'João D’Ávila', 'crochet_42', 'a'.repeat(80)])('accepts alias %j', (alias) => {
    expect(loginAliasError(alias)).toBeNull()
  })

  it.each(['ab', 'a'.repeat(81), '... --', 'user@example.com', 'artist\nname', '\x1b[2jartist', 'artist\u200ename', '<artist>'])('rejects alias %j', (alias) => {
    expect(loginAliasError(alias)).not.toBeNull()
  })

  it('requires a login identifier', () => {
    expect(loginIdentifierError('   ')).toBe('Login name or email is required')
  })
})
