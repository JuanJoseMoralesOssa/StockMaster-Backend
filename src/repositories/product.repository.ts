import { Getter, inject } from '@loopback/core'
import {
  DefaultCrudRepository,
  HasManyRepositoryFactory,
  HasManyThroughRepositoryFactory,
  repository,
} from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import {
  Payment,
  PaymentDetails,
  Kardex,
  Person,
  Product,
  ProductRelations,
  Purchase,
  PurchaseDetails,
} from '../models'
import { PaymentDetailsRepository } from './payment-details.repository'
import { PaymentRepository } from './payment.repository'
import { KardexRepository } from './kardex.repository'
import { PersonRepository } from './person.repository'
import { PurchaseDetailsRepository } from './purchase-details.repository'
import { PurchaseRepository } from './purchase.repository'

export class ProductRepository extends DefaultCrudRepository<
  Product,
  typeof Product.prototype.id,
  ProductRelations
> {
  public readonly people_payment_details: HasManyThroughRepositoryFactory<
    Person,
    typeof Person.prototype.id,
    PaymentDetails,
    typeof Product.prototype.id
  >

  public readonly people_purchase_details: HasManyThroughRepositoryFactory<
    Person,
    typeof Person.prototype.id,
    PurchaseDetails,
    typeof Product.prototype.id
  >

  public readonly kardexes: HasManyRepositoryFactory<
    Kardex,
    typeof Product.prototype.id
  >

  public readonly purchases: HasManyThroughRepositoryFactory<
    Purchase,
    typeof Purchase.prototype.id,
    PurchaseDetails,
    typeof Product.prototype.id
  >

  public readonly payments: HasManyThroughRepositoryFactory<
    Payment,
    typeof Payment.prototype.id,
    PaymentDetails,
    typeof Product.prototype.id
  >

  constructor(
    @inject('datasources.postgres') dataSource: PostgresDataSource,
    @repository.getter('PaymentDetailsRepository')
    protected paymentDetailsRepositoryGetter: Getter<PaymentDetailsRepository>,
    @repository.getter('PersonRepository')
    protected personRepositoryGetter: Getter<PersonRepository>,
    @repository.getter('PurchaseDetailsRepository')
    protected purchaseDetailsRepositoryGetter: Getter<PurchaseDetailsRepository>,
    @repository.getter('KardexRepository')
    protected kardexRepositoryGetter: Getter<KardexRepository>,
    @repository.getter('PurchaseRepository')
    protected purchaseRepositoryGetter: Getter<PurchaseRepository>,
    @repository.getter('PaymentRepository')
    protected paymentRepositoryGetter: Getter<PaymentRepository>,
  ) {
    super(Product, dataSource)
    this.payments = this.createHasManyThroughRepositoryFactoryFor(
      'payments',
      paymentRepositoryGetter,
      paymentDetailsRepositoryGetter,
    )
    this.registerInclusionResolver('payments', this.payments.inclusionResolver)
    this.purchases = this.createHasManyThroughRepositoryFactoryFor(
      'purchases',
      purchaseRepositoryGetter,
      purchaseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver(
      'purchases',
      this.purchases.inclusionResolver,
    )
    this.kardexes = this.createHasManyRepositoryFactoryFor(
      'kardexes',
      kardexRepositoryGetter,
    )
    this.registerInclusionResolver('kardexes', this.kardexes.inclusionResolver)
    this.people_purchase_details =
      this.createHasManyThroughRepositoryFactoryFor(
        'people_purchase_details',
        personRepositoryGetter,
        purchaseDetailsRepositoryGetter,
      )
    this.registerInclusionResolver(
      'people_purchase_details',
      this.people_purchase_details.inclusionResolver,
    )
    this.people_payment_details = this.createHasManyThroughRepositoryFactoryFor(
      'people_payment_details',
      personRepositoryGetter,
      paymentDetailsRepositoryGetter,
    )
    this.registerInclusionResolver(
      'people_payment_details',
      this.people_payment_details.inclusionResolver,
    )
  }
}
