import { StockMutationMode } from './transaction-type.const'
import { DetailBase } from './transaction.types'
import { roundWeightKg } from './weight.utils'

export interface StockDelta {
  productId: number
  weightKg: number
  mode: StockMutationMode
}

type DetailWeight = Pick<DetailBase, 'productId' | 'weight_kg'>

/**
 * Pure planner for a detail-line stock change. Given the old and new
 * (product, weight), it returns the ordered list of stock movements to apply:
 *
 *  - different product → undo the whole old weight, apply the whole new weight;
 *  - same product      → apply/undo only the signed magnitude of the change;
 *  - no net change     → no movements at all.
 *
 * Side-effect free (no DB, no tx) so the branch decisions — product switch,
 * increase/decrease sign, the zero-diff no-op short-circuit, and the rounding
 * boundary — are unit-testable in isolation (audit Finding M7).
 * StockReconciliationService.applyDetailStockDelta is the thin executor that
 * runs these against the DB.
 */
export function computeStockDeltas(
  oldDetail: DetailWeight,
  newDetail: DetailWeight,
): StockDelta[] {
  const newWeight = roundWeightKg(newDetail.weight_kg)

  if (oldDetail.productId !== newDetail.productId) {
    return [
      {
        productId: oldDetail.productId,
        weightKg: oldDetail.weight_kg,
        mode: 'undo',
      },
      { productId: newDetail.productId, weightKg: newWeight, mode: 'apply' },
    ]
  }

  const diff = roundWeightKg(newWeight - oldDetail.weight_kg)
  if (diff === 0) return []
  return [
    {
      productId: newDetail.productId,
      weightKg: Math.abs(diff),
      mode: diff > 0 ? 'apply' : 'undo',
    },
  ]
}
