import { Getter, inject } from '@loopback/core'
import {
  DefaultCrudRepository,
  HasManyThroughRepositoryFactory,
  repository,
} from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import {
  Expense,
  ExpenseDetails,
  Person,
  PersonRelations,
  Product,
  Purchase,
  PurchaseDetails,
} from '../models'
import { ExpenseDetailsRepository } from './expense-details.repository'
import { ExpenseRepository } from './expense.repository'
import { ProductRepository } from './product.repository'
import { PurchaseDetailsRepository } from './purchase-details.repository'
import { PurchaseRepository } from './purchase.repository'

export class PersonRepository extends DefaultCrudRepository<
  Person,
  typeof Person.prototype.id,
  PersonRelations
> {
  public readonly products_expense_details: HasManyThroughRepositoryFactory<
    Product,
    typeof Product.prototype.id,
    ExpenseDetails,
    typeof Person.prototype.id
  >

  public readonly products_purchase_details: HasManyThroughRepositoryFactory<
    Product,
    typeof Product.prototype.id,
    PurchaseDetails,
    typeof Person.prototype.id
  >

  public readonly expenses: HasManyThroughRepositoryFactory<
    Expense,
    typeof Expense.prototype.id,
    ExpenseDetails,
    typeof Person.prototype.id
  >

  public readonly purchases: HasManyThroughRepositoryFactory<
    Purchase,
    typeof Purchase.prototype.id,
    PurchaseDetails,
    typeof Person.prototype.id
  >

  constructor(
    @inject('datasources.postgres') dataSource: PostgresDataSource,
    @repository.getter('ExpenseDetailsRepository')
    protected expenseDetailsRepositoryGetter: Getter<ExpenseDetailsRepository>,
    @repository.getter('ProductRepository')
    protected productRepositoryGetter: Getter<ProductRepository>,
    @repository.getter('PurchaseDetailsRepository')
    protected purchaseDetailsRepositoryGetter: Getter<PurchaseDetailsRepository>,
    @repository.getter('ExpenseRepository')
    protected expenseRepositoryGetter: Getter<ExpenseRepository>,
    @repository.getter('PurchaseRepository')
    protected purchaseRepositoryGetter: Getter<PurchaseRepository>,
  ) {
    super(Person, dataSource)
    this.purchases = this.createHasManyThroughRepositoryFactoryFor(
      'purchases',
      purchaseRepositoryGetter,
      purchaseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver(
      'purchases',
      this.purchases.inclusionResolver,
    )
    this.expenses = this.createHasManyThroughRepositoryFactoryFor(
      'expenses',
      expenseRepositoryGetter,
      expenseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver('expenses', this.expenses.inclusionResolver)
    this.products_purchase_details =
      this.createHasManyThroughRepositoryFactoryFor(
        'products_purchase_details',
        productRepositoryGetter,
        purchaseDetailsRepositoryGetter,
      )
    this.registerInclusionResolver(
      'products_purchase_details',
      this.products_purchase_details.inclusionResolver,
    )
    this.products_expense_details =
      this.createHasManyThroughRepositoryFactoryFor(
        'products_expense_details',
        productRepositoryGetter,
        expenseDetailsRepositoryGetter,
      )
    this.registerInclusionResolver(
      'products_expense_details',
      this.products_expense_details.inclusionResolver,
    )
  }
}
