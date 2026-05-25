import { inject, lifeCycleObserver, LifeCycleObserver } from '@loopback/core'
import { juggler } from '@loopback/repository'
import { databaseConfig } from '../config/database'

const config = {
  name: 'postgres',
  connector: 'postgresql',
  url: databaseConfig.url,
  host: databaseConfig.host,
  port: databaseConfig.port,
  user: databaseConfig.user,
  password: databaseConfig.password,
  database: databaseConfig.database,
  connectionTimeout: Number(process.env.BD_CONNECTION_TIMEOUT ?? 30000),
}

@lifeCycleObserver('datasource')
export class PostgresDataSource
  extends juggler.DataSource
  implements LifeCycleObserver
{
  static dataSourceName = 'postgres'
  static readonly defaultConfig = config

  constructor(
    @inject('datasources.config.postgres', { optional: true })
    dsConfig: object = config,
  ) {
    super(dsConfig)
  }
}
