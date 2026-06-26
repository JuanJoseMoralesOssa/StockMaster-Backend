import { BindingScope, injectable, service } from '@loopback/core'
import { computeDetailsDiff, DetailDiff } from './transaction-diff.utils'
import { DetailBase, TransactionOptions, TxScope } from './transaction.types'
import { StockReconciliationService } from './stock-reconciliation.service'
import { TransactionDetailsSqlHelper } from './transaction-details-sql.helper'
import { roundWeightKg } from './weight.utils'

type RelationsAccessor<D extends DetailBase> = {
  create(data: Partial<D>, options?: TransactionOptions): Promise<D>
}

@injectable({ scope: BindingScope.TRANSIENT })
export class DetailReconciliationService {
  constructor(
    @service(StockReconciliationService)
    private readonly stockReconciliationService: StockReconciliationService,
  ) {}

  computeDiff<D extends DetailBase>(
    existingDetails: D[],
    incomingDetails: D[],
  ): DetailDiff<D> {
    // computeDetailsDiff throws the HTTP-agnostic ForeignDetailError (a
    // DomainError); the ErrorHandlerInterceptor maps it to 403. No translation
    // is needed here anymore.
    return computeDetailsDiff<D>(existingDetails, incomingDetails)
  }

  /**
   * Single entry point for applying a full reconciliation diff. The
   * delete → update → create ORDER is load-bearing and lives here (one place)
   * rather than being re-sequenced by each orchestrator (audit reconciler-gating
   * finding). Every step short-circuits on an empty input set.
   */
  async reconcileDiff<D extends DetailBase>(
    scope: TxScope,
    diff: DetailDiff<D>,
    parentId: number,
    relationsAccessor: RelationsAccessor<D>,
  ): Promise<void> {
    await this.applyDeletions(scope, diff.toDelete, parentId)
    await this.applyUpdates(scope, diff.toUpdate, parentId)
    await this.applyCreations(scope, diff.toCreate, parentId, relationsAccessor)
  }

  async applyDeletions<D extends DetailBase>(
    scope: TxScope,
    toDelete: D[],
    parentId: number,
  ): Promise<void> {
    if (toDelete.length === 0) return

    const sql = new TransactionDetailsSqlHelper(
      scope.dataSource,
      scope.transactionKind,
    )
    for (const detail of toDelete) {
      await this.stockReconciliationService.adjustStock(
        scope,
        detail.productId,
        detail.weight_kg,
        'undo',
        { sourceId: parentId, sourceDetailId: detail.id },
      )
    }
    await sql.batchDeleteByIds(
      toDelete.map(d => d.id!),
      scope.options,
    )
  }

  async applyUpdates<D extends DetailBase>(
    scope: TxScope,
    toUpdate: Array<{ old: D; new: D }>,
    parentId: number,
  ): Promise<void> {
    if (toUpdate.length === 0) return

    const sql = new TransactionDetailsSqlHelper(
      scope.dataSource,
      scope.transactionKind,
    )
    for (const { old, new: det } of toUpdate) {
      const newWeight = roundWeightKg(det.weight_kg)

      await this.stockReconciliationService.applyDetailStockDelta(
        scope,
        { old, new: { productId: det.productId, weight_kg: newWeight } },
        { sourceId: parentId, sourceDetailId: det.id },
      )

      await sql.updateDetailFields(
        det.id!,
        newWeight,
        det.productId,
        det.personId,
        scope.options,
      )
    }
  }

  async applyCreations<D extends DetailBase>(
    scope: TxScope,
    toCreate: D[],
    parentId: number,
    relationsAccessor: RelationsAccessor<D>,
  ): Promise<void> {
    for (const det of toCreate) {
      await this.applyCreation(scope, det, parentId, relationsAccessor)
    }
  }

  /**
   * Creates ONE detail row and its stock movement atomically. The ordering is
   * load-bearing and therefore lives in exactly one place (shared by the bulk
   * reconciler above and DetailMutationService.createSingleDetail):
   *
   *   1. adjust stock first — adjustStock 404s when the product does not exist,
   *      which must win over the detail INSERT's FK violation (409);
   *   2. create the detail row;
   *   3. backfill the Kardex row's detail-id provenance (the Kardex row
   *      predates the detail row because of step 1).
   */
  async applyCreation<D extends DetailBase>(
    scope: TxScope,
    detail: Partial<D>,
    parentId: number,
    relationsAccessor: RelationsAccessor<D>,
  ): Promise<D> {
    const weightKg = roundWeightKg(detail.weight_kg!)
    const kardexId = await this.stockReconciliationService.adjustStock(
      scope,
      detail.productId!,
      weightKg,
      'apply',
      { sourceId: parentId },
    )
    const created = await relationsAccessor.create(
      {
        weight_kg: weightKg,
        productId: detail.productId,
        personId: detail.personId,
      } as Partial<D>,
      scope.options,
    )
    await this.stockReconciliationService.attachDetailToKardex(
      kardexId,
      created.id,
      scope.options.transaction,
    )
    return created
  }
}
