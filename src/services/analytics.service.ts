import { BindingScope, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { normalizeLimit } from '../config/pagination'
import {
  ExpenseDetailsRepository,
  ExpenseRepository,
  PersonRepository,
  ProductRepository,
  PurchaseDetailsRepository,
  PurchaseRepository,
} from '../repositories'
import { validateDateRange as validateAnalyticsDateRange } from './date-validation.utils'

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
  expense?: RelatedEntity
}

export interface AnalyticsSummary {
  totalSuppliers: number
  totalProducts: number
  totalWeight: number
  /** Number of detail lines (each product line within a document). */
  totalTransactions: number
  /** Number of purchase documents ("Compra") in the range. */
  purchaseCount: number
  /** Number of expense documents ("Gasto") in the range. */
  expenseCount: number
  /** Total weight ordered (purchases / "Compra") in the range. */
  totalPurchaseWeight: number
  /** Total weight paid/delivered (expenses / "Gasto") in the range. */
  totalExpenseWeight: number
  /** Outstanding weight: purchases minus expenses. */
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

export interface LowStockProduct {
  productId: number
  productName: string
  stock: number
}

export interface InventorySummaryResponse {
  /** Sum of current stock (kg) across all products. */
  totalStock: number
  productCount: number
  inStockCount: number
  outOfStockCount: number
  /** Products with 0 < stock <= lowStockThreshold. */
  lowStockCount: number
  lowStockThreshold: number
  lowStockProducts: LowStockProduct[]
}

@injectable({ scope: BindingScope.TRANSIENT })
export class AnalyticsService {
  constructor(
    @repository(PurchaseDetailsRepository)
    protected purchaseDetailsRepository: PurchaseDetailsRepository,
    @repository(ExpenseDetailsRepository)
    protected expenseDetailsRepository: ExpenseDetailsRepository,
    @repository(PurchaseRepository)
    protected purchaseRepository: PurchaseRepository,
    @repository(ExpenseRepository)
    protected expenseRepository: ExpenseRepository,
    @repository(PersonRepository)
    protected personRepository: PersonRepository,
    @repository(ProductRepository)
    protected productRepository: ProductRepository,
  ) {}

  async getDashboardSummary(
    startDate: string,
    endDate: string,

    type: 'purchases' | 'expenses' | 'both' = 'both',
    limit: number = 10,
  ): Promise<DashboardSummaryResponse> {
    this.validateDateRange(startDate, endDate)
    const normalizedLimit = normalizeLimit(limit)

    const [supplierAnalytics, productAnalytics, weightTotals] =
      await Promise.all([
        this.getSupplierAnalytics(startDate, endDate, type),
        this.getProductAnalytics(startDate, endDate, type),
        this.getWeightTotalsByType(startDate, endDate, type),
      ])

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
   * Current inventory snapshot derived from the authoritative Product.stock
   * field (kept in sync atomically by StockReconciliationService). This is a
   * point-in-time value and intentionally NOT scoped by a date range.
   */
  async getInventorySummary(
    lowStockThreshold: number = 10,
  ): Promise<InventorySummaryResponse> {
    const threshold =
      Number.isFinite(lowStockThreshold) && lowStockThreshold > 0
        ? lowStockThreshold
        : 0

    const products = await this.productRepository.find({
      fields: ['id', 'name', 'stock'],
    })

    let totalStock = 0
    let inStockCount = 0
    let outOfStockCount = 0
    const lowStockProducts: LowStockProduct[] = []

    for (const product of products) {
      const stock = product.stock ?? 0
      totalStock += stock
      if (stock > 0) {
        inStockCount += 1
        if (threshold > 0 && stock <= threshold) {
          lowStockProducts.push({
            productId: product.id ?? 0,
            productName: product.name,
            stock,
          })
        }
      } else {
        outOfStockCount += 1
      }
    }

    lowStockProducts.sort((a, b) => a.stock - b.stock)

    return {
      totalStock,
      productCount: products.length,
      inStockCount,
      outOfStockCount,
      lowStockCount: lowStockProducts.length,
      lowStockThreshold: threshold,
      lowStockProducts,
    }
  }

  private async getSupplierAnalytics(
    startDate: string,
    endDate: string,
    type: 'purchases' | 'expenses' | 'both',
  ): Promise<SupplierAnalytics[]> {
    const supplierMap = new Map<number, SupplierAnalytics>()
    const dateFilter = this.createDateFilter(startDate, endDate)

    if (type === 'purchases' || type === 'both') {
      // Step 1: Pre-fetch purchase IDs in the date range to prevent loading all details
      const purchasesInRange = await this.purchaseRepository.find({
        where: { date: dateFilter },
        fields: ['id'],
      })
      const purchaseIds = purchasesInRange
        .map(p => p.id)
        .filter((id): id is number => id != null)

      if (purchaseIds.length > 0) {
        const purchases = await this.purchaseDetailsRepository.find({
          where: { purchaseId: { inq: purchaseIds } },
          include: [{ relation: 'purchase' }, { relation: 'person' }],
        })
        this.aggregateSupplierData(purchases, supplierMap)
      }
    }

    if (type === 'expenses' || type === 'both') {
      // Step 1: Pre-fetch expense IDs in the date range to prevent loading all details
      const expensesInRange = await this.expenseRepository.find({
        where: { date: dateFilter },
        fields: ['id'],
      })
      const expenseIds = expensesInRange
        .map(e => e.id)
        .filter((id): id is number => id != null)

      if (expenseIds.length > 0) {
        const expenses = await this.expenseDetailsRepository.find({
          where: { expenseId: { inq: expenseIds } },
          include: [{ relation: 'expense' }, { relation: 'person' }],
        })
        this.aggregateSupplierData(expenses, supplierMap)
      }
    }

    return Array.from(supplierMap.values())
  }

  private async getProductAnalytics(
    startDate: string,
    endDate: string,
    type: 'purchases' | 'expenses' | 'both',
  ): Promise<ProductAnalytics[]> {
    const productMap = new Map<number, ProductAnalytics>()
    const dateFilter = this.createDateFilter(startDate, endDate)

    if (type === 'purchases' || type === 'both') {
      const purchasesInRange = await this.purchaseRepository.find({
        where: { date: dateFilter },
        fields: ['id'],
      })
      const purchaseIds = purchasesInRange
        .map(p => p.id)
        .filter((id): id is number => id != null)

      if (purchaseIds.length > 0) {
        const purchases = await this.purchaseDetailsRepository.find({
          where: { purchaseId: { inq: purchaseIds } },
          include: [{ relation: 'purchase' }, { relation: 'product' }],
        })
        this.aggregateProductData(purchases, productMap)
      }
    }

    if (type === 'expenses' || type === 'both') {
      const expensesInRange = await this.expenseRepository.find({
        where: { date: dateFilter },
        fields: ['id'],
      })
      const expenseIds = expensesInRange
        .map(e => e.id)
        .filter((id): id is number => id != null)

      if (expenseIds.length > 0) {
        const expenses = await this.expenseDetailsRepository.find({
          where: { expenseId: { inq: expenseIds } },
          include: [{ relation: 'expense' }, { relation: 'product' }],
        })
        this.aggregateProductData(expenses, productMap)
      }
    }

    return Array.from(productMap.values())
  }

  private aggregateSupplierData(
    transactions: AggregatableTransaction[],
    supplierMap: Map<number, SupplierAnalytics>,
  ): void {
    for (const transaction of transactions) {
      // Skip transactions without required data or without valid date relation
      if (
        !transaction.person ||
        !transaction.weight_kg ||
        transaction.weight_kg <= 0 ||
        (!transaction.purchase && !transaction.expense)
      ) {
        continue
      }

      const personId = transaction.person.id
      if (personId == null) continue
      const existing = supplierMap.get(personId)

      if (existing) {
        existing.totalWeight += transaction.weight_kg
        existing.transactionCount += 1
      } else {
        supplierMap.set(personId, {
          personId,
          personName: transaction.person.name ?? `Proveedor ${personId}`,
          totalWeight: transaction.weight_kg,
          transactionCount: 1,
        })
      }
    }
  }

  private aggregateProductData(
    transactions: AggregatableTransaction[],
    productMap: Map<number, ProductAnalytics>,
  ): void {
    for (const transaction of transactions) {
      // Skip transactions without required data or without valid date relation
      if (
        !transaction.product ||
        !transaction.weight_kg ||
        transaction.weight_kg <= 0 ||
        (!transaction.purchase && !transaction.expense)
      ) {
        continue
      }

      const productId = transaction.product.id
      if (productId == null) continue
      const existing = productMap.get(productId)

      if (existing) {
        existing.totalWeight += transaction.weight_kg
        existing.transactionCount += 1
      } else {
        productMap.set(productId, {
          productId,
          productName: transaction.product.name ?? `Producto ${productId}`,
          totalWeight: transaction.weight_kg,
          transactionCount: 1,
        })
      }
    }
  }

  private calculateSummary(
    supplierAnalytics: SupplierAnalytics[],
    productAnalytics: ProductAnalytics[],
    weightTotals: {
      purchaseWeight: number
      expenseWeight: number
      purchaseCount: number
      expenseCount: number
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
      expenseCount: weightTotals.expenseCount,
      totalPurchaseWeight: weightTotals.purchaseWeight,
      totalExpenseWeight: weightTotals.expenseWeight,
      pendingWeight: weightTotals.purchaseWeight - weightTotals.expenseWeight,
    }
  }

  /**
   * Sums detail weight (kg) for purchases ("Compra") and expenses ("Gasto")
   * separately in the given range, so the dashboard can show outstanding
   * (pending) weight = purchases - expenses.
   */
  private async getWeightTotalsByType(
    startDate: string,
    endDate: string,
    type: 'purchases' | 'expenses' | 'both',
  ): Promise<{
    purchaseWeight: number
    expenseWeight: number
    purchaseCount: number
    expenseCount: number
  }> {
    const dateFilter = this.createDateFilter(startDate, endDate)
    const sumWeights = (rows: { weight_kg?: number }[]) =>
      rows.reduce(
        (sum, r) => sum + (r.weight_kg && r.weight_kg > 0 ? r.weight_kg : 0),
        0,
      )

    let purchaseWeight = 0
    let expenseWeight = 0
    let purchaseCount = 0
    let expenseCount = 0

    if (type === 'purchases' || type === 'both') {
      const purchasesInRange = await this.purchaseRepository.find({
        where: { date: dateFilter },
        fields: ['id'],
      })
      const purchaseIds = purchasesInRange
        .map(p => p.id)
        .filter((id): id is number => id != null)
      purchaseCount = purchaseIds.length
      if (purchaseIds.length > 0) {
        const details = await this.purchaseDetailsRepository.find({
          where: { purchaseId: { inq: purchaseIds } },
          fields: ['weight_kg'],
        })
        purchaseWeight = sumWeights(details)
      }
    }

    if (type === 'expenses' || type === 'both') {
      const expensesInRange = await this.expenseRepository.find({
        where: { date: dateFilter },
        fields: ['id'],
      })
      const expenseIds = expensesInRange
        .map(e => e.id)
        .filter((id): id is number => id != null)
      expenseCount = expenseIds.length
      if (expenseIds.length > 0) {
        const details = await this.expenseDetailsRepository.find({
          where: { expenseId: { inq: expenseIds } },
          fields: ['weight_kg'],
        })
        expenseWeight = sumWeights(details)
      }
    }

    return { purchaseWeight, expenseWeight, purchaseCount, expenseCount }
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

  private validateDateRange(startDate: string, endDate: string): void {
    validateAnalyticsDateRange(startDate, endDate)
  }

  /**
   * Creates date filter object for database queries
   */
  private createDateFilter(startDate: string, endDate: string) {
    return {
      between: [startDate, endDate] as [string, string],
    }
  }
}
