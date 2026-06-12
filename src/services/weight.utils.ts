/** Rounds a weight to 3 decimal places (kg precision we persist). */
export function roundWeightKg(n: number): number {
  return Math.round(n * 1000) / 1000
}
