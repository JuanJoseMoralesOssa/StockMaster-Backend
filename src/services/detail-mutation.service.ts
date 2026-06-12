import { BindingScope, injectable, service } from '@loopback/core'
import { HttpErrors } from '@loopback/rest'
import {
  DataSourceWithTransactions,
  DetailBase,
  DetailRepository,
  RelationFactory,
  TransactionOptions,
} from './transaction.types'
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
    const parentVersion = this.requireParentVersion(expectedParentVersion)

    if (newDetail.weight_kg != null) {
      newDetail.weight_kg = roundWeightKg(newDetail.weight_kg)
    }

    return this.runInTransaction(dataSource, async (tx: TransactionOptions) => {
      await this.bumpParentVersion(
        dataSource,
        transactionKind,
        parentId,
        parentVersion,
        tx,
      )

      const detailsRelation = detailsRelationFactory(parentId)
      await this.stockReconciliationService.adjustStock(
        dataSource,
        newDetail.productId!,
        newDetail.weight_kg!,
        transactionKind,
        'apply',
        tx.transaction,
      )
      const detail = await detailsRelation.create(newDetail, tx)

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
    const parentVersion = this.requireParentVersion(expectedParentVersion)

    if (updatedDetail.weight_kg != null) {
      if (updatedDetail.weight_kg <= 0) {
        throw new HttpErrors.BadRequest(
          'Weight must be a positive number for detail operations',
        )
      }
      updatedDetail.weight_kg = roundWeightKg(updatedDetail.weight_kg)
    }

    return this.runInTransaction(
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

        if (newWeight !== oldWeight || newProductId !== oldProductId) {
          if (newProductId === oldProductId) {
            const diff = roundWeightKg(newWeight - oldWeight)
            if (diff !== 0) {
              await this.stockReconciliationService.adjustStock(
                detailsRepository.dataSource,
                newProductId,
                Math.abs(diff),
                transactionKind,
                diff > 0 ? 'apply' : 'undo',
                tx.transaction,
              )
            }
          } else {
            await this.stockReconciliationService.adjustStock(
              detailsRepository.dataSource,
              oldProductId,
              oldWeight,
              transactionKind,
              'undo',
              tx.transaction,
            )
            await this.stockReconciliationService.adjustStock(
              detailsRepository.dataSource,
              newProductId,
              newWeight,
              transactionKind,
              'apply',
              tx.transaction,
            )
          }
        }

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
    const parentVersion = this.requireParentVersion(expectedParentVersion)

    await this.runInTransaction(
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
        )

        await detailsRepository.deleteById(id, tx)
      },
    )
  }

  private validateDetail(detail: Partial<DetailBase>): void {
    if (detail.productId == null || detail.personId == null) {
      throw new HttpErrors.BadRequest(
        'Product ID and Person ID are required for detail operations',
      )
    }
    if (detail.weight_kg == null || detail.weight_kg <= 0) {
      throw new HttpErrors.BadRequest(
        'Weight must be a positive number for detail operations',
      )
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
      throw new HttpErrors.BadRequest(
        'Moving a detail to another transaction is not allowed.',
      )
    }
  }

  private requireParentVersion(expectedParentVersion?: number): number {
    if (
      expectedParentVersion == null ||
      !Number.isFinite(expectedParentVersion) ||
      expectedParentVersion < 1
    ) {
      throw new HttpErrors.BadRequest(
        'parentVersion query parameter is required for detail mutations.',
      )
    }
    return expectedParentVersion
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

  private async runInTransaction<T>(
    dataSource: DataSourceWithTransactions,
    work: (tx: TransactionOptions) => Promise<T>,
  ): Promise<T> {
    if (typeof dataSource.beginTransaction !== 'function') {
      throw new HttpErrors.InternalServerError(
        'DataSource does not support transactions',
      )
    }

    const transaction = await dataSource.beginTransaction({
      isolationLevel: 'READ COMMITTED',
    })
    try {
      const result = await work({ transaction })
      await transaction.commit()
      return result
    } catch (error) {
      await transaction.rollback()
      throw error
    }
  }
}
