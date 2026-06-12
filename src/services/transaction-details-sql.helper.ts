import { HttpErrors } from '@loopback/rest'
import {
  DataSourceWithTransactions,
  TransactionOptions,
} from './transaction.types'
import { TransactionKind } from './transaction-kind.enum'
import { TRANSACTION_CONFIG } from './transaction-type.const'

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
      throw new HttpErrors.BadRequest(
        `Unsupported transaction kind: ${transactionKind}`,
      )
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
   * Throws 404 if the row does not exist, 409 if the version has changed.
   */
  async lockParentRow(
    id: number,
    expectedVersion: number,
    options?: TransactionOptions,
  ): Promise<void> {
    const result = await this.dataSource.execute(
      `SELECT id, version FROM ${this.parentTableName} WHERE id = $1 FOR UPDATE`,
      [id],
      options,
    )
    const rows = this.extractRows(result) as { id: number; version: number }[]
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new HttpErrors.NotFound(
        `${this.parentTableName} with id ${id} not found`,
      )
    }
    if (Number(rows[0].version) !== expectedVersion) {
      throw new HttpErrors.Conflict(
        'Este registro fue modificado por otro usuario. Por favor recarga y vuelve a intentarlo.',
      )
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
      if (key !== 'date') {
        throw new HttpErrors.BadRequest(
          `Unsupported parent transaction field: ${key}`,
        )
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
      `UPDATE ${this.tableName} SET weight_kg = $1, productId = $2, personId = $3 WHERE id = $4`,
      [weight_kg, productId, personId, id],
      options,
    )
  }

  private async assertMatchedParentVersion(
    result: unknown,
    id: number,
    options?: TransactionOptions,
  ): Promise<void> {
    const rows = this.extractRows(result)
    if (rows.length > 0) return

    const existsResult = await this.dataSource.execute(
      `SELECT id FROM ${this.parentTableName} WHERE id = $1`,
      [id],
      options,
    )
    const existsRows = this.extractRows(existsResult)
    if (existsRows.length === 0) {
      throw new HttpErrors.NotFound(
        `${this.parentTableName} with id ${id} not found`,
      )
    }

    throw new HttpErrors.Conflict(
      'Este registro fue modificado por otro usuario. Por favor recarga y vuelve a intentarlo.',
    )
  }

  private extractRows(result: unknown): unknown[] {
    if (Array.isArray(result)) {
      return result
    }

    const rows = (result as { rows?: unknown })?.rows
    return Array.isArray(rows) ? rows : []
  }
}
