import { BindingScope, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { KardexRepository } from '../repositories'

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
    isPurchase: boolean,
    mode: StockMutationMode,
    tx: TransactionContext,
  ): Promise<void> {
    const operator = this.getStockOperator(isPurchase, mode)
    await this.executeStockUpdate(
      dataSource,
      productId,
      weightKg,
      operator,
      isPurchase,
      mode,
      tx,
    )
  }

  private getStockOperator(
    isPurchase: boolean,
    mode: StockMutationMode,
  ): '+' | '-' {
    if (mode === 'apply') {
      return isPurchase ? '+' : '-'
    }
    return isPurchase ? '-' : '+'
  }

  private async executeStockUpdate(
    dataSource: DataSourceWithTransactions,
    productId: number,
    weightKg: number,
    operator: '+' | '-',
    isPurchase: boolean,
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

    const balance = this.extractProductStock(updateResult)
    const input = operator === '+' ? weightKg : 0
    const output = operator === '-' ? weightKg : 0

    await this.kardexRepository.create(
      {
        date: new Date().toISOString(),
        input,
        output,
        balance,
        balance_record: true,
        operation: this.getKardexOperation(isPurchase, mode),
        productId,
      },
      { transaction: tx } as object,
    )
  }

  private extractProductStock(stockResult: unknown): number {
    if (!Array.isArray(stockResult) || stockResult.length === 0) {
      return 0
    }

    const firstRow = stockResult[0] as { stock?: unknown }
    const stock = Number(firstRow.stock ?? 0)
    return Number.isFinite(stock) ? stock : 0
  }

  private getKardexOperation(
    isPurchase: boolean,
    mode: StockMutationMode,
  ): number {
    if (isPurchase && mode === 'apply') return 1
    if (isPurchase && mode === 'undo') return 2
    if (!isPurchase && mode === 'apply') return 3
    return 4
  }
}
