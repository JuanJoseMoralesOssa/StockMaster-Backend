import { BindingScope, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { productStockNotFoundError } from '../errors'
import { KardexRepository } from '../repositories'
import { KardexOperation } from '../models'
import { computeStockDeltas } from './stock-delta.utils'
import { extractRows } from './transaction-execution.utils'
import {
  getKardexOperation,
  getStockOperator,
  StockMutationMode,
} from './transaction-type.const'
import { DetailBase, TransactionContext, TxScope } from './transaction.types'
import { roundWeightKg } from './weight.utils'

export type { StockMutationMode } from './transaction-type.const'

/**
 * Provenance for the Kardex row a stock mutation produces: which document and
 * detail line caused the movement. The acting user is carried on the
 * {@link TxScope} (`actorId`), resolved at the request-scoped facade and passed
 * in explicitly — this service no longer reads request/auth context itself.
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
  ) {}

  /**
   * Adjusts the product stock and writes the Kardex row atomically.
   * Returns the new Kardex row id so callers that create the detail row
   * AFTER the stock check (creations must validate the product first to keep
   * the 404-on-missing-product contract) can backfill its provenance via
   * {@link attachDetailToKardex}.
   */
  async adjustStock(
    scope: TxScope,
    productId: number,
    weightKg: number,
    mode: StockMutationMode,
    source?: KardexSource,
  ): Promise<number | undefined> {
    const operator = getStockOperator(scope.transactionKind, mode)
    return this.executeStockUpdate(
      scope,
      productId,
      weightKg,
      operator,
      mode,
      source,
    )
  }

  /**
   * Records the opening-balance Kardex row for a product created with non-zero
   * stock. The product row already carries the balance (set on insert); this
   * only writes the audit movement so the Kardex can reconstruct current stock
   * from its rows. No-op for zero/negative opening stock. The product INSERT
   * and this row must share the same transaction (see ProductService.create)
   * so a product never exists without its opening movement. `actorId` is passed
   * explicitly because this catalog-level path has no TransactionKind/TxScope.
   */
  async recordOpeningBalance(
    productId: number,
    openingStock: number,
    tx: TransactionContext,
    actorId?: number,
  ): Promise<void> {
    const opening = roundWeightKg(openingStock)
    if (!Number.isFinite(opening) || opening <= 0) return

    await this.kardexRepository.create(
      {
        date: new Date().toISOString(),
        input: opening,
        output: 0,
        balance: opening,
        operation: KardexOperation.OpeningBalance,
        productId,
        userId: this.resolveUserId(actorId),
      },
      { transaction: tx } as object,
    )
  }

  /**
   * Backfills the detail id on a Kardex row created before the detail row.
   * Both ids are generated primary keys produced earlier in the SAME
   * transaction, so a null here is an internal invariant violation (a movement
   * Kardex row that can never be traced to its detail line), not a normal case
   * — surface it loudly instead of silently leaving null provenance.
   */
  async attachDetailToKardex(
    kardexId: number | undefined,
    detailId: number | undefined,
    tx: TransactionContext,
  ): Promise<void> {
    if (kardexId == null || detailId == null) {
      throw new Error(
        `Kardex provenance backfill missing an id (kardexId=${kardexId}, detailId=${detailId})`,
      )
    }
    await this.kardexRepository.updateById(
      kardexId,
      { sourceDetailId: detailId },
      { transaction: tx } as object,
    )
  }

  async applyDetailStockDelta(
    scope: TxScope,
    change: {
      old: Pick<DetailBase, 'productId' | 'weight_kg'>
      new: Pick<DetailBase, 'productId' | 'weight_kg'>
    },
    source?: KardexSource,
  ): Promise<void> {
    // The branch arithmetic lives in the pure, unit-tested planner; this method
    // is the thin DB executor for whatever movements it returns.
    for (const delta of computeStockDeltas(change.old, change.new)) {
      await this.adjustStock(
        scope,
        delta.productId,
        delta.weightKg,
        delta.mode,
        source,
      )
    }
  }

  private async executeStockUpdate(
    scope: TxScope,
    productId: number,
    weightKg: number,
    operator: '+' | '-',
    mode: StockMutationMode,
    source?: KardexSource,
  ): Promise<number | undefined> {
    const tx = scope.options.transaction
    // Single round-trip: update stock and read the new balance atomically.
    // Using RETURNING eliminates the separate SELECT and the race where a
    // concurrent detail could change the balance between the two statements.
    const updateResult = await scope.dataSource.execute(
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
        operation: getKardexOperation(scope.transactionKind, mode),
        productId,
        sourceKind: scope.transactionKind,
        sourceId: source?.sourceId,
        sourceDetailId: source?.sourceDetailId,
        userId: this.resolveUserId(scope.actorId),
      },
      { transaction: tx } as object,
    )
    return kardexRow.id
  }

  private extractProductStock(rows: unknown[], productId: number): number {
    if (rows.length === 0) {
      throw productStockNotFoundError(productId)
    }

    const firstRow = rows[0] as { stock?: unknown }
    const stock = Number(firstRow.stock ?? 0)
    return Number.isFinite(stock) ? stock : 0
  }

  private resolveUserId(actorId?: number): number | undefined {
    const userId = Number(actorId)
    return Number.isFinite(userId) ? userId : undefined
  }
}
