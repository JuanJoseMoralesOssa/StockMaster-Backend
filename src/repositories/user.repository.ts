import {inject} from '@loopback/core'
import {DefaultCrudRepository} from '@loopback/repository'
import {PostgresDataSource} from '../datasources'
// import {SqlserverDataSource} from '../datasources';
import {User, UserRelations} from '../models'

export class UserRepository extends DefaultCrudRepository<
  User,
  typeof User.prototype.id,
  UserRelations
> {
  constructor(
    @inject('datasources.postgres') dataSource: PostgresDataSource,
    // @inject('datasources.sqlserver') dataSource: SqlserverDataSource,
  ) {
    super(User, dataSource)
  }
}
