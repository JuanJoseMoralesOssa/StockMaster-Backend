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
  purchaseWeight: number
  paymentWeight: number
  purchaseCount: number
  paymentCount: number
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

  // --- Pendiente: insights de flujo (tendencia, por proveedor, por producto) ---

  /** Lecturas analíticas vía SQL crudo sobre el datasource de los repositorios. */
  private async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const ds = this.productRepository.dataSource as unknown as {
      execute: (sql: string, params?: unknown[]) => Promise<unknown>
    }
    const result = await ds.execute(sql, params)
    if (Array.isArray(result)) return result as T[]
    const rows = (result as { rows?: unknown }).rows
    return (Array.isArray(rows) ? rows : []) as T[]
  }

  private num(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : 0
  }

  private round3(n: number): number {
    return Math.round(n * 1000) / 1000
  }

  private isoOrNull(value: unknown): string | null {
    if (value == null) return null
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    return String(value).slice(0, 10)
  }

  /**
   * Pending (compras − pagos) en el tiempo como saldo ABSOLUTO: arranca del
   * pendiente acumulado ANTES de startDate, así la línea refleja el pendiente
   * real (no solo la variación del período). Agrupa por día/semana/mes.
   */
  async getPendingTrend(
    startDate: string,
    endDate: string,
    interval: PendingTrendInterval = 'day',
  ): Promise<PendingTrendPoint[]> {
    validateDateRange(startDate, endDate)
    // `bucket` solo puede ser day/week/month (validado) → interpolación segura.
    const bucket: PendingTrendInterval = (
      ['day', 'week', 'month'] as const
    ).includes(interval)
      ? interval
      : 'day'

    const [baselineRow] = await this.query<{ baseline: string | number }>(
      `SELECT
         COALESCE((SELECT SUM(pd.weight_kg) FROM purchasedetails pd
                   JOIN purchase p ON pd.purchaseid = p.id
                   WHERE p.date::date < $1::date), 0)
       - COALESCE((SELECT SUM(qd.weight_kg) FROM paymentdetails qd
                   JOIN payment q ON qd.paymentid = q.id
                   WHERE q.date::date < $1::date), 0) AS baseline`,
      [startDate],
    )
    let running = this.num(baselineRow?.baseline)

    const [purchases, payments] = await Promise.all([
      this.query<{ bucket: unknown; w: string | number }>(
        `SELECT date_trunc('${bucket}', p.date)::date AS bucket, SUM(pd.weight_kg) AS w
           FROM purchasedetails pd JOIN purchase p ON pd.purchaseid = p.id
          WHERE p.date::date BETWEEN $1::date AND $2::date
          GROUP BY 1`,
        [startDate, endDate],
      ),
      this.query<{ bucket: unknown; w: string | number }>(
        `SELECT date_trunc('${bucket}', q.date)::date AS bucket, SUM(qd.weight_kg) AS w
           FROM paymentdetails qd JOIN payment q ON qd.paymentid = q.id
          WHERE q.date::date BETWEEN $1::date AND $2::date
          GROUP BY 1`,
        [startDate, endDate],
      ),
    ])

    const purchasedByBucket = new Map<string, number>()
    const paidByBucket = new Map<string, number>()
    for (const r of purchases) {
      const key = this.isoOrNull(r.bucket)
      if (key) purchasedByBucket.set(key, this.num(r.w))
    }
    for (const r of payments) {
      const key = this.isoOrNull(r.bucket)
      if (key) paidByBucket.set(key, this.num(r.w))
    }

    const periods = Array.from(
      new Set([...purchasedByBucket.keys(), ...paidByBucket.keys()]),
    ).sort()

    return periods.map(period => {
      const purchased = this.round3(purchasedByBucket.get(period) ?? 0)
      const paid = this.round3(paidByBucket.get(period) ?? 0)
      running += purchased - paid
      return { period, purchased, paid, pending: this.round3(running) }
    })
  }

  /** Pendiente (comprado − pagado) por proveedor, histórico, solo los que se deben (> 0). */
  async getPendingBySupplier(limit: number = 10): Promise<PendingBySupplier[]> {
    const rows = await this.query<{
      personId: number
      personName: string
      purchased: string | number
      paid: string | number
      pending: string | number
    }>(
      `SELECT person.id AS "personId", person.name AS "personName",
              COALESCE(pur.w, 0) AS purchased,
              COALESCE(pay.w, 0) AS paid,
              COALESCE(pur.w, 0) - COALESCE(pay.w, 0) AS pending
         FROM person
         LEFT JOIN (SELECT personid, SUM(weight_kg) w FROM purchasedetails GROUP BY personid) pur
                ON pur.personid = person.id
         LEFT JOIN (SELECT personid, SUM(weight_kg) w FROM paymentdetails GROUP BY personid) pay
                ON pay.personid = person.id
        WHERE COALESCE(pur.w, 0) - COALESCE(pay.w, 0) > 0
        ORDER BY pending DESC
        LIMIT $1`,
      [normalizeLimit(limit)],
    )
    return rows.map(r => ({
      personId: Number(r.personId),
      personName: r.personName,
      purchased: this.round3(this.num(r.purchased)),
      paid: this.round3(this.num(r.paid)),
      pending: this.round3(this.num(r.pending)),
    }))
  }

  /** Productos con pendiente (balance > 0) + desde cuándo lo arrastran (antigüedad). */
  async getPendingByProduct(limit: number = 10): Promise<PendingByProduct[]> {
    const rows = await this.query<{
      productId: number
      productName: string
      balance: string | number
      pendingSince: string | Date | null
    }>(
      // pendingSince = inicio del streak ACTUAL de pendiente: el primer
      // movimiento posterior a la última vez que el balance quedó <= 0 (settled).
      // `<= 0` tolera residuos de redondeo; convertido a fecha calendario Bogotá
      // para que la antigüedad (días) no se desfase contra el "hoy" del frontend.
      // Fallback: primer movimiento del producto si nunca volvió a 0.
      `SELECT pr.id AS "productId", pr.name AS "productName", pr.balance AS balance,
              COALESCE(
                (SELECT MIN((k.date AT TIME ZONE 'America/Bogota')::date)
                   FROM kardex k
                  WHERE k.productid = pr.id
                    AND k.date > COALESCE(
                          (SELECT MAX(k2.date) FROM kardex k2
                            WHERE k2.productid = pr.id AND k2.balance <= 0),
                          '-infinity'::timestamptz)),
                (SELECT MIN((k.date AT TIME ZONE 'America/Bogota')::date)
                   FROM kardex k WHERE k.productid = pr.id)
              ) AS "pendingSince"
         FROM product pr
        WHERE pr.balance > 0
        ORDER BY pr.balance DESC
        LIMIT $1`,
      [normalizeLimit(limit)],
    )
    return rows.map(r => ({
      productId: Number(r.productId),
      productName: r.productName,
      balance: this.round3(this.num(r.balance)),
      pendingSince: this.isoOrNull(r.pendingSince),
    }))
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
        // weight_kg llega como STRING (columnas numeric de Postgres), así que
        // hay que coaccionar a número: con strings, `weightSum += weight`
        // CONCATENA en vez de sumar (1 línea parsea de vuelta por casualidad,
        // 2+ líneas producen un string no-numérico → NaN → 0 en el dashboard).
        const weight = this.num(transaction.weight_kg)
        if (!weight || weight <= 0) continue

        weightSum += weight

        // Supplier/product grouping also requires the parent document to have
        // resolved (matches the previous aggregateDetailsBy contract).
        if (!transaction.purchase && !transaction.payment) continue
        this.accumulate(
          supplierAgg,
          transaction.person,
          weight,
          kind,
          'Proveedor',
        )
        this.accumulate(
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

  /**
   * Folds one detail line into the running aggregate for its related entity,
   * keeping purchase (entrada) and payment (salida) weight/count SEPARATE so the
   * dashboard never shows a single mixed in+out number in "both" mode.
   */
  private accumulate(
    aggregates: Map<number, EntityAggregate>,
    related: RelatedEntity | undefined,
    weight: number,
    kind: TransactionKind,
    fallbackLabel: string,
  ): void {
    if (!related) return
    const id = related.id
    if (id == null) return

    const isPurchase = kind === TransactionKind.PURCHASE
    const existing = aggregates.get(id)
    if (existing) {
      if (isPurchase) {
        existing.purchaseWeight += weight
        existing.purchaseCount += 1
      } else {
        existing.paymentWeight += weight
        existing.paymentCount += 1
      }
    } else {
      aggregates.set(id, {
        id,
        name: related.name ?? `${fallbackLabel} ${id}`,
        purchaseWeight: isPurchase ? weight : 0,
        paymentWeight: isPurchase ? 0 : weight,
        purchaseCount: isPurchase ? 1 : 0,
        paymentCount: isPurchase ? 0 : 1,
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
