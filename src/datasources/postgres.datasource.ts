import { inject, lifeCycleObserver, LifeCycleObserver } from '@loopback/core'
import { juggler } from '@loopback/repository'
import net from 'net'
import { databaseConfig } from '../config/database'

// Node >= 20 races IPv6/IPv4 connections ("Happy Eyeballs") with a 250ms
// per-address attempt timeout. Against a remote TLS Postgres endpoint, any
// event-loop pressure pushes the handshake past 250ms, aborting EVERY attempt
// and surfacing as spurious AggregateError connection failures. Give each
// attempt a realistic budget.
if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
  net.setDefaultAutoSelectFamilyAttemptTimeout(
    Number(process.env.NET_FAMILY_ATTEMPT_TIMEOUT_MS ?? 3000),
  )
}

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
  // Pool tuning. The default pg pool (max 10, connections held until process
  // exit) overwhelms serverless poolers (Neon) when several App instances
  // share one process — e.g. the acceptance test run — because nothing ever
  // released the sockets. Keep the pool small and let idle sockets close.
  min: Number(process.env.BD_POOL_MIN ?? 0),
  max: Number(process.env.BD_POOL_MAX ?? 5),
  idleTimeoutMillis: Number(process.env.BD_POOL_IDLE_TIMEOUT ?? 30000),
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
    // The DataSource is an EventEmitter: without an 'error' listener, a
    // refused connection attempt (serverless endpoint waking up / throttling)
    // becomes an UNCAUGHT exception instead of a retryable failure.
    this.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[postgres datasource] connection error:', message)
    })
  }

  /**
   * Connect eagerly at boot. Serverless Postgres (Neon) suspends idle
   * endpoints; the wake-up takes several seconds, during which connection
   * attempts are refused at the TCP level. With lazy connections that
   * refusal surfaces mid-request as an UNCAUGHT socket AggregateError.
   *
   * NOTE: juggler's connect() promise is unreliable here — it can stay
   * pending even after the datasource reports `connected: true` — so this
   * fires connect() without awaiting it and polls the `connected` flag with
   * a deadline that comfortably exceeds the observed ~5s cold start.
   */
  async start(): Promise<void> {
    const deadline =
      Date.now() + Number(process.env.BD_CONNECT_TIMEOUT_MS ?? 30000)

    this.connect().catch(() => undefined)
    while (!this.connected) {
      if (Date.now() > deadline) {
        throw new Error(
          'Could not connect to PostgreSQL before the startup deadline.',
        )
      }
      await new Promise(resolve => setTimeout(resolve, 250))
      const connecting = (this as { connecting?: boolean }).connecting
      if (!this.connected && !connecting) {
        // Previous attempt was refused (endpoint still waking) — retry.
        this.connect().catch(() => undefined)
      }
    }
    this.attachPoolErrorHandler()
  }

  /**
   * Release the connection pool when the application stops. Without this,
   * every stopped App instance (each acceptance suite boots one) leaks its
   * pool until process exit and the database starts refusing connections.
   */
  async stop(): Promise<void> {
    await this.disconnect()
  }

  /**
   * node-postgres requires an 'error' listener on the pool: a dropped idle
   * client otherwise raises an uncaught exception and kills the process
   * (or, under mocha, fails whichever test happens to be running).
   */
  private attachPoolErrorHandler(): void {
    const pool = (
      this.connector as
        | { pg?: { on(event: 'error', cb: (err: Error) => void): void } }
        | undefined
    )?.pg
    pool?.on('error', err => {
      console.error('[postgres pool] idle client error:', err.message)
    })
  }
}
