import { BindingScope, injectable, service } from '@loopback/core'
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
export class DetailDiffService {
  constructor(
    @service(StockReconciliationService)
    private readonly stockReconciliationService: StockReconciliationService,
  ) {}

  computeDiff<D extends DetailBase>(
    existingDetails: D[],
    incomingDetails: D[],
  ): DetailDiff<D> {
    return computeDetailsDiff<D>(existingDetails, incomingDetails)
  }

  async applyDeletions<D extends DetailBase>(
    toDelete: D[],
    transactionKind: TransactionKind,
    dataSource: DataSourceWithTransactions,
    options: TransactionOptions,
  ): Promise<void> {
    const sql = new TransactionDetailsSqlHelper(dataSource, transactionKind)

    if (toDelete.length > 0) {
      for (const detail of toDelete) {
        await this.stockReconciliationService.adjustStock(
          dataSource,
          detail.productId,
          detail.weight_kg,
          transactionKind,
          'undo',
          options.transaction,
        )
      }
      await sql.batchDeleteByIds(
        toDelete.map(d => d.id!),
        options,
      )
    }
  }

  async applyUpdates<D extends DetailBase>(
    toUpdate: Array<{ old: D; new: D }>,
    transactionKind: TransactionKind,
    dataSource: DataSourceWithTransactions,
    options: TransactionOptions,
  ): Promise<void> {
    const sql = new TransactionDetailsSqlHelper(dataSource, transactionKind)

    if (toUpdate.length > 0) {
      for (const { old, new: det } of toUpdate) {
        const newWeight = roundWeightKg(det.weight_kg)

        if (old.productId !== det.productId) {
          await this.stockReconciliationService.adjustStock(
            dataSource,
            old.productId,
            old.weight_kg,
            transactionKind,
            'undo',
            options.transaction,
          )
          await this.stockReconciliationService.adjustStock(
            dataSource,
            det.productId,
            newWeight,
            transactionKind,
            'apply',
            options.transaction,
          )
        } else {
          const diff = roundWeightKg(newWeight - old.weight_kg)
          if (diff !== 0) {
            await this.stockReconciliationService.adjustStock(
              dataSource,
              det.productId,
              Math.abs(diff),
              transactionKind,
              diff > 0 ? 'apply' : 'undo',
              options.transaction,
            )
          }
        }

        await sql.updateDetailFields(
          det.id!,
          newWeight,
          det.productId,
          det.personId,
          options,
        )
      }
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
    if (toCreate.length > 0) {
      for (const det of toCreate) {
        const weightKg = roundWeightKg(det.weight_kg)
        await this.stockReconciliationService.adjustStock(
          dataSource,
          det.productId,
          weightKg,
          transactionKind,
          'apply',
          options.transaction,
        )
        await relationsAccessor.create(
          {
            weight_kg: weightKg,
            productId: det.productId,
            personId: det.personId,
          } as Partial<D>,
          options,
        )
      }
    }
  }
}
