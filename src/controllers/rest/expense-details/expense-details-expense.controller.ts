import { repository } from '@loopback/repository'
import { get, getModelSchemaRef, param } from '@loopback/rest'
import { Roles, requireRoles } from '../../../auth'
import { Expense, ExpenseDetails } from '../../../models'
import { ExpenseDetailsRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class ExpenseDetailsExpenseController {
  constructor(
    @repository(ExpenseDetailsRepository)
    public expenseDetailsRepository: ExpenseDetailsRepository,
  ) {}

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
    return this.expenseDetailsRepository.expense(id)
  }
}
