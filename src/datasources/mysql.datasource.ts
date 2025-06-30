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
    securityConfig.SSL_CERT_PATH, // From environment variable
  ].filter(Boolean); // Remove empty strings

  for (const certPath of possiblePaths) {
    if (fs.existsSync(certPath)) {
      console.log(`Using SSL certificate from: ${certPath}`);
      return certPath;
    }
  }

  console.warn(`SSL certificate file not found. Searched in: ${possiblePaths.join(', ')}`);
  console.warn('Continuing without SSL certificate file - Azure MySQL may still work with default SSL settings');
  return '';
}

const config = {
  name: 'mysql',
  connector: 'mysql',
  host: securityConfig.HOST || 'mysql-jm-inv.mysql.database.azure.com',
  port: securityConfig.PORT || 3306,
  user: securityConfig.USER || 'bbjbzdifjkMaestraioAdmin',
  password: securityConfig.PASSWORD || 'Maestrotario1234GMRfRkbWFm6tc8a288@95@6n9iWAK3',
  database: securityConfig.DATABASE || 'jm_inv_db',

  // SSL configuration for Azure MySQL
  ssl: {
    rejectUnauthorized: false, // Set to false for Azure MySQL
    ca: getCertificatePath() ? fs.readFileSync(getCertificatePath()).toString() : undefined,
  },

  // LoopBack MySQL connector specific options
  connectionLimit: 10,
  debug: false,

  // Valid MySQL2 options only
  connectTimeout: 60000,
  multipleStatements: false,
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
