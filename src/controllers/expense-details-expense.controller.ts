import {
  repository,
} from '@loopback/repository';
import {
  param,
  get,
  getModelSchemaRef,
} from '@loopback/rest';
import {
  ExpenseDetails,
  Expense,
} from '../models';
import {ExpenseDetailsRepository} from '../repositories';

export class ExpenseDetailsExpenseController {
  constructor(
    @repository(ExpenseDetailsRepository)
    public expenseDetailsRepository: ExpenseDetailsRepository,
  ) { }

  @get('/expense-details/{id}/expense', {
    responses: {
      '200': {
        description: 'Expense belonging to ExpenseDetails',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Expense),
          },
        },
      },
    },
  })
  async getExpense(
    @param.path.number('id') id: typeof ExpenseDetails.prototype.id,
  ): Promise<Expense> {
    return this.expenseDetailsRepository.expense(id);
  }
}
