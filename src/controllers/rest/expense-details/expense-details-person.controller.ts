import { repository } from '@loopback/repository'
import { get, getModelSchemaRef, param } from '@loopback/rest'
import { ExpenseDetails, Person } from '../../../models'
import { ExpenseDetailsRepository } from '../../../repositories'

export class ExpenseDetailsPersonController {
  constructor(
    @repository(ExpenseDetailsRepository)
    public expenseDetailsRepository: ExpenseDetailsRepository,
  ) {}

  @get('/expense-details/{id}/person', {
    responses: {
      '200': {
        description: 'Person belonging to ExpenseDetails',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Person),
          },
        },
      },
    },
  })
  async getPerson(
    @param.path.number('id') id: typeof ExpenseDetails.prototype.id,
  ): Promise<Person> {
    return this.expenseDetailsRepository.person(id)
  }
}
