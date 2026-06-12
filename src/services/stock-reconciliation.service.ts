import { BindingScope, inject, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { HttpErrors } from '@loopback/rest'
import { SecurityBindings, UserProfile } from '@loopback/security'
import { productStockNotFoundMessage } from '../errors'
import { KardexRepository } from '../repositories'
import { extractRows } from './transaction-execution.utils'
import { TransactionKind } from './transaction-kind.enum'
import {
  getKardexOperation,
  getStockOperator,
  StockMutationMode,
} from './transaction-type.const'
import {
  DataSourceWithTransactions,
  DetailBase,
  TransactionContext,
} from './transaction.types'
import { roundWeightKg } from './weight.utils'

export type { StockMutationMode } from './transaction-type.const'

/**
 * Provenance for the Kardex row a stock mutation produces: which document and
 * detail line caused the movement. The acting user is resolved from the
 * request context (this service is TRANSIENT, so it is instantiated per
 * request with the authenticated profile available).
 */
export interface KardexSource {
  /** Id of the parent purchase/expense document. */
  sourceId?: number
  /** Id of the detail line, when known at write time. */
  sourceDetailId?: number
}

@injectable({ scope: BindingScope.TRANSIENT })
export class StockReconciliationService {
  constructor(
    @repository(KardexRepository)
    private readonly kardexRepository: KardexRepository,
    @inject(SecurityBindings.USER, { optional: true })
    private readonly currentUser?: UserProfile,
  ) {}

  /**
   * Adjusts the product stock and writes the Kardex row atomically.
   * Returns the new Kardex row id so callers that create the detail row
   * AFTER the stock check (creations must validate the product first to keep
   * the 404-on-missing-product contract) can backfill its provenance via
   * {@link attachDetailToKardex}.
   */
  async adjustStock(
    dataSource: DataSourceWithTransactions,
    productId: number,
    weightKg: number,
    transactionKind: TransactionKind,
    mode: StockMutationMode,
    tx: TransactionContext,
    source?: KardexSource,
  ): Promise<number | undefined> {
    const operator = getStockOperator(transactionKind, mode)
    return this.executeStockUpdate(
      dataSource,
      productId,
      weightKg,
      operator,
      transactionKind,
      mode,
      tx,
      source,
    )
  }

  /** Backfills the detail id on a Kardex row created before the detail row. */
  async attachDetailToKardex(
    kardexId: number | undefined,
    detailId: number | undefined,
    tx: TransactionContext,
  ): Promise<void> {
    if (kardexId == null || detailId == null) return
    await this.kardexRepository.updateById(
      kardexId,
      { sourceDetailId: detailId },
      { transaction: tx } as object,
    )
  }

  async applyDetailStockDelta(
    dataSource: DataSourceWithTransactions,
    oldDetail: Pick<DetailBase, 'productId' | 'weight_kg'>,
    newDetail: Pick<DetailBase, 'productId' | 'weight_kg'>,
    transactionKind: TransactionKind,
    tx: TransactionContext,
    source?: KardexSource,
  ): Promise<void> {
    const newWeight = roundWeightKg(newDetail.weight_kg)

    if (oldDetail.productId !== newDetail.productId) {
      await this.adjustStock(
        dataSource,
        oldDetail.productId,
        oldDetail.weight_kg,
        transactionKind,
        'undo',
        tx,
        source,
      )
      await this.adjustStock(
        dataSource,
        newDetail.productId,
        newWeight,
        transactionKind,
        'apply',
        tx,
        source,
      )
      return
    }

    const diff = roundWeightKg(newWeight - oldDetail.weight_kg)
    if (diff !== 0) {
      await this.adjustStock(
        dataSource,
        newDetail.productId,
        Math.abs(diff),
        transactionKind,
        diff > 0 ? 'apply' : 'undo',
        tx,
        source,
      )
    }
  }

  private async executeStockUpdate(
    dataSource: DataSourceWithTransactions,
    productId: number,
    weightKg: number,
    operator: '+' | '-',
    transactionKind: TransactionKind,
    mode: StockMutationMode,
    tx: TransactionContext,
    source?: KardexSource,
  ): Promise<number | undefined> {
    // Single round-trip: update stock and read the new balance atomically.
    // Using RETURNING eliminates the separate SELECT and the race where a
    // concurrent detail could change the balance between the two statements.
    const updateResult = await dataSource.execute(
      `UPDATE product SET stock = COALESCE(stock, 0) ${operator} $1 WHERE id = $2 RETURNING stock`,
      [weightKg, productId],
      { transaction: tx },
    )

    const balance = this.extractProductStock(
      extractRows(updateResult),
      productId,
    )
    const input = operator === '+' ? weightKg : 0
    const output = operator === '-' ? weightKg : 0

    const kardexRow = await this.kardexRepository.create(
      {
        date: new Date().toISOString(),
        input,
        output,
        balance,
        operation: getKardexOperation(transactionKind, mode),
        productId,
        sourceKind: transactionKind,
        sourceId: source?.sourceId,
        sourceDetailId: source?.sourceDetailId,
        userId: this.resolveUserId(),
      },
      { transaction: tx } as object,
    )
    return kardexRow.id
  }

  private extractProductStock(rows: unknown[], productId: number): number {
    if (rows.length === 0) {
      throw new HttpErrors.NotFound(productStockNotFoundMessage(productId))
    }

    const firstRow = rows[0] as { stock?: unknown }
    const stock = Number(firstRow.stock ?? 0)
    return Number.isFinite(stock) ? stock : 0
  }

  private resolveUserId(): number | undefined {
    const rawId = this.currentUser?.id
    const userId = Number(rawId)
    return Number.isFinite(userId) ? userId : undefined
  }
}
