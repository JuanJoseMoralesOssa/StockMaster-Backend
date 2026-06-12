import { BindingScope, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { HttpErrors } from '@loopback/rest'
import { KardexOperation } from '../models'
import { KardexRepository } from '../repositories'
import { TransactionKind } from './transaction-kind.enum'
import { TRANSACTION_CONFIG } from './transaction-type.const'

export type TransactionContext = unknown

type DataSourceWithTransactions = {
  execute(
    sql: string,
    params?: unknown[],
    options?: { transaction: TransactionContext },
  ): Promise<unknown>
}

export type StockMutationMode = 'apply' | 'undo'

@injectable({ scope: BindingScope.TRANSIENT })
export class StockReconciliationService {
  constructor(
    @repository(KardexRepository)
    private readonly kardexRepository: KardexRepository,
  ) {}

  async adjustStock(
    dataSource: DataSourceWithTransactions,
    productId: number,
    weightKg: number,
    transactionKind: TransactionKind,
    mode: StockMutationMode,
    tx: TransactionContext,
  ): Promise<void> {
    const operator = this.getStockOperator(transactionKind, mode)
    await this.executeStockUpdate(
      dataSource,
      productId,
      weightKg,
      operator,
      transactionKind,
      mode,
      tx,
    )
  }

  private getStockOperator(
    transactionKind: TransactionKind,
    mode: StockMutationMode,
  ): '+' | '-' {
    const direction = TRANSACTION_CONFIG[transactionKind].stockDirection
    const signedDirection = mode === 'apply' ? direction : -direction
    return signedDirection > 0 ? '+' : '-'
  }

  private async executeStockUpdate(
    dataSource: DataSourceWithTransactions,
    productId: number,
    weightKg: number,
    operator: '+' | '-',
    transactionKind: TransactionKind,
    mode: StockMutationMode,
    tx: TransactionContext,
  ): Promise<void> {
    // Single round-trip: update stock and read the new balance atomically.
    // Using RETURNING eliminates the separate SELECT and the race where a
    // concurrent detail could change the balance between the two statements.
    const updateResult = await dataSource.execute(
      `UPDATE product SET stock = COALESCE(stock, 0) ${operator} $1 WHERE id = $2 RETURNING stock`,
      [weightKg, productId],
      { transaction: tx },
    )

    const rows = this.extractRows(updateResult)
    if (rows.length === 0) {
      throw new HttpErrors.NotFound(
        `Cannot reconcile stock: product ${productId} does not exist.`,
      )
    }

    const balance = this.extractProductStock(rows, productId)
    const input = operator === '+' ? weightKg : 0
    const output = operator === '-' ? weightKg : 0

    await this.kardexRepository.create(
      {
        date: new Date().toISOString(),
        input,
        output,
        balance,
        balance_record: true,
        operation: this.getKardexOperation(transactionKind, mode),
        productId,
      },
      { transaction: tx } as object,
    )
  }

  private extractProductStock(rows: unknown[], productId: number): number {
    if (rows.length === 0) {
      throw new HttpErrors.NotFound(
        `Cannot reconcile stock: product ${productId} does not exist.`,
      )
    }

    const firstRow = rows[0] as { stock?: unknown }
    const stock = Number(firstRow.stock ?? 0)
    return Number.isFinite(stock) ? stock : 0
  }

  private extractRows(result: unknown): unknown[] {
    if (Array.isArray(result)) {
      return result
    }

    const rows = (result as { rows?: unknown })?.rows
    return Array.isArray(rows) ? rows : []
  }

  private getKardexOperation(
    transactionKind: TransactionKind,
    mode: StockMutationMode,
  ): KardexOperation {
    if (transactionKind === TransactionKind.PURCHASE && mode === 'apply') {
      return KardexOperation.PurchaseApply
    }
    if (transactionKind === TransactionKind.PURCHASE && mode === 'undo') {
      return KardexOperation.PurchaseUndo
    }
    if (transactionKind === TransactionKind.EXPENSE && mode === 'apply') {
      return KardexOperation.ExpenseApply
    }
    return KardexOperation.ExpenseUndo
  }
}
