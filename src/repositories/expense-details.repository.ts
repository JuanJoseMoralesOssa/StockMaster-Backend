import {inject, Getter} from '@loopback/core';
import {DefaultCrudRepository, repository, BelongsToAccessor} from '@loopback/repository';
import {MysqlDataSource} from '../datasources';
// import {SqlserverDataSource} from '../datasources';
import {ExpenseDetails, ExpenseDetailsRelations, Product, Person, Expense} from '../models';
import {ProductRepository} from './product.repository';
import {PersonRepository} from './person.repository';
import {ExpenseRepository} from './expense.repository';

export class ExpenseDetailsRepository extends DefaultCrudRepository<
  ExpenseDetails,
  typeof ExpenseDetails.prototype.id,
  ExpenseDetailsRelations
> {

  public readonly product: BelongsToAccessor<Product, typeof ExpenseDetails.prototype.id>;

  public readonly person: BelongsToAccessor<Person, typeof ExpenseDetails.prototype.id>;

  public readonly expense: BelongsToAccessor<Expense, typeof ExpenseDetails.prototype.id>;

  constructor(
    @inject('datasources.mysql') dataSource: MysqlDataSource, @repository.getter('ProductRepository') protected productRepositoryGetter: Getter<ProductRepository>, @repository.getter('PersonRepository') protected personRepositoryGetter: Getter<PersonRepository>, @repository.getter('ExpenseRepository') protected expenseRepositoryGetter: Getter<ExpenseRepository>,
    // @inject('datasources.sqlserver') dataSource: SqlserverDataSource,
  ) {
    super(ExpenseDetails, dataSource);
    this.expense = this.createBelongsToAccessorFor('expense', expenseRepositoryGetter,);
    this.registerInclusionResolver('expense', this.expense.inclusionResolver);
    this.person = this.createBelongsToAccessorFor('person', personRepositoryGetter,);
    this.registerInclusionResolver('person', this.person.inclusionResolver);
    this.product = this.createBelongsToAccessorFor('product', productRepositoryGetter,);
    this.registerInclusionResolver('product', this.product.inclusionResolver);
  }
}
