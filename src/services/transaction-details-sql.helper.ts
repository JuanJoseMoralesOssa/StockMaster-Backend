import { HttpErrors } from '@loopback/rest'
import {
  DataSourceWithTransactions,
  TransactionOptions,
} from './transaction.types'

type DetailRelationConfig = {
  tableName: string
  parentIdField: string
  parentTableName: string
}

const DETAIL_RELATION_CONFIG: Record<string, DetailRelationConfig> = {
  expense_details: {
    tableName: 'expensedetails',
    parentIdField: 'expenseId',
    parentTableName: 'expense',
  },
  purchase_details: {
    tableName: 'purchasedetails',
    parentIdField: 'purchaseId',
    parentTableName: 'purchase',
  },
}

/** Wraps the raw-SQL batch operations for a specific detail table. */
export class TransactionDetailsSqlHelper {
  private readonly tableName: string
  private readonly parentTableName: string

  constructor(
    private readonly dataSource: DataSourceWithTransactions,
    detailsRelationName: string,
  ) {
    const config = DETAIL_RELATION_CONFIG[detailsRelationName]
    if (!config) {
      throw new HttpErrors.BadRequest(
        `Unsupported details relation: ${detailsRelationName}`,
      )
    }
    this.tableName = config.tableName
    this.parentTableName = config.parentTableName
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
    const rows = result as { id: number; version: number }[]
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
}
