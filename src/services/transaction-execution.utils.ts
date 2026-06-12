import { HttpErrors } from '@loopback/rest'
import {
  DataSourceWithTransactions,
  TransactionOptions,
} from './transaction.types'

export async function runInTransaction<T>(
  dataSource: DataSourceWithTransactions,
  work: (tx: TransactionOptions) => Promise<T>,
): Promise<T> {
  if (typeof dataSource.beginTransaction !== 'function') {
    throw new HttpErrors.InternalServerError(
      'DataSource does not support transactions',
    )
  }

  const transaction = await dataSource.beginTransaction({
    isolationLevel: 'READ COMMITTED',
  })
  try {
    const result = await work({ transaction })
    await transaction.commit()
    return result
  } catch (error) {
    await transaction.rollback()
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
