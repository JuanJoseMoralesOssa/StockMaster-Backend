import {inject, lifeCycleObserver, LifeCycleObserver} from '@loopback/core';
import {juggler} from '@loopback/repository';

const config = {
  name: 'mysql',
  connector: 'mysql',
  url: '',
  // db-inventario-julian.cpwymi2eezt9.us-east-2.rds.amazonaws.com
  host: 'servermysqljulianinv.mysql.database.azure.com',
  port: 3306,
  // Julian_Inv_admin
  user: 'Julian_Inv_admin',
  // Maestrotario123GMRfRkbWFm6tc8a
  password: 'Maestrotario123GMRfRkbWFm6tc8a',
  database: 'inventory_julian_db',
  ssl: {rejectUnauthorized: true},
};

// Observe application's life cycle to disconnect the datasource when
// application is stopped. This allows the application to be shut down
// gracefully. The `stop()` method is inherited from `juggler.DataSource`.
// Learn more at https://loopback.io/doc/en/lb4/Life-cycle.html
@lifeCycleObserver('datasource')
export class MysqlDataSource
  extends juggler.DataSource
  implements LifeCycleObserver
{
  static dataSourceName = 'mysql';
  static readonly defaultConfig = config;

  constructor(
    @inject('datasources.config.mysql', {optional: true})
    dsConfig: object = config,
  ) {
    super(dsConfig);
  }
}
