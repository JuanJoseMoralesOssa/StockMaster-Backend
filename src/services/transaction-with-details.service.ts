import { BindingScope, injectable, service } from '@loopback/core'
import { HttpErrors } from '@loopback/rest'
import { validateDate as validateTransactionDate } from './date-validation.utils'
import { DetailDiffService } from './detail-diff.service'
import { TransactionDetailsSqlHelper } from './transaction-details-sql.helper'
import { TransactionKind } from './transaction-kind.enum'
import { TRANSACTION_CONFIG } from './transaction-type.const'
import {
  DataSourceWithTransactions,
  DetailBase,
  RelationFactory,
  TransactionOptions,
  TransactionRepository,
} from './transaction.types'

export interface CreateTransactionWithDetailsInput<TDetail extends DetailBase> {
  date: string
  details?: TDetail[]
}

export interface UpdateTransactionWithDetailsInput<TDetail extends DetailBase> {
  id: number
  version?: number
  date?: string
  details?: TDetail[]
}

@injectable({ scope: BindingScope.TRANSIENT })
export class TransactionWithDetailsService {
  constructor(
    @service(DetailDiffService)
    private readonly detailDiffService: DetailDiffService,
  ) {}

  async createWithDetails<
    TParent extends { id?: number; date?: string },
    TDetail extends DetailBase,
  >(
    input: CreateTransactionWithDetailsInput<TDetail>,
    parentRepository: TransactionRepository<TParent>,
    detailsRelationFactory: RelationFactory<TDetail>,
    transactionKind: TransactionKind,
  ): Promise<TParent> {
    validateTransactionDate(input.date)

    const details = input.details ?? []
    if (details.length === 0) {
      throw new HttpErrors.BadRequest(
        'A transaction must have at least one detail.',
      )
    }
    this.validateDetails(details)

    const config = TRANSACTION_CONFIG[transactionKind]

    return this.runInTransaction(
      parentRepository.dataSource,
      async (tx: TransactionOptions) => {
        const parent = await parentRepository.create(
          { date: input.date } as Partial<TParent>,
          tx,
        )

        const parentId = parent.id
        if (parentId == null) {
          throw new HttpErrors.BadRequest(
            'Created transaction does not contain an id',
          )
        }

        const detailsRelation = detailsRelationFactory(parentId)
        await this.detailDiffService.applyCreations(
          details,
          parentId,
          transactionKind,
          detailsRelation,
          parentRepository.dataSource,
          tx,
        )

        return parentRepository.findById(
          parentId,
          { include: [config.relationName] },
          tx,
        )
      },
    )
  }

  async updateWithDetails<
    TParent extends { id?: number; date?: string; version?: number },
    TDetail extends DetailBase,
  >(
    input: UpdateTransactionWithDetailsInput<TDetail>,
    parentRepository: TransactionRepository<TParent>,
    detailsRelationFactory: RelationFactory<TDetail>,
    transactionKind: TransactionKind,
  ): Promise<TParent> {
    if (!input.id) {
      throw new HttpErrors.BadRequest('Transaction ID is required for update')
    }

    if (input.version === undefined) {
      throw new HttpErrors.Conflict(
        'Este registro fue modificado por otro usuario. Por favor recarga y vuelve a intentarlo.',
      )
    }

    if (input.date) {
      validateTransactionDate(input.date)
    }

    const details = input.details ?? []
    if (details.length === 0) {
      throw new HttpErrors.BadRequest(
        'A transaction must have at least one detail.',
      )
    }
    this.validateDetails(details)

    const config = TRANSACTION_CONFIG[transactionKind]
    const sql = new TransactionDetailsSqlHelper(
      parentRepository.dataSource,
      transactionKind,
    )

    return this.runInTransaction(
      parentRepository.dataSource,
      async (tx: TransactionOptions) => {
        const currentParent = await parentRepository.findById(input.id, {}, tx)
        const detailsRelation = detailsRelationFactory(input.id)
        const existingDetails = await detailsRelation.find({}, tx)
        const diff = this.detailDiffService.computeDiff(
          existingDetails,
          details,
        )
        const parentPayload = this.buildParentUpdatePayload<TParent>(input)
        const hasMutations =
          diff.toCreate.length > 0 ||
          diff.toUpdate.length > 0 ||
          diff.toDelete.length > 0 ||
          this.hasParentMutations(parentPayload, currentParent)

        await sql.updateParentWithVersionCheck(
          input.id,
          input.version!,
          parentPayload as Record<string, unknown>,
          hasMutations ? input.version! + 1 : input.version!,
          tx,
        )

        await this.detailDiffService.applyDeletions(
          diff.toDelete,
          transactionKind,
          parentRepository.dataSource,
          tx,
        )
        await this.detailDiffService.applyUpdates(
          diff.toUpdate,
          transactionKind,
          parentRepository.dataSource,
          tx,
        )
        await this.detailDiffService.applyCreations(
          diff.toCreate,
          input.id,
          transactionKind,
          detailsRelation,
          parentRepository.dataSource,
          tx,
        )

        return parentRepository.findById(
          input.id,
          { include: [config.relationName] },
          tx,
        )
      },
    )
  }

  async deleteWithDetails<
    TParent extends { id?: number },
    TDetail extends DetailBase,
  >(
    id: number,
    parentRepository: TransactionRepository<TParent>,
    detailsRelationFactory: RelationFactory<TDetail>,
    transactionKind: TransactionKind,
  ): Promise<void> {
    await this.runInTransaction(
      parentRepository.dataSource,
      async (tx: TransactionOptions) => {
        const detailsRelation = detailsRelationFactory(id)
        const details = await detailsRelation.find({}, tx)

        await this.detailDiffService.applyDeletions(
          details,
          transactionKind,
          parentRepository.dataSource,
          tx,
        )

        await detailsRelation.delete({}, tx)
        await parentRepository.deleteById(id, tx)
      },
    )
  }

  private validateDetails(details: DetailBase[]): void {
    for (const detail of details) {
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
  }

  private buildParentUpdatePayload<TParent>(
    input: UpdateTransactionWithDetailsInput<DetailBase>,
  ): Partial<TParent> {
    const payload = { ...input } as Record<string, unknown>
    delete payload.details
    delete payload.id
    delete payload.version

    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) {
        delete payload[key]
      }
    }

    return payload as Partial<TParent>
  }

  private hasParentMutations<TParent extends object>(
    payload: Partial<TParent>,
    currentParent: TParent,
  ): boolean {
    const current = currentParent as Record<string, unknown>
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
