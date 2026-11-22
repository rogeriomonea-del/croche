import { at, type Matrix } from './grid'

export type Yarn = 'main' | 'pattern'

/** Toolbar and chart name the yarns A (main) and B (pattern). */
export const YARN_LABEL: Record<Yarn, 'A' | 'B'> = { main: 'A', pattern: 'B' }

/** SPEC §3.1: odd rows are worked in `main`, even rows in `pattern`. */
export function stripe(r: number): Yarn {
  return r % 2 === 1 ? 'main' : 'pattern'
}

export function otherYarn(y: Yarn): Yarn {
  return y === 'main' ? 'pattern' : 'main'
}

/** Visible yarn at (r, c): the row's stripe, unless the cell deviates from it (SPEC §3.2). */
export function cellYarn(delta: Matrix, r: number, c: number): Yarn {
  return at(delta, r, c) ? otherYarn(stripe(r)) : stripe(r)
}
