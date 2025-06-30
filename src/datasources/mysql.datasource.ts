import {inject, lifeCycleObserver, LifeCycleObserver} from '@loopback/core';
import {juggler} from '@loopback/repository';
import * as fs from 'fs';
import * as path from 'path';
import {securityConfig} from '../config/security';

require('dotenv').config();

// Function to find the SSL certificate file
function getCertificatePath(): string {
  const possiblePaths = [
    path.resolve(process.cwd(), 'src/certs/DigiCertGlobalRootCA.crt.pem'), // Development
    path.resolve(process.cwd(), 'dist/certs/DigiCertGlobalRootCA.crt.pem'), // Production (if copied)
    path.resolve(__dirname, '../certs/DigiCertGlobalRootCA.crt.pem'), // Relative to compiled file
    path.resolve(__dirname, '../../src/certs/DigiCertGlobalRootCA.crt.pem'), // From dist back to src
  ];

  for (const certPath of possiblePaths) {
    if (fs.existsSync(certPath)) {
      return certPath;
    }
  }

  throw new Error(`SSL certificate file not found. Searched in: ${possiblePaths.join(', ')}`);
}

const config = {
  name: 'mysql',
  connector: 'mysql',
  host: securityConfig.HOST || 'mysql-jm-inv.mysql.database.azure.com',
  port: securityConfig.PORT || 3306,
  user: securityConfig.USER || 'bbjbzdifjkMaestraioAdmin',
  password: 'Maestrotario1234GMRfRkbWFm6tc8a288@95@6n9iWAK3',
  database:'jm_inv_db',

  // Configuración SSL requerida para Azure Database for MySQL
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync(getCertificatePath()).toString(),
  },

  // Configuraciones adicionales para Azure Database
  acquireConnectionTimeout: 60000,
  timeout: 60000,
  reconnect: true,

  // Configuraciones específicas para el conector MySQL
  connectionLimit: 10,
  multipleStatements: false,

  // Configuración de timezone para evitar problemas de zona horaria
  timezone: 'Z',

  // Configuraciones adicionales para Azure
  supportBigNumbers: true,
  bigNumberStrings: true,
  dateStrings: false,
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
  static readonly dataSourceName = 'mysql';
  static readonly defaultConfig = config;

  constructor(
    @inject('datasources.config.mysql', {optional: true})
    dsConfig: object = config,
  ) {
    super(dsConfig);
  }
}
