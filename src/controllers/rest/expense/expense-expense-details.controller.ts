import { service } from '@loopback/core'
import {
  Count,
  CountSchema,
  Filter,
  repository,
  Where,
} from '@loopback/repository'
import {
  del,
  get,
  getModelSchemaRef,
  getWhereSchemaFor,
  HttpErrors,
  param,
  patch,
  post,
  requestBody,
} from '@loopback/rest'
import { Expense, ExpenseDetails } from '../../../models'
import { ExpenseRepository } from '../../../repositories'
import { TransactionService } from '../../../services'

export class ExpenseExpenseDetailsController {
  constructor(
    @repository(ExpenseRepository)
    protected expenseRepository: ExpenseRepository,
    @service(TransactionService)
    public transactionService: TransactionService,
  ) {}

  @get('/expenses/{id}/expense-details', {
    responses: {
      '200': {
        description: 'Array of Expense has many ExpenseDetails',
        content: {
          'application/json': {
            schema: { type: 'array', items: getModelSchemaRef(ExpenseDetails) },
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<ExpenseDetails>,
  ): Promise<ExpenseDetails[]> {
    return this.expenseRepository.expense_details(id).find(filter)
  }

  @post('/expenses/{id}/expense-details', {
    responses: {
      '200': {
        description: 'Expense model instance',
        content: {
          'application/json': { schema: getModelSchemaRef(ExpenseDetails) },
        },
      },
    },
  })
  async create(
    @param.path.number('id') id: typeof Expense.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(ExpenseDetails, {
            title: 'NewExpenseDetailsInExpense',
            exclude: ['id'],
            optional: ['expenseId'],
          }),
        },
      },
    })
    expenseDetails: Omit<ExpenseDetails, 'id'>,
  ): Promise<ExpenseDetails> {
    return this.transactionService.createSingleDetail(
      id!,
      expenseDetails,
      this.expenseRepository,
      'expense_details',
      false, // isPurchase = false (it's an expense)
    )
  }

  @patch('/expenses/{id}/expense-details', {
    responses: {
      '200': {
        description: 'Expense.ExpenseDetails PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async patch(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(ExpenseDetails, { partial: true }),
        },
      },
    })
    _expenseDetails: Partial<ExpenseDetails>,
    @param.query.object('where', getWhereSchemaFor(ExpenseDetails))
    _where?: Where<ExpenseDetails>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Bulk update is disabled for stock consistency. Use PATCH /expense-details/{id}.',
    )
  }

  @del('/expenses/{id}/expense-details', {
    responses: {
      '200': {
        description: 'Expense.ExpenseDetails DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(ExpenseDetails))
    _where?: Where<ExpenseDetails>,
  ): Promise<Count> {
    await this.transactionService.deleteWithDetails(
      id,
      this.expenseRepository,
      'expense_details',
      false,
    )
    return { count: 1 }
  }
}
