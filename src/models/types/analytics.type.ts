// The shapes the analytics endpoints return. Kept apart from the code that
// produces them so a controller (or the frontend contract) can be read without
// wading through repository reads and SQL, and so the pure helpers and the raw-
// SQL reader can both speak these types without importing the service.

export interface SupplierAnalytics {
  personId: number
  personName: string
  /** Combined purchase + payment weight (kept for sorting/back-compat). */
  totalWeight: number
  /** Weight bought from this supplier (entradas / "Compra"). */
  purchaseWeight: number
  /** Weight paid to this supplier (salidas / "Pago"). */
  paymentWeight: number
  transactionCount: number
}

export interface ProductAnalytics {
  productId: number
  productName: string
  /** Combined purchase + payment weight (kept for sorting/back-compat). */
  totalWeight: number
  /** Weight bought of this product (entradas / "Compra"). */
  purchaseWeight: number
  /** Weight paid of this product (salidas / "Pago"). */
  paymentWeight: number
  transactionCount: number
}

/** Which side of the ledger a dashboard query covers. */
export type TransactionTypeFilter = 'purchases' | 'payments' | 'both'

export interface AnalyticsSummary {
  totalSuppliers: number
  totalProducts: number
  totalWeight: number
  /** Number of detail lines (each product line within a document). */
  totalTransactions: number
  /** Number of purchase documents ("Compra") in the range. */
  purchaseCount: number
  /** Number of payment documents ("Pago") in the range. */
  paymentCount: number
  /** Total weight ordered (purchases / "Compra") in the range. */
  totalPurchaseWeight: number
  /** Total weight paid/delivered (payments / "Pago") in the range. */
  totalPaymentWeight: number
  /** Outstanding weight: purchases minus payments. */
  pendingWeight: number
}

/** Purchase/payment weight and document counts for a date range. */
export interface WeightTotals {
  purchaseWeight: number
  paymentWeight: number
  purchaseCount: number
  paymentCount: number
}

export interface DashboardSummaryResponse {
  summary: AnalyticsSummary
  topSuppliersByWeight: SupplierAnalytics[]
  bottomSuppliersByWeight: SupplierAnalytics[]
  topProductsByWeight: ProductAnalytics[]
  bottomProductsByWeight: ProductAnalytics[]
  mostActiveSuppliers: SupplierAnalytics[]
  mostTransactedProducts: ProductAnalytics[]
}

export interface LowBalanceProduct {
  productId: number
  productName: string
  balance: number
}

export interface InventorySummaryResponse {
  /** Sum of current balance (kg) across all products. */
  totalBalance: number
  productCount: number
  inBalanceCount: number
  outOfBalanceCount: number
  /** Products with 0 < balance <= lowBalanceThreshold. */
  lowBalanceCount: number
  lowBalanceThreshold: number
  lowBalanceProducts: LowBalanceProduct[]
}

export type PendingTrendInterval = 'day' | 'week' | 'month'

/** One point of the pending-balance-over-time series (absolute pending). */
export interface PendingTrendPoint {
  /** Bucket start (ISO date). */
  period: string
  purchased: number
  paid: number
  /** Absolute outstanding pending at the end of this bucket (compras − pagos acumulado). */
  pending: number
}

/** Outstanding (bought − paid) per supplier, in kg. Only suppliers with pending > 0. */
export interface PendingBySupplier {
  personId: number
  personName: string
  purchased: number
  paid: number
  pending: number
}

/** Current pending per product + since when it has been outstanding (aging). */
export interface PendingByProduct {
  productId: number
  productName: string
  balance: number
  /** ISO date the product's balance last returned to 0 (or its first movement); null if unknown. */
  pendingSince: string | null
}
