import { describe, expect, it } from 'vitest'
import { fileSlug } from './filename'

describe('fileSlug', () => {
  it.each([
    ['Losangos', 'losangos'],
    ['  Ondas do Mar #2 ', 'ondas-do-mar-2'],
    ['Coração & Ação', 'coracao-acao'],
    ['---', 'pattern'],
    ['🧶', 'pattern'],
    ['a'.repeat(59) + ' b', 'a'.repeat(59)],
  ])('%j → %j', (name, slug) => {
    expect(fileSlug(name)).toBe(slug)
  })
})
