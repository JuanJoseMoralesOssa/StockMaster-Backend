import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {MysqlDataSource} from '../datasources';
// import {SqlserverDataSource} from '../datasources';
import {User, UserRelations} from '../models';

export class UserRepository extends DefaultCrudRepository<
  User,
  typeof User.prototype.id,
  UserRelations
> {
  constructor(
    @inject('datasources.mysql') dataSource: MysqlDataSource,
    // @inject('datasources.sqlserver') dataSource: SqlserverDataSource,
  ) {
    super(User, dataSource);
  }
}
