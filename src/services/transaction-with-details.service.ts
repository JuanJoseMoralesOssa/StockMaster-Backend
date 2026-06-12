import { BindingScope, injectable, service } from '@loopback/core'
import { HttpErrors } from '@loopback/rest'
import { USER_MESSAGES } from '../errors'
import { validateDate as validateTransactionDate } from './date-validation.utils'
import { DetailReconciliationService } from './detail-reconciliation.service'
import { requireVersion } from './optimistic-lock.utils'
import { runInTransaction } from './transaction-execution.utils'
import { TransactionDetailsSqlHelper } from './transaction-details-sql.helper'
import { TransactionKind } from './transaction-kind.enum'
import {
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
    @service(DetailReconciliationService)
    private readonly detailReconciliationService: DetailReconciliationService,
  ) {}

  /**
   * Creates the transaction and its details atomically.
   * Returns only the new id: callers (controllers) re-read the canonical
   * WithTotal representation, so fetching the full relation tree here would
   * be a discarded query that extends the lock window.
   */
  async createWithDetails<
    TParent extends { id?: number; date?: string },
    TDetail extends DetailBase,
  >(
    input: CreateTransactionWithDetailsInput<TDetail>,
    parentRepository: TransactionRepository<TParent>,
    detailsRelationFactory: RelationFactory<TDetail>,
    transactionKind: TransactionKind,
  ): Promise<number> {
    validateTransactionDate(input.date)

    const details = input.details ?? []
    if (details.length === 0) {
      throw new HttpErrors.BadRequest(USER_MESSAGES.AT_LEAST_ONE_DETAIL)
    }
    this.validateDetails(details)

    return runInTransaction(
      parentRepository.dataSource,
      async (tx: TransactionOptions) => {
        const parent = await parentRepository.create(
          { date: input.date } as Partial<TParent>,
          tx,
        )

        const parentId = parent.id
        if (parentId == null) {
          throw new HttpErrors.InternalServerError(
            'Created transaction does not contain an id',
          )
        }

        const detailsRelation = detailsRelationFactory(parentId)
        await this.detailReconciliationService.applyCreations(
          details,
          parentId,
          transactionKind,
          detailsRelation,
          parentRepository.dataSource,
          tx,
        )

        return parentId
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
  ): Promise<void> {
    if (!input.id) {
      throw new HttpErrors.BadRequest(USER_MESSAGES.TRANSACTION_ID_REQUIRED)
    }
    const expectedVersion = requireVersion(input.version, 'version')

    if (input.date) {
      validateTransactionDate(input.date)
    }

    const details = input.details ?? []
    if (details.length === 0) {
      throw new HttpErrors.BadRequest(USER_MESSAGES.AT_LEAST_ONE_DETAIL)
    }
    this.validateDetails(details)

    const sql = new TransactionDetailsSqlHelper(
      parentRepository.dataSource,
      transactionKind,
    )

    await runInTransaction(
      parentRepository.dataSource,
      async (tx: TransactionOptions) => {
        const currentParent = await parentRepository.findById(input.id, {}, tx)
        const detailsRelation = detailsRelationFactory(input.id)
        const existingDetails = await detailsRelation.find({}, tx)
        const diff = this.detailReconciliationService.computeDiff(
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
          expectedVersion,
          parentPayload as Record<string, unknown>,
          hasMutations ? expectedVersion + 1 : expectedVersion,
          tx,
        )

        await this.detailReconciliationService.applyDeletions(
          diff.toDelete,
          input.id,
          transactionKind,
          parentRepository.dataSource,
          tx,
        )
        await this.detailReconciliationService.applyUpdates(
          diff.toUpdate,
          input.id,
          transactionKind,
          parentRepository.dataSource,
          tx,
        )
        await this.detailReconciliationService.applyCreations(
          diff.toCreate,
          input.id,
          transactionKind,
          detailsRelation,
          parentRepository.dataSource,
          tx,
        )
      },
    )
  }

  /**
   * Deletes the transaction with its details, undoing their stock effect.
   * The optimistic-lock version is mandatory: delete is the most destructive
   * mutation and gets the same lost-update protection as update.
   */
  async deleteWithDetails<
    TParent extends { id?: number },
    TDetail extends DetailBase,
  >(
    id: number,
    expectedVersion: number | undefined,
    parentRepository: TransactionRepository<TParent>,
    detailsRelationFactory: RelationFactory<TDetail>,
    transactionKind: TransactionKind,
  ): Promise<void> {
    const version = requireVersion(expectedVersion, 'version')
    const sql = new TransactionDetailsSqlHelper(
      parentRepository.dataSource,
      transactionKind,
    )

    await runInTransaction(
      parentRepository.dataSource,
      async (tx: TransactionOptions) => {
        await sql.lockParentRow(id, version, tx)

        const detailsRelation = detailsRelationFactory(id)
        const details = await detailsRelation.find({}, tx)

        await this.detailReconciliationService.applyDeletions(
          details,
          id,
          transactionKind,
          parentRepository.dataSource,
          tx,
        )

        await parentRepository.deleteById(id, tx)
      },
    )
  }

  private validateDetails(details: DetailBase[]): void {
    for (const detail of details) {
      if (detail.productId == null || detail.personId == null) {
        throw new HttpErrors.BadRequest(USER_MESSAGES.DETAIL_FIELDS_REQUIRED)
      }
      if (detail.weight_kg == null || detail.weight_kg <= 0) {
        throw new HttpErrors.BadRequest(USER_MESSAGES.WEIGHT_POSITIVE)
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

  /**
   * Normalizes values for the no-op comparison. The date-prefix slicing is
   * only safe because updateParentWithVersionCheck whitelists `date` as the
   * sole updatable parent field — if more fields are ever whitelisted there,
   * revisit this normalization.
   */
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
}
