import { service } from '@loopback/core'
import { get, param, response } from '@loopback/rest'
import { Roles, requireRoles } from '../../../auth'
import { normalizeLimit, paginationConfig } from '../../../config/pagination'
import {
  AnalyticsService,
  DashboardSummaryResponse,
  InventorySummaryResponse,
} from '../../../services/analytics.service'

const ANALYTICS_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    personId: { type: 'number' },
    personName: { type: 'string' },
    productId: { type: 'number' },
    productName: { type: 'string' },
    totalWeight: { type: 'number' },
    transactionCount: { type: 'number' },
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
        expenseCount: { type: 'number' },
        totalPurchaseWeight: { type: 'number' },
        totalExpenseWeight: { type: 'number' },
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
    totalStock: { type: 'number' },
    productCount: { type: 'number' },
    inStockCount: { type: 'number' },
    outOfStockCount: { type: 'number' },
    lowStockCount: { type: 'number' },
    lowStockThreshold: { type: 'number' },
    lowStockProducts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          productId: { type: 'number' },
          productName: { type: 'string' },
          stock: { type: 'number' },
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
    type: 'purchases' | 'expenses' | 'both' = 'both',
    @param.query.number('limit') limit: number = paginationConfig.DEFAULT_LIMIT,
  ): Promise<DashboardSummaryResponse> {
    return this.analyticsService.getDashboardSummary(
      startDate,
      endDate,
      type,
      normalizeLimit(limit),
    )
  }

  @get('/analytics/inventory-summary')
  @response(200, {
    description: 'Inventory analytics summary',
    content: { 'application/json': { schema: INVENTORY_SUMMARY_SCHEMA } },
  })
  async getInventorySummary(
    @param.query.number('lowStockThreshold') lowStockThreshold: number = 10,
  ): Promise<InventorySummaryResponse> {
    return this.analyticsService.getInventorySummary(lowStockThreshold)
  }
}
