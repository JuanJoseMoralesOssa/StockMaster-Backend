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
  PurchaseDetails,
  PurchaseWithTotal,
  PurchaseWithTotalRelations,
} from '../models'
import { findFilteredDocuments } from './document-filter.utils'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'
import { PurchaseDetailsRepository } from './purchase-details.repository'

export class PurchaseWithTotalRepository extends DefaultCrudRepository<
  PurchaseWithTotal,
  typeof PurchaseWithTotal.prototype.id,
  PurchaseWithTotalRelations
> {
  public readonly purchase_details: HasManyRepositoryFactory<
    PurchaseDetails,
    typeof PurchaseWithTotal.prototype.id
  >

  public readonly people: HasManyThroughRepositoryFactory<
    Person,
    typeof Person.prototype.id,
    PurchaseDetails,
    typeof PurchaseWithTotal.prototype.id
  >

  public readonly products: HasManyThroughRepositoryFactory<
    Product,
    typeof Product.prototype.id,
    PurchaseDetails,
    typeof PurchaseWithTotal.prototype.id
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
    super(PurchaseWithTotal, dataSource)
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

  async findFilteredPurchases(
    startDate?: string,
    endDate?: string,
    personId?: number,
    productId?: number,
    page?: number,
    limit?: number,
  ): Promise<{ data: PurchaseWithTotal[]; count: number }> {
    return findFilteredDocuments<PurchaseWithTotal>(
      this,
      'purchase_details',
      async detailWhere => {
        const repo = await this.purchaseDetailsRepositoryGetter()
        const matching = await repo.find({
          where: detailWhere,
          fields: ['purchaseId'],
        })
        return [...new Set(matching.map(d => d.purchaseId))]
      },
      { startDate, endDate, personId, productId, page, limit },
    )
  }
}
