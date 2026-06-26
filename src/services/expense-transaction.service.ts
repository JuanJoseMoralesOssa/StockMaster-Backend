import { BindingScope, inject, injectable, service } from '@loopback/core'
import { repository } from '@loopback/repository'
import { SecurityBindings, UserProfile } from '@loopback/security'
import { Expense, ExpenseDetails, ExpenseWithTotal } from '../models'
import {
  ExpenseDetailsRepository,
  ExpenseRepository,
  ExpenseWithTotalRepository,
} from '../repositories'
import { DetailMutationService } from './detail-mutation.service'
import { TransactionKind } from './transaction-kind.enum'
import {
  WithDetailsCreateInput,
  WithDetailsUpdateInput,
} from './transaction.types'
import { TransactionWithDetailsService } from './transaction-with-details.service'

const EXPENSE_INCLUDE = { include: ['expense_details'] }

/**
 * Per-kind facade: binds the generic transaction/detail engines to the
 * expense repositories once, so controllers never wire infrastructure
 * (dataSource, relation factories, TransactionKind, the acting user) themselves.
 * It also resolves the authenticated user id here — the request-scoped boundary
 * — and passes it into the engines so the low-level stock service stays free of
 * request/auth context (audit Finding M5).
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class ExpenseTransactionService {
  constructor(
    @service(TransactionWithDetailsService)
    private readonly transactionWithDetailsService: TransactionWithDetailsService,
    @service(DetailMutationService)
    private readonly detailMutationService: DetailMutationService,
    @repository(ExpenseRepository)
    private readonly expenseRepository: ExpenseRepository,
    @repository(ExpenseDetailsRepository)
    private readonly expenseDetailsRepository: ExpenseDetailsRepository,
    @repository(ExpenseWithTotalRepository)
    private readonly expenseWithTotalRepository: ExpenseWithTotalRepository,
    @inject(SecurityBindings.USER, { optional: true })
    private readonly currentUser?: UserProfile,
  ) {}

  private actorId(): number | undefined {
    const id = Number(this.currentUser?.id)
    return Number.isFinite(id) ? id : undefined
  }

  /** Creates the expense + details atomically and returns the canonical view. */
  async createWithDetails(
    input: WithDetailsCreateInput,
  ): Promise<ExpenseWithTotal> {
    const id = await this.transactionWithDetailsService.createWithDetails<
      Expense,
      ExpenseDetails
    >(
      {
        date: input.date,
        details: input.details as ExpenseDetails[] | undefined,
      },
      this.expenseRepository,
      expenseId => this.expenseRepository.expense_details(expenseId),
      TransactionKind.EXPENSE,
      this.actorId(),
    )
    return this.expenseWithTotalRepository.findById(id, EXPENSE_INCLUDE)
  }

  async updateWithDetails(
    input: WithDetailsUpdateInput,
  ): Promise<ExpenseWithTotal> {
    await this.transactionWithDetailsService.updateWithDetails<
      Expense,
      ExpenseDetails
    >(
      {
        id: input.id,
        version: input.version,
        date: input.date,
        details: input.details as ExpenseDetails[] | undefined,
      },
      this.expenseRepository,
      expenseId => this.expenseRepository.expense_details(expenseId),
      TransactionKind.EXPENSE,
      this.actorId(),
    )
    return this.expenseWithTotalRepository.findById(input.id, EXPENSE_INCLUDE)
  }

  async deleteWithDetails(id: number, version?: number): Promise<void> {
    await this.transactionWithDetailsService.deleteWithDetails<
      Expense,
      ExpenseDetails
    >(
      id,
      version,
      this.expenseRepository,
      expenseId => this.expenseRepository.expense_details(expenseId),
      TransactionKind.EXPENSE,
      this.actorId(),
    )
  }

  async createDetail(
    expenseId: number,
    detail: Partial<ExpenseDetails>,
    parentVersion?: number,
  ): Promise<ExpenseDetails> {
    return this.detailMutationService.createSingleDetail(
      expenseId,
      detail,
      id => this.expenseRepository.expense_details(id),
      this.expenseRepository.dataSource,
      TransactionKind.EXPENSE,
      parentVersion,
      this.actorId(),
    )
  }

  async updateDetail(
    id: number,
    detail: Partial<ExpenseDetails>,
    parentVersion?: number,
  ): Promise<ExpenseDetails> {
    return this.detailMutationService.updateSingleDetail(
      id,
      detail,
      this.expenseDetailsRepository,
      TransactionKind.EXPENSE,
      parentVersion,
      this.actorId(),
    )
  }

  async deleteDetail(id: number, parentVersion?: number): Promise<void> {
    await this.detailMutationService.deleteSingleDetail(
      id,
      this.expenseDetailsRepository,
      TransactionKind.EXPENSE,
      parentVersion,
      this.actorId(),
    )
  }
}
