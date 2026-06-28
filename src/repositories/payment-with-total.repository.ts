import { Getter, inject } from '@loopback/core'
import { HasManyRepositoryFactory, repository } from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import {
  PaymentDetails,
  PaymentWithTotal,
  PaymentWithTotalRelations,
} from '../models'
import { DocumentRepositoryBase } from './document-repository.base'
import { findFilteredDocuments } from './document-filter.utils'
import { PaymentDetailsRepository } from './payment-details.repository'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'

export class PaymentWithTotalRepository extends DocumentRepositoryBase<
  PaymentWithTotal,
  typeof PaymentWithTotal.prototype.id,
  PaymentWithTotalRelations,
  PaymentDetails,
  typeof PaymentDetails.prototype.id
> {
  public readonly payment_details: HasManyRepositoryFactory<
    PaymentDetails,
    typeof PaymentWithTotal.prototype.id
  >

  constructor(
    @inject('datasources.postgres') dataSource: PostgresDataSource,
    @repository.getter('PaymentDetailsRepository')
    protected paymentDetailsRepositoryGetter: Getter<PaymentDetailsRepository>,
    @repository.getter('PersonRepository')
    protected personRepositoryGetter: Getter<PersonRepository>,
    @repository.getter('ProductRepository')
    protected productRepositoryGetter: Getter<ProductRepository>,
  ) {
    super(
      PaymentWithTotal,
      dataSource,
      'payment_details',
      paymentDetailsRepositoryGetter,
      personRepositoryGetter,
      productRepositoryGetter,
    )
    this.payment_details = this.detailsFactory
  }

  async findFilteredPayments(
    startDate?: string,
    endDate?: string,
    personId?: number,
    productId?: number,
    page?: number,
    limit?: number,
  ): Promise<{ data: PaymentWithTotal[]; count: number }> {
    return findFilteredDocuments<PaymentWithTotal>(
      this,
      'payment_details',
      async detailWhere => {
        const repo = await this.paymentDetailsRepositoryGetter()
        const matching = await repo.find({
          where: detailWhere,
          fields: ['paymentId'],
        })
        return [...new Set(matching.map(d => d.paymentId))]
      },
      { startDate, endDate, personId, productId, page, limit },
    )
  }
}
