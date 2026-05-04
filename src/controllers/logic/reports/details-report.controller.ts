import { service } from '@loopback/core'
import { get, param } from '@loopback/rest'
import {
  TransactionDetailPersonProduct,
  TransactionDetailProduct,
  TransactionDetailPerson,
} from '../../../models'
import { TransactionQueryService } from '../../../services/transaction-query.service'

export class DetailsReportsController {
  constructor(
    @service(TransactionQueryService)
    public transactionQueryService: TransactionQueryService,
  ) {}

  @get('/reports/details/person/{personId}/product/{productId}')
  async getPersonProductTransactions(
    @param.path.number('personId') personId: number,
    @param.path.number('productId') productId: number,
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
  ): Promise<TransactionDetailPersonProduct[]> {
    return this.transactionQueryService.getPersonProductTransactions(
      personId,
      productId,
      startDate,
      endDate,
    )
  }

  @get('/reports/details/product/{productId}')
  async getProductTransactions(
    @param.path.number('productId') productId: number,
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
  ): Promise<TransactionDetailProduct[]> {
    return this.transactionQueryService.getProductTransactions(
      productId,
      startDate,
      endDate,
    )
  }

  @get('/reports/details/person/{personId}')
  async getPersonTransactions(
    @param.path.number('personId') personId: number,
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
  ): Promise<TransactionDetailPerson[]> {
    return this.transactionQueryService.getPersonTransactions(
      personId,
      startDate,
      endDate,
    )
  }
}
