import { Getter, inject } from '@loopback/core'
import {
  DefaultCrudRepository,
  HasManyThroughRepositoryFactory,
  repository,
} from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import {
  Payment,
  PaymentDetails,
  Person,
  PersonRelations,
  Product,
  Purchase,
  PurchaseDetails,
} from '../models'
import { PaymentDetailsRepository } from './payment-details.repository'
import { PaymentRepository } from './payment.repository'
import { ProductRepository } from './product.repository'
import { PurchaseDetailsRepository } from './purchase-details.repository'
import { PurchaseRepository } from './purchase.repository'

export class PersonRepository extends DefaultCrudRepository<
  Person,
  typeof Person.prototype.id,
  PersonRelations
> {
  public readonly products_payment_details: HasManyThroughRepositoryFactory<
    Product,
    typeof Product.prototype.id,
    PaymentDetails,
    typeof Person.prototype.id
  >

  public readonly products_purchase_details: HasManyThroughRepositoryFactory<
    Product,
    typeof Product.prototype.id,
    PurchaseDetails,
    typeof Person.prototype.id
  >

  public readonly payments: HasManyThroughRepositoryFactory<
    Payment,
    typeof Payment.prototype.id,
    PaymentDetails,
    typeof Person.prototype.id
  >

  public readonly purchases: HasManyThroughRepositoryFactory<
    Purchase,
    typeof Purchase.prototype.id,
    PurchaseDetails,
    typeof Person.prototype.id
  >

  constructor(
    @inject('datasources.postgres') dataSource: PostgresDataSource,
    @repository.getter('PaymentDetailsRepository')
    protected paymentDetailsRepositoryGetter: Getter<PaymentDetailsRepository>,
    @repository.getter('ProductRepository')
    protected productRepositoryGetter: Getter<ProductRepository>,
    @repository.getter('PurchaseDetailsRepository')
    protected purchaseDetailsRepositoryGetter: Getter<PurchaseDetailsRepository>,
    @repository.getter('PaymentRepository')
    protected paymentRepositoryGetter: Getter<PaymentRepository>,
    @repository.getter('PurchaseRepository')
    protected purchaseRepositoryGetter: Getter<PurchaseRepository>,
  ) {
    super(Person, dataSource)
    this.purchases = this.createHasManyThroughRepositoryFactoryFor(
      'purchases',
      purchaseRepositoryGetter,
      purchaseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver(
      'purchases',
      this.purchases.inclusionResolver,
    )
    this.payments = this.createHasManyThroughRepositoryFactoryFor(
      'payments',
      paymentRepositoryGetter,
      paymentDetailsRepositoryGetter,
    )
    this.registerInclusionResolver('payments', this.payments.inclusionResolver)
    this.products_purchase_details =
      this.createHasManyThroughRepositoryFactoryFor(
        'products_purchase_details',
        productRepositoryGetter,
        purchaseDetailsRepositoryGetter,
      )
    this.registerInclusionResolver(
      'products_purchase_details',
      this.products_purchase_details.inclusionResolver,
    )
    this.products_payment_details =
      this.createHasManyThroughRepositoryFactoryFor(
        'products_payment_details',
        productRepositoryGetter,
        paymentDetailsRepositoryGetter,
      )
    this.registerInclusionResolver(
      'products_payment_details',
      this.products_payment_details.inclusionResolver,
    )
  }
}
