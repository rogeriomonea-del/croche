import { describe, expect, it } from 'vitest'
import { cellYarn, cellsOf, conflicts, deriveX, fromDocument, instructions, parseDocument, toDocument } from '../core'
import { CROCHET_TEMPLATES, createTemplateDesign, TEMPLATE_CATEGORIES } from './templates'

describe('Crochet Victorioso template collection', () => {
  it('contains twenty distinct named designs rather than color variants', () => {
    expect(CROCHET_TEMPLATES).toHaveLength(20)
    expect(new Set(CROCHET_TEMPLATES.map((item) => item.id)).size).toBe(20)
    expect(new Set(CROCHET_TEMPLATES.map((item) => item.name)).size).toBe(20)
    expect(new Set(CROCHET_TEMPLATES.map((item) => JSON.stringify(item.design.delta))).size).toBe(20)
    for (const category of TEMPLATE_CATEGORIES) expect(CROCHET_TEMPLATES.filter((item) => item.category === category)).toHaveLength(5)
  })

  it.each(CROCHET_TEMPLATES)('$name is a valid document with executable conflict-free instructions', ({ id }) => {
    const design = createTemplateDesign(id)
    const rows = design.delta.length, cols = design.delta[0].length
    expect(rows).toBeGreaterThanOrEqual(5)
    expect(rows).toBeLessThanOrEqual(119)
    expect(rows % 2).toBe(1)
    expect(cols).toBeGreaterThanOrEqual(5)
    expect(cols).toBeLessThanOrEqual(120)
    expect(design.delta.every((row) => row.length === cols && row.every((value) => typeof value === 'boolean'))).toBe(true)
    expect(design.delta[0].some(Boolean)).toBe(false)
    expect(design.delta[rows - 1].some(Boolean)).toBe(false)
    expect(cellsOf(design.delta).length).toBeGreaterThan(0)
    const chart = deriveX(design.delta)
    expect(cellsOf(conflicts(chart))).toEqual([])
    expect(instructions(chart)).toHaveLength(rows)
    expect(instructions(chart).some((line) => line.includes('dc'))).toBe(true)
    const parsed = parseDocument(JSON.parse(JSON.stringify(toDocument(design))))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(fromDocument(parsed.document)).toEqual(design)
    const yarns = new Set(design.delta.flatMap((row, i) => row.map((_, j) => cellYarn(design.delta, i + 1, j + 1))))
    expect(yarns).toEqual(new Set(['main', 'pattern']))
  })

  it('provides fresh matrices and palettes on every use', () => {
    const id = CROCHET_TEMPLATES[0].id
    const first = createTemplateDesign(id), second = createTemplateDesign(id)
    first.delta[1][0] = !first.delta[1][0]
    first.colors.main = '#ffffff'
    expect(second).toEqual(CROCHET_TEMPLATES[0].design)
    expect(first.delta).not.toEqual(second.delta)
    expect(first.colors).not.toEqual(second.colors)
  })

  it('rejects unknown template identifiers', () => {
    expect(() => createTemplateDesign('missing')).toThrow('Modelo desconhecido')
  })
})
