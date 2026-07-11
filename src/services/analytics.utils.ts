// Pure aggregation helpers behind the dashboard report. Extracted from
// AnalyticsService so the decisions they encode — how a detail line folds into a
// supplier/product aggregate, how in (compra) and out (pago) weight are kept
// apart, how a row is ranked — are unit-testable without six repositories and a
// live database. AnalyticsService keeps the I/O and delegates here.
//
// The value coercions these once carried now live in `domain/coercion.ts`,
// because the raw-SQL reader needs them too and a repository must not import
// from a service.

import { TransactionKind } from '../modules/transactions/transaction-kind.enum'
import { InventorySummaryResponse, LowBalanceProduct } from '../models'

export type RelatedEntity = {
  id?: number
  name?: string
}

/** Running per-entity totals, with purchase and payment sides kept separate. */
export type EntityAggregate = {
  id: number
  name: string
  purchaseWeight: number
  paymentWeight: number
  purchaseCount: number
  paymentCount: number
}

/**
 * Folds one detail line into the running aggregate for its related entity,
 * keeping purchase (entrada) and payment (salida) weight/count SEPARATE so the
 * dashboard never shows a single mixed in+out number in "both" mode.
 *
 * Lines whose related entity did not resolve (no relation, or no id) are
 * skipped: they cannot be attributed to a supplier or product, and inventing a
 * bucket for them would silently inflate the entity count.
 */
export function accumulateEntity(
  aggregates: Map<number, EntityAggregate>,
  related: RelatedEntity | undefined,
  weight: number,
  kind: TransactionKind,
  fallbackLabel: string,
): void {
  if (related?.id == null) return
  const id = related.id

  const isPurchase = kind === TransactionKind.PURCHASE
  const existing = aggregates.get(id)

  if (!existing) {
    aggregates.set(id, {
      id,
      name: related.name ?? `${fallbackLabel} ${id}`,
      purchaseWeight: isPurchase ? weight : 0,
      paymentWeight: isPurchase ? 0 : weight,
      purchaseCount: isPurchase ? 1 : 0,
      paymentCount: isPurchase ? 0 : 1,
    })
    return
  }

  if (isPurchase) {
    existing.purchaseWeight += weight
    existing.purchaseCount += 1
  } else {
    existing.paymentWeight += weight
    existing.paymentCount += 1
  }
}

/** Heaviest (`max`) or lightest (`min`) rows by combined weight. */
export function topByWeight<T extends { totalWeight: number }>(
  data: T[],
  mode: 'max' | 'min',
  limit: number,
): T[] {
  // Copy before sorting: the caller reuses the same array for the other ranking.
  return [...data]
    .sort((a, b) =>
      mode === 'max'
        ? b.totalWeight - a.totalWeight
        : a.totalWeight - b.totalWeight,
    )
    .slice(0, limit)
}

/**
 * Busiest rows by number of detail lines. Entities with no transactions are
 * dropped rather than listed with a count of 0 — "most active" with zero
 * activity is noise in the dashboard.
 */
export function topByTransactionCount<T extends { transactionCount: number }>(
  data: T[],
  limit: number,
): T[] {
  return data
    .filter(item => item.transactionCount > 0)
    .sort((a, b) => b.transactionCount - a.transactionCount)
    .slice(0, limit)
}

/** Product row as the inventory summary aggregation needs to see it. */
export type InventoryProduct = {
  id?: number
  name: string
  balance?: number
}

/**
 * Folds the current product snapshot into the inventory dashboard shape:
 * total/in/out-of-balance counts plus the ascending low-balance list.
 *
 * A non-finite or non-positive threshold means "feature off" — the effective
 * threshold collapses to 0 and no product can ever qualify as low-balance
 * (the loop below only adds to the list when `threshold > 0`).
 */
export function summarizeInventory(
  products: InventoryProduct[],
  lowBalanceThreshold: number,
): InventorySummaryResponse {
  const threshold =
    Number.isFinite(lowBalanceThreshold) && lowBalanceThreshold > 0
      ? lowBalanceThreshold
      : 0

  let totalBalance = 0
  let inBalanceCount = 0
  let outOfBalanceCount = 0
  const lowBalanceProducts: LowBalanceProduct[] = []

  for (const product of products) {
    const balance = product.balance ?? 0
    totalBalance += balance
    if (balance > 0) {
      inBalanceCount += 1
      if (threshold > 0 && balance <= threshold) {
        lowBalanceProducts.push({
          productId: product.id ?? 0,
          productName: product.name,
          balance,
        })
      }
    } else {
      outOfBalanceCount += 1
    }
  }

  lowBalanceProducts.sort((a, b) => a.balance - b.balance)

  return {
    totalBalance,
    productCount: products.length,
    inBalanceCount,
    outOfBalanceCount,
    lowBalanceCount: lowBalanceProducts.length,
    lowBalanceThreshold: threshold,
    lowBalanceProducts,
  }
}
