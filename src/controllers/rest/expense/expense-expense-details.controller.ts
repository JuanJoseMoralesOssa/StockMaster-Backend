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
import { Roles, requireRoles } from '../../../auth'
import { Expense, ExpenseDetails } from '../../../models'
import { ExpenseRepository } from '../../../repositories'
import { ExpenseTransactionService } from '../../../services'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class ExpenseExpenseDetailsController {
  constructor(
    @repository(ExpenseRepository)
    protected expenseRepository: ExpenseRepository,
    @service(ExpenseTransactionService)
    public expenseTransactionService: ExpenseTransactionService,
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
    @param.query.number('parentVersion') parentVersion: number | undefined,
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
    return this.expenseTransactionService.createDetail(
      id!,
      expenseDetails,
      parentVersion,
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
    @param.path.number('id') _id: number,
    @param.query.object('where', getWhereSchemaFor(ExpenseDetails))
    _where?: Where<ExpenseDetails>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Nested detail deletion is disabled for stock consistency. Use DELETE /expenses/{id} to delete the whole expense, or DELETE /expense-details/{id} for one detail.',
    )
  }
}
