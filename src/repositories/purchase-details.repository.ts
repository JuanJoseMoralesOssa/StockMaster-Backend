import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {MysqlDataSource} from '../datasources';
// import {SqlserverDataSource} from '../datasources';
import {PurchaseDetails, PurchaseDetailsRelations} from '../models';

export class PurchaseDetailsRepository extends DefaultCrudRepository<
  PurchaseDetails,
  typeof PurchaseDetails.prototype.id,
  PurchaseDetailsRelations
> {
  constructor(
    @inject('datasources.mysql') dataSource: MysqlDataSource,
    // @inject('datasources.sqlserver') dataSource: SqlserverDataSource,
  ) {
    super(PurchaseDetails, dataSource);
  }
}
