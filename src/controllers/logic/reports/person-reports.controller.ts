import { inject } from '@loopback/core'
import { get, HttpErrors, param } from '@loopback/rest'
import {
  DateFilteringService,
  FilterType,
} from '../../../services/date-filtering.service'
import { TransactionQueryService } from '../../../services/transaction-query.service'

interface ProductDetail {
  date: string
  weight_kg: number
  type: 'Compra' | 'Gasto'
}

export class PersonReportsController {
  constructor(
    @inject('services.DateFilteringService')
    protected dateFilteringService: DateFilteringService,
    @inject('services.TransactionQueryService')
    protected transactionQueryService: TransactionQueryService,
  ) {}

  @get('/suppliers/{supplierId}/products/{productId}/details/day')
  async getSupplierProductDetailsByDay(
    @param.path.number('supplierId') supplierId: number,
    @param.path.number('productId') productId: number,
    @param.query.string('day') day: string,
  ): Promise<ProductDetail[]> {
    this.validateIds(supplierId, productId)
    this.dateFilteringService.validateDateFormat(day, FilterType.DAY)
    const { startDate, endDate } = this.dateFilteringService.getDateRange(
      day,
      FilterType.DAY,
    )

    return this.transactionQueryService.getSupplierProductDetails(
      supplierId,
      productId,
      startDate,
      endDate,
    )
  }

  @get('/suppliers/{supplierId}/products/{productId}/details')
  async getSupplierProductDetailsByMonth(
    @param.path.number('supplierId') supplierId: number,
    @param.path.number('productId') productId: number,
    @param.query.string('month') month: string,
  ): Promise<ProductDetail[]> {
    this.validateIds(supplierId, productId)
    this.dateFilteringService.validateDateFormat(month, FilterType.MONTH)
    const { startDate, endDate } = this.dateFilteringService.getDateRange(
      month,
      FilterType.MONTH,
    )

    return this.transactionQueryService.getSupplierProductDetails(
      supplierId,
      productId,
      startDate,
      endDate,
    )
  }

  private validateIds(supplierId: number, productId: number): void {
    if (!supplierId || supplierId <= 0) {
      throw new HttpErrors.BadRequest('Invalid supplier ID')
    }
    if (!productId || productId <= 0) {
      throw new HttpErrors.BadRequest('Invalid product ID')
    }
  }
}
