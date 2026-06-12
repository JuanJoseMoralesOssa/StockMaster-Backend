import { BindingScope, injectable, service } from '@loopback/core'
import { repository } from '@loopback/repository'
import { Expense, ExpenseDetails } from '../models'
import { ExpenseDetailsRepository, ExpenseRepository } from '../repositories'
import { DetailMutationService } from './detail-mutation.service'
import { TransactionKind } from './transaction-kind.enum'
import { TransactionWithDetailsService } from './transaction-with-details.service'

export interface CreateExpenseWithDetailsInput {
  date: string
  details?: Array<{
    weight_kg: number
    productId: number
    personId: number
  }>
}

export interface UpdateExpenseWithDetailsInput {
  id: number
  version?: number
  date?: string
  details?: Array<{
    id?: number
    weight_kg: number
    productId: number
    personId: number
  }>
}

/**
 * Per-kind facade: binds the generic transaction/detail engines to the
 * expense repositories once, so controllers never wire infrastructure
 * (dataSource, relation factories, TransactionKind) themselves.
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
  ) {}

  /** Creates the expense + details atomically and returns the new id. */
  async createWithDetails(
    input: CreateExpenseWithDetailsInput,
  ): Promise<number> {
    return this.transactionWithDetailsService.createWithDetails<
      Expense,
      ExpenseDetails
    >(
      {
        date: input.date,
        details: input.details as ExpenseDetails[] | undefined,
      },
      this.expenseRepository,
      id => this.expenseRepository.expense_details(id),
      TransactionKind.EXPENSE,
    )
  }

  async updateWithDetails(input: UpdateExpenseWithDetailsInput): Promise<void> {
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
      id => this.expenseRepository.expense_details(id),
      TransactionKind.EXPENSE,
    )
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
    )
  }

  async deleteDetail(id: number, parentVersion?: number): Promise<void> {
    await this.detailMutationService.deleteSingleDetail(
      id,
      this.expenseDetailsRepository,
      TransactionKind.EXPENSE,
      parentVersion,
    )
  }
}
