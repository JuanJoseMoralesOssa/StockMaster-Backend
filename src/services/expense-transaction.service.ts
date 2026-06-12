import { BindingScope, injectable, service } from '@loopback/core'
import { repository } from '@loopback/repository'
import { Expense, ExpenseDetails } from '../models'
import { ExpenseRepository } from '../repositories'
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

@injectable({ scope: BindingScope.TRANSIENT })
export class ExpenseTransactionService {
  constructor(
    @service(TransactionWithDetailsService)
    private readonly transactionWithDetailsService: TransactionWithDetailsService,
    @repository(ExpenseRepository)
    private readonly expenseRepository: ExpenseRepository,
  ) {}

  async createWithDetails(
    input: CreateExpenseWithDetailsInput,
  ): Promise<Expense> {
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

  async updateWithDetails(
    input: UpdateExpenseWithDetailsInput,
  ): Promise<Expense> {
    return this.transactionWithDetailsService.updateWithDetails<
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

  async deleteWithDetails(id: number): Promise<void> {
    await this.transactionWithDetailsService.deleteWithDetails<
      Expense,
      ExpenseDetails
    >(
      id,
      this.expenseRepository,
      expenseId => this.expenseRepository.expense_details(expenseId),
      TransactionKind.EXPENSE,
    )
  }
}
