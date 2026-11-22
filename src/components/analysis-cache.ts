/**
 * `byKey` with the `keep` entry and at most `limit` others, the most recently added (insertion
 * order), so a cache of analyses grows no further however often a slider moves.
 */
export function boundCache<T>(byKey: Record<string, T>, keep: string, limit: number): Record<string, T> {
  const others = Object.keys(byKey).filter((key) => key !== keep)
  if (others.length <= limit) return byKey
  const kept: Record<string, T> = {}
  if (keep in byKey) kept[keep] = byKey[keep]
  for (const key of others.slice(-limit)) kept[key] = byKey[key]
  return kept
}
