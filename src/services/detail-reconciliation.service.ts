import { BindingScope, injectable, service } from '@loopback/core'
import { HttpErrors } from '@loopback/rest'
import { ForeignDetailError } from '../errors'
import { computeDetailsDiff, DetailDiff } from './transaction-diff.utils'
import {
  DataSourceWithTransactions,
  DetailBase,
  TransactionOptions,
} from './transaction.types'
import { StockReconciliationService } from './stock-reconciliation.service'
import { TransactionDetailsSqlHelper } from './transaction-details-sql.helper'
import { TransactionKind } from './transaction-kind.enum'
import { roundWeightKg } from './weight.utils'

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
    try {
      return computeDetailsDiff<D>(existingDetails, incomingDetails)
    } catch (error) {
      if (error instanceof ForeignDetailError) {
        throw new HttpErrors.Forbidden(error.message)
      }
      throw error
    }
  }

  async applyDeletions<D extends DetailBase>(
    toDelete: D[],
    parentId: number,
    transactionKind: TransactionKind,
    dataSource: DataSourceWithTransactions,
    options: TransactionOptions,
  ): Promise<void> {
    if (toDelete.length === 0) return

    const sql = new TransactionDetailsSqlHelper(dataSource, transactionKind)
    for (const detail of toDelete) {
      await this.stockReconciliationService.adjustStock(
        dataSource,
        detail.productId,
        detail.weight_kg,
        transactionKind,
        'undo',
        options.transaction,
        { sourceId: parentId, sourceDetailId: detail.id },
      )
    }
    await sql.batchDeleteByIds(
      toDelete.map(d => d.id!),
      options,
    )
  }

  async applyUpdates<D extends DetailBase>(
    toUpdate: Array<{ old: D; new: D }>,
    parentId: number,
    transactionKind: TransactionKind,
    dataSource: DataSourceWithTransactions,
    options: TransactionOptions,
  ): Promise<void> {
    if (toUpdate.length === 0) return

    const sql = new TransactionDetailsSqlHelper(dataSource, transactionKind)
    for (const { old, new: det } of toUpdate) {
      const newWeight = roundWeightKg(det.weight_kg)

      await this.stockReconciliationService.applyDetailStockDelta(
        dataSource,
        old,
        { productId: det.productId, weight_kg: newWeight },
        transactionKind,
        options.transaction,
        { sourceId: parentId, sourceDetailId: det.id },
      )

      await sql.updateDetailFields(
        det.id!,
        newWeight,
        det.productId,
        det.personId,
        options,
      )
    }
  }

  async applyCreations<D extends DetailBase>(
    toCreate: D[],
    parentId: number,
    transactionKind: TransactionKind,
    relationsAccessor: {
      create(data: Partial<D>, options?: TransactionOptions): Promise<D>
    },
    dataSource: DataSourceWithTransactions,
    options: TransactionOptions,
  ): Promise<void> {
    for (const det of toCreate) {
      const weightKg = roundWeightKg(det.weight_kg)
      // Stock first: adjustStock 404s when the product does not exist, which
      // must win over the detail INSERT's FK violation (409). The Kardex row
      // therefore predates the detail row; its id is backfilled after.
      const kardexId = await this.stockReconciliationService.adjustStock(
        dataSource,
        det.productId,
        weightKg,
        transactionKind,
        'apply',
        options.transaction,
        { sourceId: parentId },
      )
      const created = await relationsAccessor.create(
        {
          weight_kg: weightKg,
          productId: det.productId,
          personId: det.personId,
        } as Partial<D>,
        options,
      )
      await this.stockReconciliationService.attachDetailToKardex(
        kardexId,
        created.id,
        options.transaction,
      )
    }
  }
}
