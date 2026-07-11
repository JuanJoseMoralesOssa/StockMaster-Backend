import { service } from '@loopback/core'
import { get, param, response } from '@loopback/rest'
import { Roles, requireRoles } from '../../../auth'
import {
  DashboardSummaryResponse,
  InventorySummaryResponse,
  PendingByProduct,
  PendingBySupplier,
  PendingTrendInterval,
  PendingTrendPoint,
  TransactionTypeFilter,
} from '../../../models'
import { AnalyticsService } from '../../../services/analytics.service'

const ANALYTICS_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    personId: { type: 'number' },
    personName: { type: 'string' },
    productId: { type: 'number' },
    productName: { type: 'string' },
    totalWeight: { type: 'number' },
    purchaseWeight: { type: 'number' },
    paymentWeight: { type: 'number' },
    transactionCount: { type: 'number' },
  },
} as const

const PENDING_TREND_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      period: { type: 'string' },
      purchased: { type: 'number' },
      paid: { type: 'number' },
      pending: { type: 'number' },
    },
  },
} as const

const PENDING_BY_SUPPLIER_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      personId: { type: 'number' },
      personName: { type: 'string' },
      purchased: { type: 'number' },
      paid: { type: 'number' },
      pending: { type: 'number' },
    },
  },
} as const

const PENDING_BY_PRODUCT_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      productId: { type: 'number' },
      productName: { type: 'string' },
      balance: { type: 'number' },
      pendingSince: { type: 'string', nullable: true },
    },
  },
} as const

const DASHBOARD_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'object',
      properties: {
        totalSuppliers: { type: 'number' },
        totalProducts: { type: 'number' },
        totalWeight: { type: 'number' },
        totalTransactions: { type: 'number' },
        purchaseCount: { type: 'number' },
        paymentCount: { type: 'number' },
        totalPurchaseWeight: { type: 'number' },
        totalPaymentWeight: { type: 'number' },
        pendingWeight: { type: 'number' },
      },
    },
    topSuppliersByWeight: { type: 'array', items: ANALYTICS_ITEM_SCHEMA },
    bottomSuppliersByWeight: { type: 'array', items: ANALYTICS_ITEM_SCHEMA },
    topProductsByWeight: { type: 'array', items: ANALYTICS_ITEM_SCHEMA },
    bottomProductsByWeight: { type: 'array', items: ANALYTICS_ITEM_SCHEMA },
    mostActiveSuppliers: { type: 'array', items: ANALYTICS_ITEM_SCHEMA },
    mostTransactedProducts: { type: 'array', items: ANALYTICS_ITEM_SCHEMA },
  },
} as const

const INVENTORY_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    totalBalance: { type: 'number' },
    productCount: { type: 'number' },
    inBalanceCount: { type: 'number' },
    outOfBalanceCount: { type: 'number' },
    lowBalanceCount: { type: 'number' },
    lowBalanceThreshold: { type: 'number' },
    lowBalanceProducts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          productId: { type: 'number' },
          productName: { type: 'string' },
          balance: { type: 'number' },
        },
      },
    },
  },
} as const

// Dashboard/analytics: solo Oficina y Admin (Operador no tiene acceso)
@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class GeneralReportsController {
  constructor(
    @service(AnalyticsService)
    public analyticsService: AnalyticsService,
  ) {}

  @get('/analytics/dashboard-summary')
  @response(200, {
    description: 'Dashboard analytics summary',
    content: { 'application/json': { schema: DASHBOARD_SUMMARY_SCHEMA } },
  })
  async getDashboardSummary(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.string('type')
    type: TransactionTypeFilter = 'both',
    @param.query.number('limit') limit?: number,
  ): Promise<DashboardSummaryResponse> {
    // Limit normalization (defaulting + clamping to MAX_LIMIT) is the
    // service's job — see AnalyticsService.getDashboardSummary — so the raw
    // query value is passed through unmodified.
    return this.analyticsService.getDashboardSummary(
      startDate,
      endDate,
      type,
      limit,
    )
  }

  @get('/analytics/inventory-summary')
  @response(200, {
    description: 'Inventory analytics summary',
    content: { 'application/json': { schema: INVENTORY_SUMMARY_SCHEMA } },
  })
  async getInventorySummary(
    @param.query.number('lowBalanceThreshold') lowBalanceThreshold?: number,
  ): Promise<InventorySummaryResponse> {
    // Default lives solely in AnalyticsService.DEFAULT_LOW_BALANCE_THRESHOLD.
    return this.analyticsService.getInventorySummary(lowBalanceThreshold)
  }

  @get('/analytics/pending-trend')
  @response(200, {
    description: 'Pending balance (compras − pagos) over time, absolute',
    content: { 'application/json': { schema: PENDING_TREND_SCHEMA } },
  })
  async getPendingTrend(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.string('interval')
    interval: PendingTrendInterval = 'day',
  ): Promise<PendingTrendPoint[]> {
    return this.analyticsService.getPendingTrend(startDate, endDate, interval)
  }

  @get('/analytics/pending-by-supplier')
  @response(200, {
    description: 'Outstanding pending (bought − paid) per supplier',
    content: { 'application/json': { schema: PENDING_BY_SUPPLIER_SCHEMA } },
  })
  async getPendingBySupplier(
    @param.query.number('limit') limit?: number,
  ): Promise<PendingBySupplier[]> {
    return this.analyticsService.getPendingBySupplier(limit)
  }

  @get('/analytics/pending-by-product')
  @response(200, {
    description: 'Products with pending balance + how long it has been pending',
    content: { 'application/json': { schema: PENDING_BY_PRODUCT_SCHEMA } },
  })
  async getPendingByProduct(
    @param.query.number('limit') limit?: number,
  ): Promise<PendingByProduct[]> {
    return this.analyticsService.getPendingByProduct(limit)
  }
}
