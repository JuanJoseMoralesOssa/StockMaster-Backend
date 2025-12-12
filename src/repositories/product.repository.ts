import { Getter, inject } from '@loopback/core'
import {
  DefaultCrudRepository,
  HasManyRepositoryFactory,
  HasManyThroughRepositoryFactory,
  repository,
} from '@loopback/repository'
import { MysqlDataSource } from '../datasources'
// import {SqlserverDataSource} from '../datasources';
import {
  Expense,
  ExpenseDetails,
  Kardex,
  Person,
  Product,
  ProductRelations,
  Purchase,
  PurchaseDetails,
} from '../models'
import { ExpenseDetailsRepository } from './expense-details.repository'
import { ExpenseRepository } from './expense.repository'
import { KardexRepository } from './kardex.repository'
import { PersonRepository } from './person.repository'
import { PurchaseDetailsRepository } from './purchase-details.repository'
import { PurchaseRepository } from './purchase.repository'

export class ProductRepository extends DefaultCrudRepository<
  Product,
  typeof Product.prototype.id,
  ProductRelations
> {
  public readonly people_expense_details: HasManyThroughRepositoryFactory<
    Person,
    typeof Person.prototype.id,
    ExpenseDetails,
    typeof Product.prototype.id
  >

  public readonly people_purchase_details: HasManyThroughRepositoryFactory<
    Person,
    typeof Person.prototype.id,
    PurchaseDetails,
    typeof Product.prototype.id
  >

  public readonly kardexes: HasManyRepositoryFactory<
    Kardex,
    typeof Product.prototype.id
  >

  public readonly purchases: HasManyThroughRepositoryFactory<
    Purchase,
    typeof Purchase.prototype.id,
    PurchaseDetails,
    typeof Product.prototype.id
  >

  public readonly expenses: HasManyThroughRepositoryFactory<
    Expense,
    typeof Expense.prototype.id,
    ExpenseDetails,
    typeof Product.prototype.id
  >

  constructor(
    @inject('datasources.mysql') dataSource: MysqlDataSource,
    // @inject('datasources.sqlserver') dataSource: SqlserverDataSource,
    @repository.getter('ExpenseDetailsRepository')
    protected expenseDetailsRepositoryGetter: Getter<ExpenseDetailsRepository>,
    @repository.getter('PersonRepository')
    protected personRepositoryGetter: Getter<PersonRepository>,
    @repository.getter('PurchaseDetailsRepository')
    protected purchaseDetailsRepositoryGetter: Getter<PurchaseDetailsRepository>,
    @repository.getter('KardexRepository')
    protected kardexRepositoryGetter: Getter<KardexRepository>,
    @repository.getter('PurchaseRepository')
    protected purchaseRepositoryGetter: Getter<PurchaseRepository>,
    @repository.getter('ExpenseRepository')
    protected expenseRepositoryGetter: Getter<ExpenseRepository>,
  ) {
    super(Product, dataSource)
    this.expenses = this.createHasManyThroughRepositoryFactoryFor(
      'expenses',
      expenseRepositoryGetter,
      expenseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver('expenses', this.expenses.inclusionResolver)
    this.purchases = this.createHasManyThroughRepositoryFactoryFor(
      'purchases',
      purchaseRepositoryGetter,
      purchaseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver(
      'purchases',
      this.purchases.inclusionResolver,
    )
    this.kardexes = this.createHasManyRepositoryFactoryFor(
      'kardexes',
      kardexRepositoryGetter,
    )
    this.registerInclusionResolver('kardexes', this.kardexes.inclusionResolver)
    this.people_purchase_details =
      this.createHasManyThroughRepositoryFactoryFor(
        'people_purchase_details',
        personRepositoryGetter,
        purchaseDetailsRepositoryGetter,
      )
    this.registerInclusionResolver(
      'people_purchase_details',
      this.people_purchase_details.inclusionResolver,
    )
    this.people_expense_details = this.createHasManyThroughRepositoryFactoryFor(
      'people_expense_details',
      personRepositoryGetter,
      expenseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver(
      'people_expense_details',
      this.people_expense_details.inclusionResolver,
    )
  }
}
