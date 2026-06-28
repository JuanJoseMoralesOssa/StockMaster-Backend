import { Getter, inject } from '@loopback/core'
import { HasManyRepositoryFactory, repository } from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import { Payment, PaymentDetails, PaymentRelations } from '../models'
import { DocumentRepositoryBase } from './document-repository.base'
import { PaymentDetailsRepository } from './payment-details.repository'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'

export class PaymentRepository extends DocumentRepositoryBase<
  Payment,
  typeof Payment.prototype.id,
  PaymentRelations,
  PaymentDetails,
  typeof PaymentDetails.prototype.id
> {
  public readonly payment_details: HasManyRepositoryFactory<
    PaymentDetails,
    typeof Payment.prototype.id
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
      Payment,
      dataSource,
      'payment_details',
      paymentDetailsRepositoryGetter,
      personRepositoryGetter,
      productRepositoryGetter,
    )
    this.payment_details = this.detailsFactory
  }
}
