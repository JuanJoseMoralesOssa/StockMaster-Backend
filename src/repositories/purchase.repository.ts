import { Getter, inject } from '@loopback/core'
import {
  DefaultCrudRepository,
  HasManyRepositoryFactory,
  HasManyThroughRepositoryFactory,
  repository,
} from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import {
  Person,
  Product,
  Purchase,
  PurchaseDetails,
  PurchaseRelations,
} from '../models'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'
import { PurchaseDetailsRepository } from './purchase-details.repository'

export class PurchaseRepository extends DefaultCrudRepository<
  Purchase,
  typeof Purchase.prototype.id,
  PurchaseRelations
> {
  public readonly purchase_details: HasManyRepositoryFactory<
    PurchaseDetails,
    typeof Purchase.prototype.id
  >

  public readonly people: HasManyThroughRepositoryFactory<
    Person,
    typeof Person.prototype.id,
    PurchaseDetails,
    typeof Purchase.prototype.id
  >

  public readonly products: HasManyThroughRepositoryFactory<
    Product,
    typeof Product.prototype.id,
    PurchaseDetails,
    typeof Purchase.prototype.id
  >

  constructor(
    @inject('datasources.postgres') dataSource: PostgresDataSource,
    @repository.getter('PurchaseDetailsRepository')
    protected purchaseDetailsRepositoryGetter: Getter<PurchaseDetailsRepository>,
    @repository.getter('PersonRepository')
    protected personRepositoryGetter: Getter<PersonRepository>,
    @repository.getter('ProductRepository')
    protected productRepositoryGetter: Getter<ProductRepository>,
  ) {
    super(Purchase, dataSource)
    this.products = this.createHasManyThroughRepositoryFactoryFor(
      'products',
      productRepositoryGetter,
      purchaseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver('products', this.products.inclusionResolver)
    this.people = this.createHasManyThroughRepositoryFactoryFor(
      'people',
      personRepositoryGetter,
      purchaseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver('people', this.people.inclusionResolver)
    this.purchase_details = this.createHasManyRepositoryFactoryFor(
      'purchase_details',
      purchaseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver(
      'purchase_details',
      this.purchase_details.inclusionResolver,
    )
  }
}
