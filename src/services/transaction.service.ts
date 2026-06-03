import { BindingScope, injectable, service } from '@loopback/core'
import { HttpErrors } from '@loopback/rest'
import { computeDetailsDiff } from './transaction-diff.utils'
import { validateDate as validateTransactionDate } from './date-validation.utils'
import { TransactionDetailsSqlHelper } from './transaction-details-sql.helper'
import {
  DataSourceWithTransactions,
  DetailBase,
  DetailRepository,
  RelationAccessor,
  RelationFactory,
  TransactionContext,
  TransactionRepository,
} from './transaction.types'
import { StockReconciliationService } from './stock-reconciliation.service'

export { roundWeightKg }

/** Rounds a weight to 3 decimal places (kg precision we persist). */
function roundWeightKg(n: number): number {
  return Math.round(n * 1000) / 1000
}

@injectable({ scope: BindingScope.TRANSIENT })
export class TransactionService {
  constructor(
    @service(StockReconciliationService)
    private readonly stockReconciliationService: StockReconciliationService,
  ) {}

  async createWithDetails<
    T extends { id?: number; date: string },
    D extends { weight_kg: number; productId: number; personId: number },
  >(
    transactionData: Partial<T> & { details?: D[] },
    transactionRepository: TransactionRepository<T>,
    detailsRelationName: string,
    isPurchase: boolean,
  ): Promise<T> {
    this.validateDate(transactionData.date!)

    if (!transactionData.details || transactionData.details.length === 0) {
      throw new HttpErrors.BadRequest(
        'A transaction must have at least one detail.',
      )
    }

    return this.runInTransaction(
      transactionRepository.dataSource,
      async (tx: TransactionContext) => {
        const { details, ...cleanTransactionData } = transactionData
        const transaction = await transactionRepository.create(
          cleanTransactionData as Partial<T>,
          { transaction: tx },
        )
        const transactionId = transaction.id

        if (transactionId == null) {
          throw new HttpErrors.BadRequest(
            'Created transaction does not contain an id',
          )
        }

        if (details && details.length > 0) {
          const detailsRelation = this.getRelationAccessor<T, D>(
            transactionRepository,
            detailsRelationName,
            transactionId,
          )

          for (const detail of details) {
            const weightKg = roundWeightKg(detail.weight_kg)
            await detailsRelation.create(
              {
                weight_kg: weightKg,
                productId: detail.productId,
                personId: detail.personId,
              } as Partial<D>,
              { transaction: tx },
            )
            await this.stockReconciliationService.adjustStock(
              transactionRepository.dataSource,
              detail.productId,
              weightKg,
              isPurchase,
              'apply',
              tx,
            )
          }
        }

        return transactionRepository.findById(
          transactionId,
          { include: [detailsRelationName] },
          { transaction: tx },
        )
      },
    )
  }

  async updateWithDetails<
    T extends { id?: number; date?: string; version?: number },
    D extends {
      id?: number
      weight_kg: number
      productId: number
      personId: number
    },
  >(
    transactionData: Partial<Omit<T, 'id'>> & {
      id: number
      version?: number
      details?: D[]
    },
    transactionRepository: TransactionRepository<T>,
    detailsRelationName: string,
    isPurchase: boolean,
  ): Promise<T> {
    if (!transactionData.id) {
      throw new HttpErrors.BadRequest('Transaction ID is required for update')
    }

    if (transactionData.version === undefined) {
      throw new HttpErrors.Conflict(
        'Este registro fue modificado por otro usuario. Por favor recarga y vuelve a intentarlo.',
      )
    }

    if (transactionData.date) {
      this.validateDate(transactionData.date)
    }

    const details = transactionData.details ?? []
    if (details.length === 0) {
      throw new HttpErrors.BadRequest(
        'A transaction must have at least one detail.',
      )
    }

    this.validateDetailsForUpdate(details)

    const sql = new TransactionDetailsSqlHelper(
      transactionRepository.dataSource,
      detailsRelationName,
    )

    return this.runInTransaction(
      transactionRepository.dataSource,
      async (tx: TransactionContext) => {
        await sql.lockParentRow(transactionData.id, transactionData.version!, {
          transaction: tx,
        })

        const currentTransaction = await transactionRepository.findById(
          transactionData.id,
          {},
          { transaction: tx },
        )

        const detailsRelation = this.getRelationAccessor<T, D>(
          transactionRepository,
          detailsRelationName,
          transactionData.id,
        )
        const existingDetails = await detailsRelation.find(
          {},
          { transaction: tx },
        )

        const { toCreate, toUpdate, toDelete } = computeDetailsDiff<D>(
          existingDetails as D[],
          details,
        )

        // Deletions: undo stock then batch-delete from DB
        if (toDelete.length > 0) {
          for (const oldDet of toDelete) {
            await this.stockReconciliationService.adjustStock(
              transactionRepository.dataSource,
              oldDet.productId,
              oldDet.weight_kg,
              isPurchase,
              'undo',
              tx,
            )
          }
          await sql.batchDeleteByIds(
            toDelete.map(d => d.id!),
            { transaction: tx },
          )
        }

        // Updates: reconcile stock delta then update row in DB
        if (toUpdate.length > 0) {
          for (const { old, new: det } of toUpdate) {
            const newWeight = roundWeightKg(det.weight_kg)
            if (old.productId !== det.productId) {
              await this.stockReconciliationService.adjustStock(
                transactionRepository.dataSource,
                old.productId,
                old.weight_kg,
                isPurchase,
                'undo',
                tx,
              )
              await this.stockReconciliationService.adjustStock(
                transactionRepository.dataSource,
                det.productId,
                newWeight,
                isPurchase,
                'apply',
                tx,
              )
            } else {
              const diff = roundWeightKg(newWeight - old.weight_kg)
              if (diff !== 0) {
                await this.stockReconciliationService.adjustStock(
                  transactionRepository.dataSource,
                  det.productId,
                  Math.abs(diff),
                  isPurchase,
                  diff > 0 ? 'apply' : 'undo',
                  tx,
                )
              }
            }
            await sql.updateDetailFields(
              det.id!,
              newWeight,
              det.productId,
              det.personId,
              { transaction: tx },
            )
          }
        }

        // Creations: create detail + apply stock
        if (toCreate.length > 0) {
          for (const det of toCreate) {
            const weightKg = roundWeightKg(det.weight_kg)
            await detailsRelation.create(
              {
                weight_kg: weightKg,
                productId: det.productId,
                personId: det.personId,
              } as Partial<D>,
              { transaction: tx },
            )
            await this.stockReconciliationService.adjustStock(
              transactionRepository.dataSource,
              det.productId,
              weightKg,
              isPurchase,
              'apply',
              tx,
            )
          }
        }

        const parentPayload = this.buildParentUpdatePayload<T>(transactionData)
        const hasMutations =
          toCreate.length > 0 ||
          toUpdate.length > 0 ||
          toDelete.length > 0 ||
          this.hasParentMutations(parentPayload, currentTransaction)
        const currentVersion = currentTransaction.version ?? 1
        const updatePayload = {
          ...parentPayload,
          version: hasMutations ? currentVersion + 1 : currentVersion,
        } as Partial<T>

        await transactionRepository.updateById(
          transactionData.id,
          updatePayload,
          {
            transaction: tx,
          },
        )

        return transactionRepository.findById(
          transactionData.id,
          { include: [detailsRelationName] },
          { transaction: tx },
        )
      },
    )
  }

  async deleteWithDetails(
    id: number,
    transactionRepository: TransactionRepository<{ id?: number }>,
    detailsRelationName: string,
    isPurchase: boolean,
  ): Promise<void> {
    await this.runInTransaction(
      transactionRepository.dataSource,
      async (tx: TransactionContext) => {
        const detailsRelation = this.getRelationAccessor(
          transactionRepository,
          detailsRelationName,
          id,
        )
        const details = await detailsRelation.find({}, { transaction: tx })

        if (details && details.length > 0) {
          for (const detail of details) {
            await this.stockReconciliationService.adjustStock(
              transactionRepository.dataSource,
              detail.productId,
              detail.weight_kg,
              isPurchase,
              'undo',
              tx,
            )
          }
        }

        await detailsRelation.delete({}, { transaction: tx })
        await transactionRepository.deleteById(id, { transaction: tx })
      },
    )
  }

  async updateSingleDetail<TDetail extends DetailBase>(
    id: number,
    updatedDetail: Partial<TDetail>,
    detailsRepository: DetailRepository<TDetail>,
    isPurchase: boolean,
  ): Promise<TDetail> {
    if (updatedDetail.weight_kg != null) {
      updatedDetail.weight_kg = roundWeightKg(updatedDetail.weight_kg)
    }
    return this.runInTransaction(
      detailsRepository.dataSource,
      async (tx: TransactionContext) => {
        const oldDetail = await detailsRepository.findById(
          id,
          {},
          { transaction: tx },
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
                isPurchase,
                diff > 0 ? 'apply' : 'undo',
                tx,
              )
            }
          } else {
            await this.stockReconciliationService.adjustStock(
              detailsRepository.dataSource,
              oldProductId,
              oldWeight,
              isPurchase,
              'undo',
              tx,
            )
            await this.stockReconciliationService.adjustStock(
              detailsRepository.dataSource,
              newProductId,
              newWeight,
              isPurchase,
              'apply',
              tx,
            )
          }
        }

        await detailsRepository.updateById(id, updatedDetail, {
          transaction: tx,
        })
        return detailsRepository.findById(
          id,
          { include: [] },
          { transaction: tx },
        )
      },
    )
  }

  async deleteSingleDetail<TDetail extends DetailBase>(
    id: number,
    detailsRepository: DetailRepository<TDetail>,
    isPurchase: boolean,
  ): Promise<void> {
    await this.runInTransaction(
      detailsRepository.dataSource,
      async (tx: TransactionContext) => {
        const detail = await detailsRepository.findById(
          id,
          {},
          { transaction: tx },
        )
        await this.stockReconciliationService.adjustStock(
          detailsRepository.dataSource,
          detail.productId,
          detail.weight_kg,
          isPurchase,
          'undo',
          tx,
        )
        await detailsRepository.deleteById(id, { transaction: tx })
      },
    )
  }

  async createSingleDetail<
    TParent extends { id?: number },
    TDetail extends DetailBase,
  >(
    parentId: number,
    newDetail: Partial<TDetail>,
    parentRepository: TransactionRepository<TParent>,
    detailsRelationName: string,
    isPurchase: boolean,
  ): Promise<TDetail> {
    this.validateDetailForCreate(newDetail)
    if (newDetail.weight_kg != null) {
      newDetail.weight_kg = roundWeightKg(newDetail.weight_kg)
    }

    return this.runInTransaction(
      parentRepository.dataSource,
      async (tx: TransactionContext) => {
        const detailsRelation = this.getRelationAccessor<TParent, TDetail>(
          parentRepository,
          detailsRelationName,
          parentId,
        )
        const detail = await detailsRelation.create(newDetail, {
          transaction: tx,
        })
        await this.stockReconciliationService.adjustStock(
          parentRepository.dataSource,
          detail.productId,
          detail.weight_kg,
          isPurchase,
          'apply',
          tx,
        )
        return detail
      },
    )
  }

  public validateDate(date: string): void {
    validateTransactionDate(date)
  }

  private validateDetailsForUpdate(
    details: Array<{
      id?: number
      weight_kg: number
      productId: number
      personId: number
    }>,
  ): void {
    for (const det of details) {
      if (det.productId == null || det.personId == null) {
        throw new HttpErrors.BadRequest(
          'Product ID and Person ID are required for detail operations',
        )
      }
      if (det.weight_kg == null || det.weight_kg <= 0) {
        throw new HttpErrors.BadRequest(
          'Weight must be a positive number for detail operations',
        )
      }
    }
  }

  private validateDetailForCreate(detail: Partial<DetailBase>): void {
    if (detail.productId == null || detail.personId == null) {
      throw new HttpErrors.BadRequest(
        'Product ID and Person ID are required for create operations',
      )
    }
    if (detail.weight_kg == null || detail.weight_kg <= 0) {
      throw new HttpErrors.BadRequest(
        'Weight must be a positive number for create operations',
      )
    }
  }

  private buildParentUpdatePayload<T>(transactionData: object): Partial<T> {
    const payload = { ...transactionData } as Record<string, unknown>
    delete payload.details
    delete payload.id
    delete payload.version

    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) {
        delete payload[key]
      }
    }

    return payload as Partial<T>
  }

  private hasParentMutations<T extends object>(
    payload: Partial<T>,
    currentTransaction: T,
  ): boolean {
    const current = currentTransaction as Record<string, unknown>
    return Object.entries(payload as Record<string, unknown>).some(
      ([key, value]) =>
        this.normalizeComparableValue(current[key]) !==
        this.normalizeComparableValue(value),
    )
  }

  private normalizeComparableValue(value: unknown): unknown {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10)
    }
    if (typeof value === 'string') {
      const datePrefix = /^\d{4}-\d{2}-\d{2}/.exec(value)
      return datePrefix ? datePrefix[0] : value
    }
    return value
  }

  private async runInTransaction<T>(
    dataSource: DataSourceWithTransactions,
    work: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    if (typeof dataSource.transaction !== 'function') {
      throw new HttpErrors.InternalServerError(
        'DataSource does not support transactions',
      )
    }
    let result: T | undefined
    await dataSource.transaction(async tx => {
      result = await work(tx)
    })
    return result as T
  }

  private getRelationAccessor<
    TEntity extends { id?: number },
    TDetail extends DetailBase,
  >(
    transactionRepository: TransactionRepository<TEntity>,
    detailsRelationName: string,
    parentId: number,
  ): RelationAccessor<TDetail> {
    const relationFactory = (transactionRepository as Record<string, unknown>)[
      detailsRelationName
    ] as RelationFactory<TDetail> | undefined

    if (typeof relationFactory !== 'function') {
      throw new HttpErrors.BadRequest(
        `Invalid details relation: ${detailsRelationName}`,
      )
    }
    return relationFactory(parentId)
  }
}
