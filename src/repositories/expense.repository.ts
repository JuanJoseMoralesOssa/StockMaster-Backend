import { Getter, inject } from '@loopback/core'
import { HasManyRepositoryFactory, repository } from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import { Expense, ExpenseDetails, ExpenseRelations } from '../models'
import { DocumentRepositoryBase } from './document-repository.base'
import { ExpenseDetailsRepository } from './expense-details.repository'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'

export class ExpenseRepository extends DocumentRepositoryBase<
  Expense,
  typeof Expense.prototype.id,
  ExpenseRelations,
  ExpenseDetails,
  typeof ExpenseDetails.prototype.id
> {
  public readonly expense_details: HasManyRepositoryFactory<
    ExpenseDetails,
    typeof Expense.prototype.id
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
      Expense,
      dataSource,
      'expense_details',
      expenseDetailsRepositoryGetter,
      personRepositoryGetter,
      productRepositoryGetter,
    )
    this.expense_details = this.detailsFactory
  }
}
