import { canToggle } from './toggle'

export type View = 'simulation' | 'schematic'
export type BlockedReason = 'base-row' | 'top-row' | 'no-anchor'
export type ClickTarget = { ok: true; r: number; c: number } | { ok: false; reason: BlockedReason }

/**
 * Maps a click on the visible grid to the one deviation cell it toggles.
 * - simulation: the clicked cell itself swaps colour (SPEC §3.2).
 * - schematic: the click places or removes the dc (X) at (r, c). That dc drops into row r-2 and
 *   covers (r-1, c), so it is the deviation at (r-1, c): §3.3 read backwards.
 * Both views go through canToggle, so they lock exactly the same physical stitches.
 */
export function resolveClick(view: View, r: number, c: number, rows: number): ClickTarget {
  const target = view === 'schematic' ? r - 1 : r
  if (canToggle(target, rows)) return { ok: true, r: target, c }
  if (view === 'schematic') return { ok: false, reason: 'no-anchor' }
  return { ok: false, reason: r === 1 ? 'base-row' : 'top-row' }
}
