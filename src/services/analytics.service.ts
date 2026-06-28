import { BindingScope, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { normalizeLimit } from '../config/pagination'
import {
  PaymentDetailsRepository,
  PaymentRepository,
  PersonRepository,
  ProductRepository,
  PurchaseDetailsRepository,
  PurchaseRepository,
} from '../repositories'
import { validateDateRange } from './date-validation.utils'
import { TransactionKind } from './transaction-kind.enum'
import { TRANSACTION_CONFIG } from './transaction-type.const'
import { findParentIdsInRange, ParentRepoLike } from './transaction-range.utils'

export interface SupplierAnalytics {
  personId: number
  personName: string
  totalWeight: number
  transactionCount: number
}

export interface ProductAnalytics {
  productId: number
  productName: string
  totalWeight: number
  transactionCount: number
}

type RelatedEntity = {
  id?: number
  name?: string
}

type AggregatableTransaction = {
  weight_kg?: number
  person?: RelatedEntity
  product?: RelatedEntity
  purchase?: RelatedEntity
  payment?: RelatedEntity
}

type TransactionTypeFilter = 'purchases' | 'payments' | 'both'

type EntityAggregate = {
  id: number
  name: string
  totalWeight: number
  transactionCount: number
}

type DetailRepoLike = {
  find(filter?: object): Promise<AggregatableTransaction[]>
}

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

@injectable({ scope: BindingScope.TRANSIENT })
export class AnalyticsService {
  constructor(
    @repository(PurchaseDetailsRepository)
    protected purchaseDetailsRepository: PurchaseDetailsRepository,
    @repository(PaymentDetailsRepository)
    protected paymentDetailsRepository: PaymentDetailsRepository,
    @repository(PurchaseRepository)
    protected purchaseRepository: PurchaseRepository,
    @repository(PaymentRepository)
    protected paymentRepository: PaymentRepository,
    @repository(PersonRepository)
    protected personRepository: PersonRepository,
    @repository(ProductRepository)
    protected productRepository: ProductRepository,
  ) {}

  async getDashboardSummary(
    startDate: string,
    endDate: string,

    type: TransactionTypeFilter = 'both',
    limit: number = 10,
  ): Promise<DashboardSummaryResponse> {
    validateDateRange(startDate, endDate)
    const normalizedLimit = normalizeLimit(limit)

    const { supplierAnalytics, productAnalytics, weightTotals } =
      await this.collectAnalytics(startDate, endDate, type)

    return {
      summary: this.calculateSummary(
        supplierAnalytics,
        productAnalytics,
        weightTotals,
      ),
      topSuppliersByWeight: this.getTopResults(
        supplierAnalytics,
        'max',
        normalizedLimit,
      ),
      bottomSuppliersByWeight: this.getTopResults(
        supplierAnalytics,
        'min',
        normalizedLimit,
      ),
      topProductsByWeight: this.getTopResults(
        productAnalytics,
        'max',
        normalizedLimit,
      ),
      bottomProductsByWeight: this.getTopResults(
        productAnalytics,
        'min',
        normalizedLimit,
      ),
      mostActiveSuppliers: this.getTopByTransactions(
        supplierAnalytics,
        'max',
        normalizedLimit,
      ),
      mostTransactedProducts: this.getTopByTransactions(
        productAnalytics,
        'max',
        normalizedLimit,
      ),
    }
  }

  /**
   * Current inventory snapshot derived from the authoritative Product.balance
   * field (kept in sync atomically by BalanceReconciliationService). This is a
   * point-in-time value and intentionally NOT scoped by a date range.
   */
  async getInventorySummary(
    lowBalanceThreshold: number = 10,
  ): Promise<InventorySummaryResponse> {
    const threshold =
      Number.isFinite(lowBalanceThreshold) && lowBalanceThreshold > 0
        ? lowBalanceThreshold
        : 0

    const products = await this.productRepository.find({
      fields: ['id', 'name', 'balance'],
    })

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

  private kindsFor(type: TransactionTypeFilter): TransactionKind[] {
    if (type === 'purchases') return [TransactionKind.PURCHASE]
    if (type === 'payments') return [TransactionKind.PAYMENT]
    return [TransactionKind.PURCHASE, TransactionKind.PAYMENT]
  }

  private reposFor(kind: TransactionKind): {
    parentRepo: ParentRepoLike
    detailRepo: DetailRepoLike
    parentFk: 'purchaseId' | 'paymentId'
    parentRelation: 'purchase' | 'payment'
  } {
    const config = TRANSACTION_CONFIG[kind]
    // Config-driven lookup rather than an `if (kind === PURCHASE) … else`
    // branch: the Record is exhaustive over TransactionKind, so adding a kind
    // is a compile-checked map entry, not a new conditional (audit Finding 9).
    const reposByKind: Record<
      TransactionKind,
      { parentRepo: ParentRepoLike; detailRepo: DetailRepoLike }
    > = {
      [TransactionKind.PURCHASE]: {
        parentRepo: this.purchaseRepository,
        detailRepo: this.purchaseDetailsRepository,
      },
      [TransactionKind.PAYMENT]: {
        parentRepo: this.paymentRepository,
        detailRepo: this.paymentDetailsRepository,
      },
    }
    const { parentRepo, detailRepo } = reposByKind[kind]
    return {
      parentRepo,
      detailRepo,
      parentFk: config.parentFk,
      parentRelation: config.parentTable,
    }
  }

  /**
   * The single home for the "prefetch parent ids in range, then load their
   * details" two-step. Returns the parent document count (all documents in
   * range, even detail-less ones) alongside the detail rows, eagerly loading
   * the parent plus any requested relations.
   */
  private async fetchDetailsInRange(
    kind: TransactionKind,
    startDate: string,
    endDate: string,
    options: { include?: Array<'person' | 'product'> },
  ): Promise<{ parentCount: number; details: AggregatableTransaction[] }> {
    const { parentRepo, detailRepo, parentFk, parentRelation } =
      this.reposFor(kind)

    const parentIds = await findParentIdsInRange(parentRepo, startDate, endDate)
    if (parentIds.length === 0) {
      return { parentCount: 0, details: [] }
    }

    const filter: Record<string, unknown> = {
      where: { [parentFk]: { inq: parentIds } },
      include: [
        { relation: parentRelation },
        ...(options.include ?? []).map(relation => ({ relation })),
      ],
    }

    const details = await detailRepo.find(filter)
    return { parentCount: parentIds.length, details }
  }

  /**
   * Loads the detail rows once per transaction kind and derives the supplier,
   * product and weight aggregates from that single pass. Previously each of
   * those three outputs triggered its own `find` per kind (the same rows read
   * 2–3× per dashboard call); folding them into one fetch removes the redundant
   * reads while preserving the exact aggregation semantics (audit Finding 4).
   *
   * Two distinct skip rules are intentional and preserved:
   *  - weight totals sum every positive-weight detail line in range;
   *  - supplier/product groups additionally require the related entity and the
   *    parent document to be present.
   */
  private async collectAnalytics(
    startDate: string,
    endDate: string,
    type: TransactionTypeFilter,
  ): Promise<{
    supplierAnalytics: SupplierAnalytics[]
    productAnalytics: ProductAnalytics[]
    weightTotals: {
      purchaseWeight: number
      paymentWeight: number
      purchaseCount: number
      paymentCount: number
    }
  }> {
    const supplierAgg = new Map<number, EntityAggregate>()
    const productAgg = new Map<number, EntityAggregate>()
    const weightTotals = {
      purchaseWeight: 0,
      paymentWeight: 0,
      purchaseCount: 0,
      paymentCount: 0,
    }

    for (const kind of this.kindsFor(type)) {
      const { parentCount, details } = await this.fetchDetailsInRange(
        kind,
        startDate,
        endDate,
        { include: ['person', 'product'] },
      )

      let weightSum = 0
      for (const transaction of details) {
        const weight = transaction.weight_kg
        if (!weight || weight <= 0) continue

        weightSum += weight

        // Supplier/product grouping also requires the parent document to have
        // resolved (matches the previous aggregateDetailsBy contract).
        if (!transaction.purchase && !transaction.payment) continue
        this.accumulate(supplierAgg, transaction.person, weight, 'Proveedor')
        this.accumulate(productAgg, transaction.product, weight, 'Producto')
      }

      if (kind === TransactionKind.PURCHASE) {
        weightTotals.purchaseCount = parentCount
        weightTotals.purchaseWeight = weightSum
      } else {
        weightTotals.paymentCount = parentCount
        weightTotals.paymentWeight = weightSum
      }
    }

    return {
      supplierAnalytics: Array.from(supplierAgg.values()).map(row => ({
        personId: row.id,
        personName: row.name,
        totalWeight: row.totalWeight,
        transactionCount: row.transactionCount,
      })),
      productAnalytics: Array.from(productAgg.values()).map(row => ({
        productId: row.id,
        productName: row.name,
        totalWeight: row.totalWeight,
        transactionCount: row.transactionCount,
      })),
      weightTotals,
    }
  }

  /** Folds one detail line into the running aggregate for its related entity. */
  private accumulate(
    aggregates: Map<number, EntityAggregate>,
    related: RelatedEntity | undefined,
    weight: number,
    fallbackLabel: string,
  ): void {
    if (!related) return
    const id = related.id
    if (id == null) return

    const existing = aggregates.get(id)
    if (existing) {
      existing.totalWeight += weight
      existing.transactionCount += 1
    } else {
      aggregates.set(id, {
        id,
        name: related.name ?? `${fallbackLabel} ${id}`,
        totalWeight: weight,
        transactionCount: 1,
      })
    }
  }

  private calculateSummary(
    supplierAnalytics: SupplierAnalytics[],
    productAnalytics: ProductAnalytics[],
    weightTotals: {
      purchaseWeight: number
      paymentWeight: number
      purchaseCount: number
      paymentCount: number
    },
  ): AnalyticsSummary {
    // Only reduce on ONE of the analytics arrays (e.g., products) to avoid double-counting
    // the same transaction's weight and count since both arrays are derived
    // from the exact same base of detail records.
    return {
      totalSuppliers: supplierAnalytics.length,
      totalProducts: productAnalytics.length,
      totalWeight: productAnalytics.reduce((sum, p) => sum + p.totalWeight, 0),
      totalTransactions: productAnalytics.reduce(
        (sum, p) => sum + p.transactionCount,
        0,
      ),
      purchaseCount: weightTotals.purchaseCount,
      paymentCount: weightTotals.paymentCount,
      totalPurchaseWeight: weightTotals.purchaseWeight,
      totalPaymentWeight: weightTotals.paymentWeight,
      pendingWeight: weightTotals.purchaseWeight - weightTotals.paymentWeight,
    }
  }

  private getTopResults<T extends { totalWeight: number }>(
    data: T[],
    mode: 'max' | 'min',
    limit: number,
  ): T[] {
    if (data.length === 0) return []

    // Creamos una copia del arreglo para no mutar el original en memoria con el `sort`
    const sortedData = [...data].sort((a, b) =>
      mode === 'max'
        ? b.totalWeight - a.totalWeight
        : a.totalWeight - b.totalWeight,
    )

    return sortedData.slice(0, limit)
  }

  private getTopByTransactions<T extends { transactionCount: number }>(
    data: T[],
    mode: 'max' | 'min',
    limit: number,
  ): T[] {
    if (data.length === 0) return []

    // Filtramos aquellos con al menos 1 transacción
    const filteredData = data.filter(item => item.transactionCount > 0)

    // Lo copiamos y ordenamos
    const sortedData = [...filteredData].sort((a, b) =>
      mode === 'max'
        ? b.transactionCount - a.transactionCount
        : a.transactionCount - b.transactionCount,
    )

    return sortedData.slice(0, limit)
  }
}
