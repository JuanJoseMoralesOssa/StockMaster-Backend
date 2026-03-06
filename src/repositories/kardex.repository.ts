import { Getter, inject } from '@loopback/core'
import {
  BelongsToAccessor,
  DefaultCrudRepository,
  repository,
} from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
// import {SqlserverDataSource} from '../datasources';
import { Kardex, KardexRelations, Product } from '../models'
import { ProductRepository } from './product.repository'

export class KardexRepository extends DefaultCrudRepository<
  Kardex,
  typeof Kardex.prototype.id,
  KardexRelations
> {
  public readonly product: BelongsToAccessor<
    Product,
    typeof Kardex.prototype.id
  >

  constructor(
    @inject('datasources.postgres') dataSource: PostgresDataSource,
    // @inject('datasources.sqlserver') dataSource: SqlserverDataSource,
    @repository.getter('ProductRepository')
    protected productRepositoryGetter: Getter<ProductRepository>,
  ) {
    super(Kardex, dataSource)
    this.product = this.createBelongsToAccessorFor(
      'product',
      productRepositoryGetter,
    )
    this.registerInclusionResolver('product', this.product.inclusionResolver)
  }
}
