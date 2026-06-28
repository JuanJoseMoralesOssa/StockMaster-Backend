import { Getter, inject } from '@loopback/core'
import {
  BelongsToAccessor,
  DefaultCrudRepository,
  repository,
} from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import {
  Payment,
  PaymentDetails,
  PaymentDetailsRelations,
  Person,
  Product,
} from '../models'
import { PaymentRepository } from './payment.repository'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'

export class PaymentDetailsRepository extends DefaultCrudRepository<
  PaymentDetails,
  typeof PaymentDetails.prototype.id,
  PaymentDetailsRelations
> {
  public readonly product: BelongsToAccessor<
    Product,
    typeof PaymentDetails.prototype.id
  >

  public readonly person: BelongsToAccessor<
    Person,
    typeof PaymentDetails.prototype.id
  >

  public readonly payment: BelongsToAccessor<
    Payment,
    typeof PaymentDetails.prototype.id
  >

  constructor(
    @inject('datasources.postgres') dataSource: PostgresDataSource,
    @repository.getter('ProductRepository')
    protected productRepositoryGetter: Getter<ProductRepository>,
    @repository.getter('PersonRepository')
    protected personRepositoryGetter: Getter<PersonRepository>,
    @repository.getter('PaymentRepository')
    protected paymentRepositoryGetter: Getter<PaymentRepository>,
  ) {
    super(PaymentDetails, dataSource)
    this.payment = this.createBelongsToAccessorFor(
      'payment',
      paymentRepositoryGetter,
    )
    this.registerInclusionResolver('payment', this.payment.inclusionResolver)
    this.person = this.createBelongsToAccessorFor(
      'person',
      personRepositoryGetter,
    )
    this.registerInclusionResolver('person', this.person.inclusionResolver)
    this.product = this.createBelongsToAccessorFor(
      'product',
      productRepositoryGetter,
    )
    this.registerInclusionResolver('product', this.product.inclusionResolver)
  }
}
