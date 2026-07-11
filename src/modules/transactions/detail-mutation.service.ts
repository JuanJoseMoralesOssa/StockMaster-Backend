import { BindingScope, injectable, service } from '@loopback/core'
import { USER_MESSAGES, ValidationError } from '../../errors'
import {
  DataSourceWithTransactions,
  DetailBase,
  DetailRepository,
  RelationFactory,
  TxScope,
} from './transaction.types'
import { assertDetailValid } from './detail-validation.utils'
import { DetailReconciliationService } from './detail-reconciliation.service'
import { requireVersion } from './optimistic-lock.utils'
import { runInTransaction } from './transaction-execution.utils'
import { BalanceReconciliationService } from './balance-reconciliation.service'
import { TransactionDetailsSqlHelper } from './transaction-details-sql.helper'
import { TransactionKind } from './transaction-kind.enum'
import { TRANSACTION_CONFIG } from './transaction-type.const'
import { roundWeight } from '../../domain/weight'

@injectable({ scope: BindingScope.TRANSIENT })
export class DetailMutationService {
  constructor(
    @service(BalanceReconciliationService)
    private readonly balanceReconciliationService: BalanceReconciliationService,
    @service(DetailReconciliationService)
    private readonly detailReconciliationService: DetailReconciliationService,
  ) {}

  async createSingleDetail<TDetail extends DetailBase>(
    parentId: number,
    newDetail: Partial<TDetail>,
    detailsRelationFactory: RelationFactory<TDetail>,
    dataSource: DataSourceWithTransactions,
    transactionKind: TransactionKind,
    expectedParentVersion?: number,
    actorId?: number,
  ): Promise<TDetail> {
    assertDetailValid(newDetail)
    const parentVersion = requireVersion(expectedParentVersion, 'parentVersion')

    return runInTransaction(dataSource, async options => {
      const scope: TxScope = {
        dataSource,
        transactionKind,
        options,
        actorId,
      }
      await this.bumpParentVersion(scope, parentId, parentVersion)

      const detailsRelation = detailsRelationFactory(parentId)
      // Single source of truth for "adjust balance → create detail → backfill
      // Kardex provenance" — shared with the bulk reconciler so the ordering
      // rule (balance 404 must beat the FK 409) lives in one place.
      return this.detailReconciliationService.applyCreation(
        scope,
        newDetail,
        parentId,
        detailsRelation,
      )
    })
  }

  async updateSingleDetail<TDetail extends DetailBase>(
    id: number,
    updatedDetail: Partial<TDetail>,
    detailsRepository: DetailRepository<TDetail>,
    transactionKind: TransactionKind,
    expectedParentVersion?: number,
    actorId?: number,
  ): Promise<TDetail> {
    const parentVersion = requireVersion(expectedParentVersion, 'parentVersion')

    if (updatedDetail.weight_kg != null) {
      if (updatedDetail.weight_kg <= 0) {
        throw new ValidationError(USER_MESSAGES.WEIGHT_POSITIVE)
      }
      updatedDetail.weight_kg = roundWeight(updatedDetail.weight_kg)
    }

    return runInTransaction(detailsRepository.dataSource, async options => {
      const scope: TxScope = {
        dataSource: detailsRepository.dataSource,
        transactionKind,
        options,
        actorId,
      }
      const oldDetail = await detailsRepository.findById(id, {}, options)
      const parentId = this.resolveParentId(oldDetail, transactionKind)
      this.rejectParentMove(updatedDetail, oldDetail, transactionKind)
      await this.bumpParentVersion(scope, parentId, parentVersion)

      const newWeight = updatedDetail.weight_kg ?? oldDetail.weight_kg
      const oldWeight = oldDetail.weight_kg
      const newProductId = updatedDetail.productId ?? oldDetail.productId
      const oldProductId = oldDetail.productId

      await this.balanceReconciliationService.applyDetailBalanceDelta(
        scope,
        {
          old: { productId: oldProductId, weight_kg: oldWeight },
          new: { productId: newProductId, weight_kg: newWeight },
        },
        { sourceId: parentId, sourceDetailId: id },
      )

      await detailsRepository.updateById(id, updatedDetail, options)

      return detailsRepository.findById(id, { include: [] }, options)
    })
  }

  async deleteSingleDetail<TDetail extends DetailBase>(
    id: number,
    detailsRepository: DetailRepository<TDetail>,
    transactionKind: TransactionKind,
    expectedParentVersion?: number,
    actorId?: number,
  ): Promise<void> {
    const parentVersion = requireVersion(expectedParentVersion, 'parentVersion')

    await runInTransaction(detailsRepository.dataSource, async options => {
      const scope: TxScope = {
        dataSource: detailsRepository.dataSource,
        transactionKind,
        options,
        actorId,
      }
      const detail = await detailsRepository.findById(id, {}, options)
      const parentId = this.resolveParentId(detail, transactionKind)
      await this.bumpParentVersion(scope, parentId, parentVersion)

      await this.balanceReconciliationService.adjustBalance(
        scope,
        detail.productId,
        detail.weight_kg,
        'undo',
        { sourceId: parentId, sourceDetailId: id },
      )

      await detailsRepository.deleteById(id, options)
    })
  }

  private resolveParentId(
    detail: DetailBase,
    transactionKind: TransactionKind,
  ): number {
    const config = TRANSACTION_CONFIG[transactionKind]
    const record = detail as unknown as Record<string, unknown>
    const parentId = record[config.parentFk]
    if (typeof parentId !== 'number') {
      // Internal invariant: a persisted detail row always carries its parent FK.
      throw new Error('Detail row is missing its parent transaction id.')
    }
    return parentId
  }

  private rejectParentMove<TDetail extends DetailBase>(
    updatedDetail: Partial<TDetail>,
    oldDetail: TDetail,
    transactionKind: TransactionKind,
  ): void {
    const config = TRANSACTION_CONFIG[transactionKind]
    const updated = updatedDetail as unknown as Record<string, unknown>
    if (updated[config.parentFk] == null) return

    const oldParentId = this.resolveParentId(oldDetail, transactionKind)
    if (updated[config.parentFk] !== oldParentId) {
      throw new ValidationError(USER_MESSAGES.DETAIL_MOVE_FORBIDDEN)
    }
  }

  private async bumpParentVersion(
    scope: TxScope,
    parentId: number,
    expectedParentVersion: number,
  ): Promise<void> {
    const sql = new TransactionDetailsSqlHelper(
      scope.dataSource,
      scope.transactionKind,
    )
    await sql.bumpParentVersion(parentId, expectedParentVersion, scope.options)
  }
}
