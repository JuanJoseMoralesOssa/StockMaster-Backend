/**
 * The domain's weight precision rule, in one place.
 *
 * Weights here carry three decimals: the stored columns are `numeric(14,3)`
 * (kilograms with gram precision), and intermediate figures are rounded the
 * same way so a displayed total always matches the sum of what was persisted.
 * The rule is about PRECISION, not units — the form-extraction normalizer
 * applies it to a pounds subtotal before converting, which is why this is not
 * named `…Kg`.
 *
 * It lives in `domain/` rather than inside any one module because three of them
 * must agree on it exactly: the transaction write path (balances and Kardex
 * movements), the analytics reports, and the form-extraction normalizer. While
 * each carried its own copy, "3 decimals" was a rule stated three times and
 * enforced nowhere.
 */
export function roundWeight(n: number): number {
  return Math.round(n * 1000) / 1000
}
