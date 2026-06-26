import { transactionNotFoundError, versionConflictError } from '../errors'
import {
  DataSourceWithTransactions,
  TransactionOptions,
} from './transaction.types'
import { extractRows } from './transaction-execution.utils'
import { requireVersion } from './optimistic-lock.utils'
import { TransactionKind } from './transaction-kind.enum'
import {
  DETAIL_COLUMNS,
  TRANSACTION_CONFIG,
  UPDATABLE_PARENT_FIELDS,
} from './transaction-type.const'

/** Wraps the raw-SQL batch operations for a specific detail table. */
export class TransactionDetailsSqlHelper {
  private readonly tableName: string
  private readonly parentTableName: string

  constructor(
    private readonly dataSource: DataSourceWithTransactions,
    transactionKind: TransactionKind,
  ) {
    const config = TRANSACTION_CONFIG[transactionKind]
    if (!config) {
      // Unreachable: TransactionKind is a closed enum. A miss here is an
      // internal wiring bug, not client input, so surface it as a 500.
      throw new Error(`Unsupported transaction kind: ${transactionKind}`)
    }
    this.tableName = config.detailTable
    this.parentTableName = config.parentTable
  }

  /**
   * Atomically locks the parent row and verifies the expected version in a
   * single round-trip (SELECT ... FOR UPDATE). A concurrent caller blocks until
   * this transaction commits, preventing the lost-update the version field
   * is designed to guard against.
   *
   * The expected version is mandatory — every caller must carry the
   * optimistic-lock token. Throws 400 if it is missing/invalid, 404 if the
   * row does not exist, 409 if the version has changed.
   */
  async lockParentRow(
    id: number,
    expectedVersion: number,
    options?: TransactionOptions,
  ): Promise<void> {
    requireVersion(expectedVersion, 'version')

    const result = await this.dataSource.execute(
      `SELECT id, version FROM ${this.parentTableName} WHERE id = $1 FOR UPDATE`,
      [id],
      options,
    )
    const rows = extractRows(result) as { id: number; version: number }[]
    if (!Array.isArray(rows) || rows.length === 0) {
      throw transactionNotFoundError(this.parentTableName, id)
    }
    if (Number(rows[0].version) !== expectedVersion) {
      throw versionConflictError()
    }
  }

  async bumpParentVersion(
    id: number,
    expectedVersion: number,
    options?: TransactionOptions,
  ): Promise<void> {
    const result = await this.dataSource.execute(
      `UPDATE ${this.parentTableName} SET version = version + 1 WHERE id = $1 AND version = $2 RETURNING id`,
      [id, expectedVersion],
      options,
    )
    await this.assertMatchedParentVersion(result, id, options)
  }

  async updateParentWithVersionCheck(
    id: number,
    expectedVersion: number,
    data: Record<string, unknown>,
    nextVersion: number,
    options?: TransactionOptions,
  ): Promise<void> {
    const entries = Object.entries(data).filter(
      ([, value]) => value !== undefined,
    )
    for (const [key] of entries) {
      if (!(UPDATABLE_PARENT_FIELDS as readonly string[]).includes(key)) {
        // Unreachable from the HTTP path: buildParentUpdatePayload only forwards
        // whitelisted fields. A hit here is an internal bug, hence a 500.
        throw new Error(`Unsupported parent transaction field: ${key}`)
      }
    }

    const assignments = entries.map(([key], index) => `${key} = $${index + 1}`)
    assignments.push(`version = $${entries.length + 1}`)

    const params = [
      ...entries.map(([, value]) => value),
      nextVersion,
      id,
      expectedVersion,
    ]
    const result = await this.dataSource.execute(
      `UPDATE ${this.parentTableName} SET ${assignments.join(', ')} WHERE id = $${entries.length + 2} AND version = $${entries.length + 3} RETURNING id`,
      params,
      options,
    )
    await this.assertMatchedParentVersion(result, id, options)
  }

  async batchDeleteByIds(
    ids: number[],
    options?: TransactionOptions,
  ): Promise<void> {
    if (ids.length === 0) return
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    await this.dataSource.execute(
      `DELETE FROM ${this.tableName} WHERE id IN (${placeholders})`,
      ids,
      options,
    )
  }

  async updateDetailFields(
    id: number,
    weight_kg: number,
    productId: number,
    personId: number,
    options?: TransactionOptions,
  ): Promise<void> {
    await this.dataSource.execute(
      `UPDATE ${this.tableName} SET ${DETAIL_COLUMNS.weight} = $1, ${DETAIL_COLUMNS.product} = $2, ${DETAIL_COLUMNS.person} = $3 WHERE id = $4`,
      [weight_kg, productId, personId, id],
      options,
    )
  }

  private async assertMatchedParentVersion(
    result: unknown,
    id: number,
    options?: TransactionOptions,
  ): Promise<void> {
    const rows = extractRows(result)
    if (rows.length > 0) return

    const existsResult = await this.dataSource.execute(
      `SELECT id FROM ${this.parentTableName} WHERE id = $1`,
      [id],
      options,
    )
    const existsRows = extractRows(existsResult)
    if (existsRows.length === 0) {
      throw transactionNotFoundError(this.parentTableName, id)
    }

    throw versionConflictError()
  }
}
