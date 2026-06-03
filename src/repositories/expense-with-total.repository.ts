import { Getter, inject } from '@loopback/core'
import {
  DefaultCrudRepository,
  HasManyRepositoryFactory,
  HasManyThroughRepositoryFactory,
  repository,
} from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import {
  ExpenseDetails,
  ExpenseWithTotal,
  ExpenseWithTotalRelations,
  Person,
  Product,
} from '../models'
import { findFilteredDocuments } from './document-filter.utils'
import { ExpenseDetailsRepository } from './expense-details.repository'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'

export class ExpenseWithTotalRepository extends DefaultCrudRepository<
  ExpenseWithTotal,
  typeof ExpenseWithTotal.prototype.id,
  ExpenseWithTotalRelations
> {
  public readonly expense_details: HasManyRepositoryFactory<
    ExpenseDetails,
    typeof ExpenseWithTotal.prototype.id
  >

  public readonly people: HasManyThroughRepositoryFactory<
    Person,
    typeof Person.prototype.id,
    ExpenseDetails,
    typeof ExpenseWithTotal.prototype.id
  >

  public readonly products: HasManyThroughRepositoryFactory<
    Product,
    typeof Product.prototype.id,
    ExpenseDetails,
    typeof ExpenseWithTotal.prototype.id
  >

  constructor(
    @inject('datasources.postgres') dataSource: PostgresDataSource,
    @repository.getter('ExpenseDetailsRepository')
    protected expenseDetailsRepositoryGetter: Getter<ExpenseDetailsRepository>,
    @repository.getter('PersonRepository')
    protected personRepositoryGetter: Getter<PersonRepository>,
    @repository.getter('ProductRepository')
    protected productRepositoryGetter: Getter<ProductRepository>,
  ) {
    super(ExpenseWithTotal, dataSource)
    this.products = this.createHasManyThroughRepositoryFactoryFor(
      'products',
      productRepositoryGetter,
      expenseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver('products', this.products.inclusionResolver)
    this.people = this.createHasManyThroughRepositoryFactoryFor(
      'people',
      personRepositoryGetter,
      expenseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver('people', this.people.inclusionResolver)
    this.expense_details = this.createHasManyRepositoryFactoryFor(
      'expense_details',
      expenseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver(
      'expense_details',
      this.expense_details.inclusionResolver,
    )
  }

  async findFilteredExpenses(
    startDate?: string,
    endDate?: string,
    personId?: number,
    productId?: number,
    page?: number,
    limit?: number,
  ): Promise<{ data: ExpenseWithTotal[]; count: number }> {
    return findFilteredDocuments<ExpenseWithTotal>(
      this,
      'expense_details',
      async detailWhere => {
        const repo = await this.expenseDetailsRepositoryGetter()
        const matching = await repo.find({
          where: detailWhere,
          fields: ['expenseId'],
        })
        return [...new Set(matching.map(d => d.expenseId))]
      },
      { startDate, endDate, personId, productId, page, limit },
    )
  }
}
