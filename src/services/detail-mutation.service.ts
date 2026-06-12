import { BindingScope, injectable, service } from '@loopback/core'
import { HttpErrors } from '@loopback/rest'
import { USER_MESSAGES } from '../errors'
import {
  DataSourceWithTransactions,
  DetailBase,
  DetailRepository,
  RelationFactory,
  TransactionOptions,
} from './transaction.types'
import { requireVersion } from './optimistic-lock.utils'
import { runInTransaction } from './transaction-execution.utils'
import { StockReconciliationService } from './stock-reconciliation.service'
import { TransactionDetailsSqlHelper } from './transaction-details-sql.helper'
import { TransactionKind } from './transaction-kind.enum'
import { TRANSACTION_CONFIG } from './transaction-type.const'
import { roundWeightKg } from './weight.utils'

@injectable({ scope: BindingScope.TRANSIENT })
export class DetailMutationService {
  constructor(
    @service(StockReconciliationService)
    private readonly stockReconciliationService: StockReconciliationService,
  ) {}

  async createSingleDetail<TDetail extends DetailBase>(
    parentId: number,
    newDetail: Partial<TDetail>,
    detailsRelationFactory: RelationFactory<TDetail>,
    dataSource: DataSourceWithTransactions,
    transactionKind: TransactionKind,
    expectedParentVersion?: number,
  ): Promise<TDetail> {
    this.validateDetail(newDetail)
    const parentVersion = requireVersion(expectedParentVersion, 'parentVersion')

    if (newDetail.weight_kg != null) {
      newDetail.weight_kg = roundWeightKg(newDetail.weight_kg)
    }

    return runInTransaction(dataSource, async (tx: TransactionOptions) => {
      await this.bumpParentVersion(
        dataSource,
        transactionKind,
        parentId,
        parentVersion,
        tx,
      )

      const detailsRelation = detailsRelationFactory(parentId)
      // Stock first: adjustStock 404s when the product does not exist, which
      // must win over the detail INSERT's FK violation (409). The Kardex row
      // therefore predates the detail row; its id is backfilled after.
      const kardexId = await this.stockReconciliationService.adjustStock(
        dataSource,
        newDetail.productId!,
        newDetail.weight_kg!,
        transactionKind,
        'apply',
        tx.transaction,
        { sourceId: parentId },
      )
      const detail = await detailsRelation.create(newDetail, tx)
      await this.stockReconciliationService.attachDetailToKardex(
        kardexId,
        detail.id,
        tx.transaction,
      )

      return detail
    })
  }

  async updateSingleDetail<TDetail extends DetailBase>(
    id: number,
    updatedDetail: Partial<TDetail>,
    detailsRepository: DetailRepository<TDetail>,
    transactionKind: TransactionKind,
    expectedParentVersion?: number,
  ): Promise<TDetail> {
    const parentVersion = requireVersion(expectedParentVersion, 'parentVersion')

    if (updatedDetail.weight_kg != null) {
      if (updatedDetail.weight_kg <= 0) {
        throw new HttpErrors.BadRequest(USER_MESSAGES.WEIGHT_POSITIVE)
      }
      updatedDetail.weight_kg = roundWeightKg(updatedDetail.weight_kg)
    }

    return runInTransaction(
      detailsRepository.dataSource,
      async (tx: TransactionOptions) => {
        const oldDetail = await detailsRepository.findById(id, {}, tx)
        const parentId = this.resolveParentId(oldDetail, transactionKind)
        this.rejectParentMove(updatedDetail, oldDetail, transactionKind)
        await this.bumpParentVersion(
          detailsRepository.dataSource,
          transactionKind,
          parentId,
          parentVersion,
          tx,
        )

        const newWeight = updatedDetail.weight_kg ?? oldDetail.weight_kg
        const oldWeight = oldDetail.weight_kg
        const newProductId = updatedDetail.productId ?? oldDetail.productId
        const oldProductId = oldDetail.productId

        await this.stockReconciliationService.applyDetailStockDelta(
          detailsRepository.dataSource,
          { productId: oldProductId, weight_kg: oldWeight },
          { productId: newProductId, weight_kg: newWeight },
          transactionKind,
          tx.transaction,
          { sourceId: parentId, sourceDetailId: id },
        )

        await detailsRepository.updateById(id, updatedDetail, tx)

        return detailsRepository.findById(id, { include: [] }, tx)
      },
    )
  }

  async deleteSingleDetail<TDetail extends DetailBase>(
    id: number,
    detailsRepository: DetailRepository<TDetail>,
    transactionKind: TransactionKind,
    expectedParentVersion?: number,
  ): Promise<void> {
    const parentVersion = requireVersion(expectedParentVersion, 'parentVersion')

    await runInTransaction(
      detailsRepository.dataSource,
      async (tx: TransactionOptions) => {
        const detail = await detailsRepository.findById(id, {}, tx)
        const parentId = this.resolveParentId(detail, transactionKind)
        await this.bumpParentVersion(
          detailsRepository.dataSource,
          transactionKind,
          parentId,
          parentVersion,
          tx,
        )

        await this.stockReconciliationService.adjustStock(
          detailsRepository.dataSource,
          detail.productId,
          detail.weight_kg,
          transactionKind,
          'undo',
          tx.transaction,
          { sourceId: parentId, sourceDetailId: id },
        )

        await detailsRepository.deleteById(id, tx)
      },
    )
  }

  private validateDetail(detail: Partial<DetailBase>): void {
    if (detail.productId == null || detail.personId == null) {
      throw new HttpErrors.BadRequest(USER_MESSAGES.DETAIL_FIELDS_REQUIRED)
    }
    if (detail.weight_kg == null || detail.weight_kg <= 0) {
      throw new HttpErrors.BadRequest(USER_MESSAGES.WEIGHT_POSITIVE)
    }
  }

  private resolveParentId(
    detail: DetailBase,
    transactionKind: TransactionKind,
  ): number {
    const config = TRANSACTION_CONFIG[transactionKind]
    const record = detail as unknown as Record<string, unknown>
    const parentId = record[config.parentFk]
    if (typeof parentId !== 'number') {
      throw new HttpErrors.InternalServerError(
        'Detail row is missing its parent transaction id.',
      )
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
      throw new HttpErrors.BadRequest(USER_MESSAGES.DETAIL_MOVE_FORBIDDEN)
    }
  }

  private async bumpParentVersion(
    dataSource: DataSourceWithTransactions,
    transactionKind: TransactionKind,
    parentId: number,
    expectedParentVersion: number,
    options: TransactionOptions,
  ): Promise<void> {
    const sql = new TransactionDetailsSqlHelper(dataSource, transactionKind)
    await sql.bumpParentVersion(parentId, expectedParentVersion, options)
  }
}
