import { emptyMatrix, type DesignData } from '../core'

/** An optional starting study. Even-row deviations keep all double crochets on odd rows. */
export function wovenStudy(): DesignData {
  const delta = emptyMatrix(23, 30)
  for (let r = 2; r < 23; r += 2) {
    for (let c = 1; c <= 30; c++) {
      const distance = Math.abs(((c - 1) % 10) - 4.5)
      const band = Math.abs(((r / 2 - 1) % 10) - 4.5)
      delta[r - 1][c - 1] = Math.abs(distance - band) < 1.1 || distance + band < 2
    }
  }
  return { name: 'Woodland diamond study', delta, colors: { main: '#f3ead8', pattern: '#0f766e' } }
}
