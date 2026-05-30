import { service } from '@loopback/core'
import { get, param } from '@loopback/rest'
import { Roles, requireRoles } from '../../../auth'
import {
  AnalyticsService,
  DashboardSummaryResponse,
  InventorySummaryResponse,
} from '../../../services/analytics.service'

// Dashboard/analytics: solo Oficina y Admin (Operador no tiene acceso)
@requireRoles(Roles.OFFICE, Roles.ADMIN)
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

  @get('/analytics/inventory-summary')
  async getInventorySummary(
    @param.query.number('lowStockThreshold') lowStockThreshold: number = 10,
  ): Promise<InventorySummaryResponse> {
    return this.analyticsService.getInventorySummary(lowStockThreshold)
  }
}
