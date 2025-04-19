import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {MysqlDataSource} from '../datasources';
// import {SqlserverDataSource} from '../datasources';
import {ExpenseDetails, ExpenseDetailsRelations} from '../models';

export class ExpenseDetailsRepository extends DefaultCrudRepository<
  ExpenseDetails,
  typeof ExpenseDetails.prototype.id,
  ExpenseDetailsRelations
> {
  constructor(
    @inject('datasources.mysql') dataSource: MysqlDataSource
    // @inject('datasources.sqlserver') dataSource: SqlserverDataSource,
  ) {
    super(ExpenseDetails, dataSource);
  }
}
