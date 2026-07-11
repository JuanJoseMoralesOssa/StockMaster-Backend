import { BalanceMutationMode } from './transaction-type.const'
import { DetailBase } from './transaction.types'
import { roundWeight } from '../../domain/weight'

export interface BalanceDelta {
  productId: number
  weightKg: number
  mode: BalanceMutationMode
}

type DetailWeight = Pick<DetailBase, 'productId' | 'weight_kg'>

/**
 * Pure planner for a detail-line balance change. Given the old and new
 * (product, weight), it returns the ordered list of balance movements to apply:
 *
 *  - different product → undo the whole old weight, apply the whole new weight;
 *  - same product      → apply/undo only the signed magnitude of the change;
 *  - no net change     → no movements at all.
 *
 * Side-effect free (no DB, no tx) so the branch decisions — product switch,
 * increase/decrease sign, the zero-diff no-op short-circuit, and the rounding
 * boundary — are unit-testable in isolation (audit Finding M7).
 * BalanceReconciliationService.applyDetailBalanceDelta is the thin executor that
 * runs these against the DB.
 */
export function computeBalanceDeltas(
  oldDetail: DetailWeight,
  newDetail: DetailWeight,
): BalanceDelta[] {
  const newWeight = roundWeight(newDetail.weight_kg)

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

  const diff = roundWeight(newWeight - oldDetail.weight_kg)
  if (diff === 0) return []
  return [
    {
      productId: newDetail.productId,
      weightKg: Math.abs(diff),
      mode: diff > 0 ? 'apply' : 'undo',
    },
  ]
}
