import { Getter } from '@loopback/core'
import {
  DefaultCrudRepository,
  Entity,
  EntityCrudRepository,
  HasManyRepositoryFactory,
  HasManyThroughRepositoryFactory,
  juggler,
} from '@loopback/repository'
import { Person, Product } from '../models'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'

/**
 * Shared relation wiring for transaction-document repositories.
 *
 * Purchase/Payment and their WithTotal read twins all expose the same three
 * relations (details, people-through-details, products-through-details).
 * Wiring them here once means a new relation is added in one place instead of
 * drifting between a base repository and its WithTotal twin.
 */
export abstract class DocumentRepositoryBase<
  T extends Entity,
  ID,
  Relations extends object,
  TDetail extends Entity,
  DetailID,
> extends DefaultCrudRepository<T, ID, Relations> {
  public readonly people: HasManyThroughRepositoryFactory<
    Person,
    typeof Person.prototype.id,
    TDetail,
    ID
  >

  public readonly products: HasManyThroughRepositoryFactory<
    Product,
    typeof Product.prototype.id,
    TDetail,
    ID
  >

  /** Exposed by subclasses under the model's relation name. */
  protected readonly detailsFactory: HasManyRepositoryFactory<TDetail, ID>

  protected constructor(
    entityClass: typeof Entity & { prototype: T },
    dataSource: juggler.DataSource,
    detailRelationName: string,
    detailRepositoryGetter: Getter<EntityCrudRepository<TDetail, DetailID>>,
    personRepositoryGetter: Getter<PersonRepository>,
    productRepositoryGetter: Getter<ProductRepository>,
  ) {
    super(entityClass, dataSource)

    this.products = this.createHasManyThroughRepositoryFactoryFor(
      'products',
      productRepositoryGetter,
      detailRepositoryGetter,
    )
    this.registerInclusionResolver('products', this.products.inclusionResolver)

    this.people = this.createHasManyThroughRepositoryFactoryFor(
      'people',
      personRepositoryGetter,
      detailRepositoryGetter,
    )
    this.registerInclusionResolver('people', this.people.inclusionResolver)

    this.detailsFactory = this.createHasManyRepositoryFactoryFor(
      detailRelationName,
      detailRepositoryGetter,
    )
    this.registerInclusionResolver(
      detailRelationName,
      this.detailsFactory.inclusionResolver,
    )
  }
}
