import { BindingScope, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { normalizeLimit } from '../config/pagination'
import { toFiniteNumber } from '../domain/coercion'
import {
  AnalyticsSummary,
  DashboardSummaryResponse,
  InventorySummaryResponse,
  LowBalanceProduct,
  PendingByProduct,
  PendingBySupplier,
  PendingTrendInterval,
  PendingTrendPoint,
  ProductAnalytics,
  SupplierAnalytics,
  TransactionTypeFilter,
  WeightTotals,
} from '../models'
import {
  PaymentDetailsRepository,
  PaymentRepository,
  PendingAnalyticsRepository,
  PersonRepository,
  ProductRepository,
  PurchaseDetailsRepository,
  PurchaseRepository,
} from '../repositories'
import { TransactionKind } from '../modules/transactions/transaction-kind.enum'
import {
  findParentIdsInRange,
  ParentRepoLike,
} from '../modules/transactions/transaction-range.utils'
import { TRANSACTION_CONFIG } from '../modules/transactions/transaction-type.const'
import { validateDateRange } from './date-validation.utils'
import {
  accumulateEntity,
  EntityAggregate,
  RelatedEntity,
  topByTransactionCount,
  topByWeight,
} from './analytics.utils'

/** Detail row as the dashboard aggregation needs to see it. */
type AggregatableTransaction = {
  weight_kg?: number
  person?: RelatedEntity
  product?: RelatedEntity
  purchase?: RelatedEntity
  payment?: RelatedEntity
}

type DetailRepoLike = {
  find(filter?: object): Promise<AggregatableTransaction[]>
}

/** Default ceiling for "low balance" when the caller does not set one. */
const DEFAULT_LOW_BALANCE_THRESHOLD = 10

/**
 * The analytics reports. This service owns the READS and the orchestration; the
 * arithmetic lives in `analytics.utils` (pure, unit-tested) and the aggregate
 * SQL in `PendingAnalyticsRepository` — so no single file mixes "which rows do
 * we load" with "how do we add them up" with "what does the SQL look like".
 */
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
    @repository(PendingAnalyticsRepository)
    protected pendingAnalyticsRepository: PendingAnalyticsRepository,
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
      topSuppliersByWeight: topByWeight(
        supplierAnalytics,
        'max',
        normalizedLimit,
      ),
      bottomSuppliersByWeight: topByWeight(
        supplierAnalytics,
        'min',
        normalizedLimit,
      ),
      topProductsByWeight: topByWeight(
        productAnalytics,
        'max',
        normalizedLimit,
      ),
      bottomProductsByWeight: topByWeight(
        productAnalytics,
        'min',
        normalizedLimit,
      ),
      mostActiveSuppliers: topByTransactionCount(
        supplierAnalytics,
        normalizedLimit,
      ),
      mostTransactedProducts: topByTransactionCount(
        productAnalytics,
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
    lowBalanceThreshold: number = DEFAULT_LOW_BALANCE_THRESHOLD,
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

  // --- Pendiente: insights de flujo. La validación de entrada vive aquí; el
  // SQL agregado, en PendingAnalyticsRepository.

  async getPendingTrend(
    startDate: string,
    endDate: string,
    interval: PendingTrendInterval = 'day',
  ): Promise<PendingTrendPoint[]> {
    validateDateRange(startDate, endDate)
    return this.pendingAnalyticsRepository.findPendingTrend(
      startDate,
      endDate,
      interval,
    )
  }

  async getPendingBySupplier(limit: number = 10): Promise<PendingBySupplier[]> {
    return this.pendingAnalyticsRepository.findPendingBySupplier(
      normalizeLimit(limit),
    )
  }

  async getPendingByProduct(limit: number = 10): Promise<PendingByProduct[]> {
    return this.pendingAnalyticsRepository.findPendingByProduct(
      normalizeLimit(limit),
    )
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
    weightTotals: WeightTotals
  }> {
    const supplierAgg = new Map<number, EntityAggregate>()
    const productAgg = new Map<number, EntityAggregate>()
    const weightTotals: WeightTotals = {
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
        // Guard, not the primary mechanism: the datasource registers a
        // NUMERIC → parseFloat parser, so weight_kg normally arrives as a
        // number. Coercing anyway keeps one unparsed row from poisoning the
        // sum — `weightSum += '1.5'` CONCATENATES instead of adding, and the
        // resulting NaN blanks the whole dashboard rather than one line.
        const weight = toFiniteNumber(transaction.weight_kg)
        if (!weight || weight <= 0) continue

        weightSum += weight

        // Supplier/product grouping also requires the parent document to have
        // resolved (matches the previous aggregateDetailsBy contract).
        if (!transaction.purchase && !transaction.payment) continue
        accumulateEntity(
          supplierAgg,
          transaction.person,
          weight,
          kind,
          'Proveedor',
        )
        accumulateEntity(
          productAgg,
          transaction.product,
          weight,
          kind,
          'Producto',
        )
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
        purchaseWeight: row.purchaseWeight,
        paymentWeight: row.paymentWeight,
        totalWeight: row.purchaseWeight + row.paymentWeight,
        transactionCount: row.purchaseCount + row.paymentCount,
      })),
      productAnalytics: Array.from(productAgg.values()).map(row => ({
        productId: row.id,
        productName: row.name,
        purchaseWeight: row.purchaseWeight,
        paymentWeight: row.paymentWeight,
        totalWeight: row.purchaseWeight + row.paymentWeight,
        transactionCount: row.purchaseCount + row.paymentCount,
      })),
      weightTotals,
    }
  }

  private calculateSummary(
    supplierAnalytics: SupplierAnalytics[],
    productAnalytics: ProductAnalytics[],
    weightTotals: WeightTotals,
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
}
