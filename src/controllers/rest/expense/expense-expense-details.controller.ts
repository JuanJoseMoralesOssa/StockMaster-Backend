import {
  Count,
  CountSchema,
  Filter,
  repository,
  Where,
} from '@loopback/repository';
import {
  del,
  get,
  getModelSchemaRef,
  getWhereSchemaFor,
  param,
  patch,
  post,
  requestBody,
} from '@loopback/rest';
import {Expense, ExpenseDetails} from '../../../models';
import {ExpenseRepository} from '../../../repositories';


export class ExpenseExpenseDetailsController {
  constructor(
    @repository(ExpenseRepository)
    protected expenseRepository: ExpenseRepository,
  ) { }

  @get('/expenses/{id}/expense-details', {
    responses: {
      '200': {
        description: 'Array of Expense has many ExpenseDetails',
        content: {
          'application/json': {
            schema: {type: 'array', items: getModelSchemaRef(ExpenseDetails)},
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<ExpenseDetails>,
  ): Promise<ExpenseDetails[]> {
    return this.expenseRepository.expense_details(id).find(filter);
  }

  @post('/expenses/{id}/expense-details', {
    responses: {
      '200': {
        description: 'Expense model instance',
        content: {
          'application/json': {schema: getModelSchemaRef(ExpenseDetails)},
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
    return this.expenseRepository.expense_details(id).create(expenseDetails);
  }

  @patch('/expenses/{id}/expense-details', {
    responses: {
      '200': {
        description: 'Expense.ExpenseDetails PATCH success count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async patch(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(ExpenseDetails, {partial: true}),
        },
      },
    })
    expenseDetails: Partial<ExpenseDetails>,
    @param.query.object('where', getWhereSchemaFor(ExpenseDetails))
    where?: Where<ExpenseDetails>,
  ): Promise<Count> {
    return this.expenseRepository
      .expense_details(id)
      .patch(expenseDetails, where);
  }

  @del('/expenses/{id}/expense-details', {
    responses: {
      '200': {
        description: 'Expense.ExpenseDetails DELETE success count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async delete(
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(ExpenseDetails))
    where?: Where<ExpenseDetails>,
  ): Promise<Count> {
    return this.expenseRepository.expense_details(id).delete(where);
  }
}
