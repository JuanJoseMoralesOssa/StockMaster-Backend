import { BindingScope, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { productBalanceNotFoundError, ValidationError } from '../../errors'
import { KardexRepository } from '../../repositories'
import { Kardex, KardexOperation } from '../../models'
import { computeBalanceDeltas } from './balance-delta.utils'
import { extractRows } from './transaction-execution.utils'
import {
  getKardexOperation,
  getBalanceOperator,
  BalanceMutationMode,
} from './transaction-type.const'
import {
  DataSourceWithTransactions,
  DetailBase,
  TransactionContext,
  TxScope,
} from './transaction.types'
import { roundWeightKg } from './weight.utils'

/** How a manual adjustment expresses the target: an absolute count or a +/- delta. */
export type ManualAdjustmentMode = 'set' | 'delta'

export type { BalanceMutationMode } from './transaction-type.const'

/**
 * Provenance for the Kardex row a balance mutation produces: which document and
 * detail line caused the movement. The acting user is carried on the
 * {@link TxScope} (`actorId`), resolved at the request-scoped facade and passed
 * in explicitly — this service no longer reads request/auth context itself.
 */
export interface KardexSource {
  /** Id of the parent purchase/payment document. */
  sourceId?: number
  /** Id of the detail line, when known at write time. */
  sourceDetailId?: number
}

@injectable({ scope: BindingScope.TRANSIENT })
export class BalanceReconciliationService {
  constructor(
    @repository(KardexRepository)
    private readonly kardexRepository: KardexRepository,
  ) {}

  /**
   * Adjusts the product balance and writes the Kardex row atomically.
   * Returns the new Kardex row id so callers that create the detail row
   * AFTER the balance check (creations must validate the product first to keep
   * the 404-on-missing-product contract) can backfill its provenance via
   * {@link attachDetailToKardex}.
   */
  async adjustBalance(
    scope: TxScope,
    productId: number,
    weightKg: number,
    mode: BalanceMutationMode,
    source?: KardexSource,
  ): Promise<number | undefined> {
    const operator = getBalanceOperator(scope.transactionKind, mode)
    return this.executeBalanceUpdate(
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
   * balance. The product row already carries the balance (set on insert); this
   * only writes the audit movement so the Kardex can reconstruct current balance
   * from its rows. No-op for zero/negative opening balance. The product INSERT
   * and this row must share the same transaction (see ProductService.create)
   * so a product never exists without its opening movement. `actorId` is passed
   * explicitly because this catalog-level path has no TransactionKind/TxScope.
   */
  async recordOpeningBalance(
    productId: number,
    openingBalance: number,
    tx: TransactionContext,
    actorId?: number,
  ): Promise<void> {
    const opening = roundWeightKg(openingBalance)
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
   * Applies a manual balance adjustment ("ajuste de inventario") inside the given
   * transaction: locks the product row, computes the target balance from either an
   * absolute count (`set`) or a signed delta (`delta`), updates Product.balance
   * atomically and writes the matching Kardex movement (operation = Manual).
   * Keeps the reconciler invariant — balance and Kardex never diverge — for the
   * one user-driven correction path, the same way purchase/payment flows do.
   * Rejects no-ops and any change that would drive balance negative.
   */
  async recordManualAdjustment(
    dataSource: DataSourceWithTransactions,
    tx: TransactionContext,
    productId: number,
    mode: ManualAdjustmentMode,
    value: number,
    note: string,
    actorId?: number,
  ): Promise<Kardex> {
    // Lock the product row first so a concurrent purchase/payment/adjustment on
    // the same product serializes behind us and the delta is computed against a
    // stable current balance (same FOR UPDATE pattern as ProductService.deleteById).
    const lockedRows = extractRows(
      await dataSource.execute(
        'SELECT balance FROM product WHERE id = $1 FOR UPDATE',
        [productId],
        { transaction: tx },
      ),
    )
    if (lockedRows.length === 0) {
      throw productBalanceNotFoundError(productId)
    }

    const current = roundWeightKg(
      Number((lockedRows[0] as { balance?: unknown }).balance ?? 0),
    )
    const target = roundWeightKg(mode === 'set' ? value : current + value)
    if (!Number.isFinite(target) || target < 0) {
      throw new ValidationError(
        'El ajuste dejaría el balance en un valor negativo',
      )
    }

    const delta = roundWeightKg(target - current)
    if (delta === 0) {
      throw new ValidationError('El ajuste no cambia el balance actual')
    }

    const updateResult = await dataSource.execute(
      'UPDATE product SET balance = $1 WHERE id = $2 RETURNING balance',
      [target, productId],
      { transaction: tx },
    )
    const balance = this.extractProductBalance(
      extractRows(updateResult),
      productId,
    )

    return this.kardexRepository.create(
      {
        date: new Date().toISOString(),
        input: delta > 0 ? delta : 0,
        output: delta < 0 ? -delta : 0,
        balance,
        operation: KardexOperation.Manual,
        productId,
        note,
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

  async applyDetailBalanceDelta(
    scope: TxScope,
    change: {
      old: Pick<DetailBase, 'productId' | 'weight_kg'>
      new: Pick<DetailBase, 'productId' | 'weight_kg'>
    },
    source?: KardexSource,
  ): Promise<void> {
    // The branch arithmetic lives in the pure, unit-tested planner; this method
    // is the thin DB executor for whatever movements it returns.
    for (const delta of computeBalanceDeltas(change.old, change.new)) {
      await this.adjustBalance(
        scope,
        delta.productId,
        delta.weightKg,
        delta.mode,
        source,
      )
    }
  }

  private async executeBalanceUpdate(
    scope: TxScope,
    productId: number,
    weightKg: number,
    operator: '+' | '-',
    mode: BalanceMutationMode,
    source?: KardexSource,
  ): Promise<number | undefined> {
    const tx = scope.options.transaction
    // Single round-trip: update balance and read the new balance atomically.
    // Using RETURNING eliminates the separate SELECT and the race where a
    // concurrent detail could change the balance between the two statements.
    const updateResult = await scope.dataSource.execute(
      `UPDATE product SET balance = COALESCE(balance, 0) ${operator} $1 WHERE id = $2 RETURNING balance`,
      [weightKg, productId],
      { transaction: tx },
    )

    const balance = this.extractProductBalance(
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

  private extractProductBalance(rows: unknown[], productId: number): number {
    if (rows.length === 0) {
      throw productBalanceNotFoundError(productId)
    }

    const firstRow = rows[0] as { balance?: unknown }
    const balance = Number(firstRow.balance ?? 0)
    return Number.isFinite(balance) ? balance : 0
  }

  private resolveUserId(actorId?: number): number | undefined {
    const userId = Number(actorId)
    return Number.isFinite(userId) ? userId : undefined
  }
}
