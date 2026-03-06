import { Getter, inject } from '@loopback/core'
import {
  BelongsToAccessor,
  DefaultCrudRepository,
  repository,
} from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
// import {SqlserverDataSource} from '../datasources';
import {
  Person,
  Product,
  Purchase,
  PurchaseDetails,
  PurchaseDetailsRelations,
} from '../models'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'
import { PurchaseRepository } from './purchase.repository'

export class PurchaseDetailsRepository extends DefaultCrudRepository<
  PurchaseDetails,
  typeof PurchaseDetails.prototype.id,
  PurchaseDetailsRelations
> {
  public readonly product: BelongsToAccessor<
    Product,
    typeof PurchaseDetails.prototype.id
  >

  public readonly person: BelongsToAccessor<
    Person,
    typeof PurchaseDetails.prototype.id
  >

  public readonly purchase: BelongsToAccessor<
    Purchase,
    typeof PurchaseDetails.prototype.id
  >

  constructor(
    @inject('datasources.postgres') dataSource: PostgresDataSource,
    @repository.getter('ProductRepository')
    protected productRepositoryGetter: Getter<ProductRepository>,
    @repository.getter('PersonRepository')
    protected personRepositoryGetter: Getter<PersonRepository>,
    @repository.getter('PurchaseRepository')
    protected purchaseRepositoryGetter: Getter<PurchaseRepository>,
    // @inject('datasources.sqlserver') dataSource: SqlserverDataSource,
  ) {
    super(PurchaseDetails, dataSource)
    this.purchase = this.createBelongsToAccessorFor(
      'purchase',
      purchaseRepositoryGetter,
    )
    this.registerInclusionResolver('purchase', this.purchase.inclusionResolver)
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
