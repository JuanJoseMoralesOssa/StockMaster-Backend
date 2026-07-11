import { TransactionKind } from './transaction-kind.enum'
import { TRANSACTION_TYPE_LABEL } from './transaction-type.const'

// Structural (not model-class) bounds, mirroring transaction-diff.utils.ts:
// these functions only ever touch `weight_kg` and the parent's `date`, so
// they stay decoupled from the Entity classes and are trivial to fake in
// unit tests with plain object literals.
type DetailWithPurchaseParent = {
  weight_kg: number
  purchase?: { date: string }
}

type DetailWithPaymentParent = {
  weight_kg: number
  payment?: { date: string }
}

/** Shared shape of a report row: when it happened, how much, and which kind of movement. */
export type TransactionRow<Extra> = {
  date: string
  weight_kg: number
  type: (typeof TRANSACTION_TYPE_LABEL)[TransactionKind]
} & Extra

/**
 * Maps loaded purchase-detail rows to report rows. Skips a detail whose
 * `purchase` relation wasn't included (nothing to date it by) and one whose
 * `weight_kg` is falsy — that includes 0, which is not a real movement to
 * report, matching the pre-refactor behavior this replaces.
 */
export function mapPurchaseDetailsToRows<
  D extends DetailWithPurchaseParent,
  Extra,
>(details: D[], toExtra: (detail: D) => Extra): Array<TransactionRow<Extra>> {
  const rows: Array<TransactionRow<Extra>> = []
  for (const detail of details) {
    if (!detail.purchase || !detail.weight_kg) continue
    rows.push({
      date: detail.purchase.date,
      weight_kg: detail.weight_kg,
      type: TRANSACTION_TYPE_LABEL[TransactionKind.PURCHASE],
      ...toExtra(detail),
    })
  }
  return rows
}

/** Payment-side counterpart of {@link mapPurchaseDetailsToRows}; same skip rules. */
export function mapPaymentDetailsToRows<
  D extends DetailWithPaymentParent,
  Extra,
>(details: D[], toExtra: (detail: D) => Extra): Array<TransactionRow<Extra>> {
  const rows: Array<TransactionRow<Extra>> = []
  for (const detail of details) {
    if (!detail.payment || !detail.weight_kg) continue
    rows.push({
      date: detail.payment.date,
      weight_kg: detail.weight_kg,
      type: TRANSACTION_TYPE_LABEL[TransactionKind.PAYMENT],
      ...toExtra(detail),
    })
  }
  return rows
}

/** Combines purchase and payment rows into a single chronologically ordered report. */
export function mergeTransactionRowsByDate<Extra>(
  purchaseRows: Array<TransactionRow<Extra>>,
  paymentRows: Array<TransactionRow<Extra>>,
): Array<TransactionRow<Extra>> {
  return [...purchaseRows, ...paymentRows].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  )
}
