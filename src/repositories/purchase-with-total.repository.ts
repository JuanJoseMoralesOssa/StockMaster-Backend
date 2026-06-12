import { Getter, inject } from '@loopback/core'
import { HasManyRepositoryFactory, repository } from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import {
  PurchaseDetails,
  PurchaseWithTotal,
  PurchaseWithTotalRelations,
} from '../models'
import { DocumentRepositoryBase } from './document-repository.base'
import { findFilteredDocuments } from './document-filter.utils'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'
import { PurchaseDetailsRepository } from './purchase-details.repository'

export class PurchaseWithTotalRepository extends DocumentRepositoryBase<
  PurchaseWithTotal,
  typeof PurchaseWithTotal.prototype.id,
  PurchaseWithTotalRelations,
  PurchaseDetails,
  typeof PurchaseDetails.prototype.id
> {
  public readonly purchase_details: HasManyRepositoryFactory<
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
    super(
      PurchaseWithTotal,
      dataSource,
      'purchase_details',
      purchaseDetailsRepositoryGetter,
      personRepositoryGetter,
      productRepositoryGetter,
    )
    this.purchase_details = this.detailsFactory
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
