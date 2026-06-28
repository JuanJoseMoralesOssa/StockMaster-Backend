import { BindingScope, injectable, service } from '@loopback/core'
import { USER_MESSAGES, ValidationError } from '../errors'
import { validateDate as validateTransactionDate } from './date-validation.utils'
import { assertDetailsValid } from './detail-validation.utils'
import { DetailReconciliationService } from './detail-reconciliation.service'
import { requireVersion } from './optimistic-lock.utils'
import { runInTransaction } from './transaction-execution.utils'
import { TransactionDetailsSqlHelper } from './transaction-details-sql.helper'
import { TransactionKind } from './transaction-kind.enum'
import {
  UPDATABLE_PARENT_FIELDS,
  UpdatableParentField,
} from './transaction-type.const'
import {
  DetailBase,
  RelationFactory,
  TransactionRepository,
  TxScope,
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
   * Returns only the new id: callers (the per-kind facade) re-read the canonical
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
    actorId?: number,
  ): Promise<number> {
    validateTransactionDate(input.date)

    const details = input.details ?? []
    if (details.length === 0) {
      throw new ValidationError(USER_MESSAGES.AT_LEAST_ONE_DETAIL)
    }
    assertDetailsValid(details)

    return runInTransaction(parentRepository.dataSource, async options => {
      const parent = await parentRepository.create(
        { date: input.date } as Partial<TParent>,
        options,
      )

      const parentId = parent.id
      if (parentId == null) {
        // Internal invariant: a freshly created row must have a generated id.
        throw new Error('Created transaction does not contain an id')
      }

      const scope: TxScope = {
        dataSource: parentRepository.dataSource,
        transactionKind,
        options,
        actorId,
      }
      const detailsRelation = detailsRelationFactory(parentId)
      await this.detailReconciliationService.applyCreations(
        scope,
        details,
        parentId,
        detailsRelation,
      )

      return parentId
    })
  }

  async updateWithDetails<
    TParent extends { id?: number; date?: string; version?: number },
    TDetail extends DetailBase,
  >(
    input: UpdateTransactionWithDetailsInput<TDetail>,
    parentRepository: TransactionRepository<TParent>,
    detailsRelationFactory: RelationFactory<TDetail>,
    transactionKind: TransactionKind,
    actorId?: number,
  ): Promise<void> {
    if (!input.id) {
      throw new ValidationError(USER_MESSAGES.TRANSACTION_ID_REQUIRED)
    }
    const expectedVersion = requireVersion(input.version, 'version')

    if (input.date) {
      validateTransactionDate(input.date)
    }

    const details = input.details ?? []
    if (details.length === 0) {
      throw new ValidationError(USER_MESSAGES.AT_LEAST_ONE_DETAIL)
    }
    assertDetailsValid(details)

    const sql = new TransactionDetailsSqlHelper(
      parentRepository.dataSource,
      transactionKind,
    )

    await runInTransaction(parentRepository.dataSource, async options => {
      const scope: TxScope = {
        dataSource: parentRepository.dataSource,
        transactionKind,
        options,
        actorId,
      }
      const currentParent = await parentRepository.findById(
        input.id,
        {},
        options,
      )
      const detailsRelation = detailsRelationFactory(input.id)
      const existingDetails = await detailsRelation.find({}, options)
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
        options,
      )

      // delete → update → create ordering is owned by the reconciler (one place).
      await this.detailReconciliationService.reconcileDiff(
        scope,
        diff,
        input.id,
        detailsRelation,
      )
    })
  }

  /**
   * Deletes the transaction with its details, undoing their balance effect.
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
    actorId?: number,
  ): Promise<void> {
    const version = requireVersion(expectedVersion, 'version')
    const sql = new TransactionDetailsSqlHelper(
      parentRepository.dataSource,
      transactionKind,
    )

    await runInTransaction(parentRepository.dataSource, async options => {
      await sql.lockParentRow(id, version, options)

      const scope: TxScope = {
        dataSource: parentRepository.dataSource,
        transactionKind,
        options,
        actorId,
      }
      const detailsRelation = detailsRelationFactory(id)
      const details = await detailsRelation.find({}, options)

      await this.detailReconciliationService.applyDeletions(scope, details, id)

      await parentRepository.deleteById(id, options)
    })
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

  /**
   * Decides whether the parent document actually changed, so an idempotent
   * re-PUT does not burn an optimistic-lock version. Driven by
   * UPDATABLE_PARENT_FIELDS — the SAME whitelist the SQL writer enforces — so
   * the no-op detector and the writer cannot disagree about which columns
   * matter (a disagreement would silently skip the version bump and reopen the
   * lost-update window the version field exists to close).
   */
  private hasParentMutations<TParent extends object>(
    payload: Partial<TParent>,
    currentParent: TParent,
  ): boolean {
    const current = currentParent as Record<string, unknown>
    const incoming = payload as Record<string, unknown>
    return UPDATABLE_PARENT_FIELDS.some(field => {
      if (!(field in incoming)) return false
      return (
        this.normalizeComparableValue(field, current[field]) !==
        this.normalizeComparableValue(field, incoming[field])
      )
    })
  }

  /**
   * Per-field normalization for the no-op comparison. `date` is persisted at
   * day precision, so compare day-only whether the value arrives as a Date or
   * an ISO string; other (future) fields compare by raw value.
   */
  private normalizeComparableValue(
    field: UpdatableParentField,
    value: unknown,
  ): unknown {
    if (field === 'date') {
      return this.toDateOnly(value)
    }
    return value
  }

  private toDateOnly(value: unknown): unknown {
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
