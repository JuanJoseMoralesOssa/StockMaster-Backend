import { repository } from '@loopback/repository'
import { get, HttpErrors, param } from '@loopback/rest'
import {
  ExpenseDetailsRepository,
  ExpenseRepository,
  PersonRepository,
  ProductRepository,
  PurchaseDetailsRepository,
  PurchaseRepository,
} from '../../../repositories'

interface SupplierAnalytics {
  personId: number
  personName: string
  totalWeight: number
  transactionCount: number
}

interface ProductAnalytics {
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

export interface DashboardSummaryResponse {
  summary: {
    totalSuppliers: number
    totalProducts: number
    totalWeight: number
    totalTransactions: number
  }
  topSuppliersByWeight: SupplierAnalytics[]
  bottomSuppliersByWeight: SupplierAnalytics[]
  topProductsByWeight: ProductAnalytics[]
  bottomProductsByWeight: ProductAnalytics[]
  mostActiveSuppliers: SupplierAnalytics[]
  mostTransactedProducts: ProductAnalytics[]
}

interface DateRangeAnalytics {
  topSuppliers: SupplierAnalytics[]
  bottomSuppliers: SupplierAnalytics[]
  topProducts: ProductAnalytics[]
  bottomProducts: ProductAnalytics[]
  summary: {
    totalSuppliers: number
    totalProducts: number
    totalWeight: number
    totalTransactions: number
  }
}

export class GeneralReportsController {
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

  @get('/analytics/dashboard-summary')
  async getDashboardSummary(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.string('type')
    type: 'purchases' | 'expenses' | 'both' = 'both',
    @param.query.number('limit') limit: number = 10,
  ): Promise<DashboardSummaryResponse> {
    this.validateDateRange(startDate, endDate)

    const [supplierAnalytics, productAnalytics] = await Promise.all([
      this.getSupplierAnalytics(startDate, endDate, type),
      this.getProductAnalytics(startDate, endDate, type),
    ])

    return {
      summary: this.calculateSummary(supplierAnalytics, productAnalytics),
      topSuppliersByWeight: this.getTopResults(supplierAnalytics, 'max', limit),
      bottomSuppliersByWeight: this.getTopResults(
        supplierAnalytics,
        'min',
        limit,
      ),
      topProductsByWeight: this.getTopResults(productAnalytics, 'max', limit),
      bottomProductsByWeight: this.getTopResults(
        productAnalytics,
        'min',
        limit,
      ),
      mostActiveSuppliers: this.getTopByTransactions(
        supplierAnalytics,
        'max',
        limit,
      ),
      mostTransactedProducts: this.getTopByTransactions(
        productAnalytics,
        'max',
        limit,
      ),
    }
  }

  @get('/analytics/date-range')
  async getDateRangeAnalytics(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.string('type')
    type: 'purchases' | 'expenses' | 'both' = 'both',
  ): Promise<DateRangeAnalytics> {
    this.validateDateRange(startDate, endDate)

    const [supplierAnalytics, productAnalytics] = await Promise.all([
      this.getSupplierAnalytics(startDate, endDate, type),
      this.getProductAnalytics(startDate, endDate, type),
    ])

    return {
      topSuppliers: this.getTopResults(supplierAnalytics, 'max', 10),
      bottomSuppliers: this.getTopResults(supplierAnalytics, 'min', 10),
      topProducts: this.getTopResults(productAnalytics, 'max', 10),
      bottomProducts: this.getTopResults(productAnalytics, 'min', 10),
      summary: this.calculateSummary(supplierAnalytics, productAnalytics),
    }
  }

  @get('/analytics/suppliers/top')
  async getTopSuppliers(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<SupplierAnalytics[]> {
    this.validateDateRange(startDate, endDate)
    const analytics = await this.getSupplierAnalytics(
      startDate,
      endDate,
      'both',
    )
    return this.getTopResults(analytics, 'max', limit)
  }

  @get('/analytics/products/top')
  async getTopProducts(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<ProductAnalytics[]> {
    this.validateDateRange(startDate, endDate)
    const analytics = await this.getProductAnalytics(startDate, endDate, 'both')
    return this.getTopResults(analytics, 'max', limit)
  }

  @get('/analytics/products/most-transactions')
  async getProductsByTransactionCount(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<ProductAnalytics[]> {
    this.validateDateRange(startDate, endDate)
    const analytics = await this.getProductAnalytics(startDate, endDate, 'both')
    return this.getTopByTransactions(analytics, 'max', limit)
  }

  @get('/analytics/products/least-transactions')
  async getProductsWithLeastTransactions(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<ProductAnalytics[]> {
    this.validateDateRange(startDate, endDate)
    const analytics = await this.getProductAnalytics(startDate, endDate, 'both')
    return this.getTopByTransactions(analytics, 'min', limit)
  }

  @get('/analytics/suppliers/most-transactions')
  async getSuppliersByTransactionCount(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<SupplierAnalytics[]> {
    this.validateDateRange(startDate, endDate)
    const analytics = await this.getSupplierAnalytics(
      startDate,
      endDate,
      'both',
    )
    return this.getTopByTransactions(analytics, 'max', limit)
  }

  @get('/analytics/suppliers/least-transactions')
  async getSuppliersWithLeastTransactions(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<SupplierAnalytics[]> {
    this.validateDateRange(startDate, endDate)
    const analytics = await this.getSupplierAnalytics(
      startDate,
      endDate,
      'both',
    )
    return this.getTopByTransactions(analytics, 'min', limit)
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
  ): {
    totalSuppliers: number
    totalProducts: number
    totalWeight: number
    totalTransactions: number
  } {
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

  private validateDateRange(startDate: string, endDate: string): void {
    if (!startDate || !endDate) {
      throw new HttpErrors.BadRequest('Both startDate and endDate are required')
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(startDate)) {
      throw new HttpErrors.BadRequest(
        'Invalid startDate format. Use YYYY-MM-DD',
      )
    }
    if (!dateRegex.test(endDate)) {
      throw new HttpErrors.BadRequest('Invalid endDate format. Use YYYY-MM-DD')
    }

    // Validate date values
    const start = new Date(startDate)
    const end = new Date(endDate)

    if (isNaN(start.getTime())) {
      throw new HttpErrors.BadRequest('Invalid startDate value')
    }
    if (isNaN(end.getTime())) {
      throw new HttpErrors.BadRequest('Invalid endDate value')
    }

    if (start > end) {
      throw new HttpErrors.BadRequest(
        'startDate must be before or equal to endDate',
      )
    }

    // Validate date range is not too large (optional business rule)
    const maxDaysRange = 365 // 1 year
    const daysDiff = Math.ceil(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
    )
    if (daysDiff > maxDaysRange) {
      throw new HttpErrors.BadRequest(
        `Date range cannot exceed ${maxDaysRange} days`,
      )
    }
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
