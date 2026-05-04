import { service } from '@loopback/core'
import { get, param } from '@loopback/rest'
import {
  AnalyticsService,
  DashboardSummaryResponse,
  DateRangeAnalytics,
  SupplierAnalytics,
  ProductAnalytics,
} from '../../../services/analytics.service'

export class GeneralReportsController {
  constructor(
    @service(AnalyticsService)
    public analyticsService: AnalyticsService,
  ) {}

  @get('/analytics/dashboard-summary')
  async getDashboardSummary(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.string('type')
    type: 'purchases' | 'expenses' | 'both' = 'both',
    @param.query.number('limit') limit: number = 10,
  ): Promise<DashboardSummaryResponse> {
    return this.analyticsService.getDashboardSummary(
      startDate,
      endDate,
      type,
      limit,
    )
  }

  @get('/analytics/date-range')
  async getDateRangeAnalytics(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.string('type')
    type: 'purchases' | 'expenses' | 'both' = 'both',
  ): Promise<DateRangeAnalytics> {
    return this.analyticsService.getDateRangeAnalytics(startDate, endDate, type)
  }

  @get('/analytics/suppliers/top')
  async getTopSuppliers(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<SupplierAnalytics[]> {
    return this.analyticsService.getTopSuppliers(startDate, endDate, limit)
  }

  @get('/analytics/products/top')
  async getTopProducts(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<ProductAnalytics[]> {
    return this.analyticsService.getTopProducts(startDate, endDate, limit)
  }

  @get('/analytics/products/most-transactions')
  async getProductsByTransactionCount(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<ProductAnalytics[]> {
    return this.analyticsService.getProductsByTransactionCount(
      startDate,
      endDate,
      limit,
    )
  }

  @get('/analytics/products/least-transactions')
  async getProductsWithLeastTransactions(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<ProductAnalytics[]> {
    return this.analyticsService.getProductsWithLeastTransactions(
      startDate,
      endDate,
      limit,
    )
  }

  @get('/analytics/suppliers/most-transactions')
  async getSuppliersByTransactionCount(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<SupplierAnalytics[]> {
    return this.analyticsService.getSuppliersByTransactionCount(
      startDate,
      endDate,
      limit,
    )
  }

  @get('/analytics/suppliers/least-transactions')
  async getSuppliersWithLeastTransactions(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<SupplierAnalytics[]> {
    return this.analyticsService.getSuppliersWithLeastTransactions(
      startDate,
      endDate,
      limit,
    )
  }
}
