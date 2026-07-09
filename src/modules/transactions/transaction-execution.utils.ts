import {
  DataSourceWithTransactions,
  TransactionOptions,
} from './transaction.types'

export async function runInTransaction<T>(
  dataSource: DataSourceWithTransactions,
  work: (tx: TransactionOptions) => Promise<T>,
): Promise<T> {
  if (typeof dataSource.beginTransaction !== 'function') {
    // Internal invariant: the Postgres datasource always supports transactions.
    // A miss is a wiring bug, so let it surface as a 500 via the interceptor.
    throw new Error('DataSource does not support transactions')
  }

  const transaction = await dataSource.beginTransaction({
    isolationLevel: 'READ COMMITTED',
  })
  try {
    const result = await work({ transaction })
    await transaction.commit()
    return result
  } catch (error) {
    // Guard the rollback so its own failure (e.g. a Neon connection dropped
    // mid-transaction) cannot REPLACE the meaningful error the caller raised.
    // Without this, a 409 version conflict surfaces to the client as an opaque
    // 500 because the rollback rejection — not `error` — is what propagates.
    try {
      await transaction.rollback()
    } catch (rollbackError) {
      console.error('[tx] rollback failed', rollbackError)
    }
    throw error
  }
}

export function extractRows(result: unknown): unknown[] {
  if (Array.isArray(result)) {
    return result
  }

  const rows = (result as { rows?: unknown })?.rows
  return Array.isArray(rows) ? rows : []
}
