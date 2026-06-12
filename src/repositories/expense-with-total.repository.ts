import { Getter, inject } from '@loopback/core'
import { HasManyRepositoryFactory, repository } from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import {
  ExpenseDetails,
  ExpenseWithTotal,
  ExpenseWithTotalRelations,
} from '../models'
import { DocumentRepositoryBase } from './document-repository.base'
import { findFilteredDocuments } from './document-filter.utils'
import { ExpenseDetailsRepository } from './expense-details.repository'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'

export class ExpenseWithTotalRepository extends DocumentRepositoryBase<
  ExpenseWithTotal,
  typeof ExpenseWithTotal.prototype.id,
  ExpenseWithTotalRelations,
  ExpenseDetails,
  typeof ExpenseDetails.prototype.id
> {
  public readonly expense_details: HasManyRepositoryFactory<
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
    super(
      ExpenseWithTotal,
      dataSource,
      'expense_details',
      expenseDetailsRepositoryGetter,
      personRepositoryGetter,
      productRepositoryGetter,
    )
    this.expense_details = this.detailsFactory
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
