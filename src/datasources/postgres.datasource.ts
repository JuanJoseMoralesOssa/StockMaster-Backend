import { inject, lifeCycleObserver, LifeCycleObserver } from '@loopback/core'
import { juggler } from '@loopback/repository'
import { securityConfig } from '../config/security'

const config = {
  name: 'postgres',
  connector: 'postgresql',
  url: process.env.BD_URL,
  host: process.env.BD_HOST ?? securityConfig.HOST,
  port: Number(process.env.BD_PORT ?? securityConfig.PORT),
  user: process.env.BD_USER ?? securityConfig.USER,
  password: process.env.BD_PASSWORD ?? securityConfig.PASSWORD,
  database: process.env.BD_DATABASE ?? securityConfig.DATABASE,
  connectionTimeout: Number(process.env.BD_CONNECTION_TIMEOUT ?? 30000),
}

// Observe application's life cycle to disconnect the datasource when
// application is stopped. This allows the application to be shut down
// gracefully. The `stop()` method is inherited from `juggler.DataSource`.
// Learn more at https://loopback.io/doc/en/lb4/Life-cycle.html
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
