import { Getter, inject } from '@loopback/core'
import { HasManyRepositoryFactory, repository } from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import { Purchase, PurchaseDetails, PurchaseRelations } from '../models'
import { DocumentRepositoryBase } from './document-repository.base'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'
import { PurchaseDetailsRepository } from './purchase-details.repository'

export class PurchaseRepository extends DocumentRepositoryBase<
  Purchase,
  typeof Purchase.prototype.id,
  PurchaseRelations,
  PurchaseDetails,
  typeof PurchaseDetails.prototype.id
> {
  public readonly purchase_details: HasManyRepositoryFactory<
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
    super(
      Purchase,
      dataSource,
      'purchase_details',
      purchaseDetailsRepositoryGetter,
      personRepositoryGetter,
      productRepositoryGetter,
    )
    this.purchase_details = this.detailsFactory
  }
}
