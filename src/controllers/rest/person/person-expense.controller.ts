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
  param,
  patch,
  post,
  requestBody,
} from '@loopback/rest'
import { Expense, Person } from '../../../models'
import { PersonRepository } from '../../../repositories'

export class PersonExpenseController {
  constructor(
    @repository(PersonRepository) protected personRepository: PersonRepository,
  ) {}

  @get('/people/{id}/expenses', {
    responses: {
      '200': {
        description: 'Array of Person has many Expense through ExpenseDetails',
        content: {
          'application/json': {
            schema: { type: 'array', items: getModelSchemaRef(Expense) },
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<Expense>,
  ): Promise<Expense[]> {
    return this.personRepository.expenses(id).find(filter)
  }

  @post('/people/{id}/expenses', {
    responses: {
      '200': {
        description: 'create a Expense model instance',
        content: { 'application/json': { schema: getModelSchemaRef(Expense) } },
      },
    },
  })
  async create(
    @param.path.number('id') id: typeof Person.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, {
            title: 'NewExpenseInPerson',
            exclude: ['id'],
          }),
        },
      },
    })
    expense: Omit<Expense, 'id'>,
  ): Promise<Expense> {
    return this.personRepository.expenses(id).create(expense)
  }

  @patch('/people/{id}/expenses', {
    responses: {
      '200': {
        description: 'Person.Expense PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async patch(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, { partial: true }),
        },
      },
    })
    expense: Partial<Expense>,
    @param.query.object('where', getWhereSchemaFor(Expense))
    where?: Where<Expense>,
  ): Promise<Count> {
    return this.personRepository.expenses(id).patch(expense, where)
  }

  @del('/people/{id}/expenses', {
    responses: {
      '200': {
        description: 'Person.Expense DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(Expense))
    where?: Where<Expense>,
  ): Promise<Count> {
    return this.personRepository.expenses(id).delete(where)
  }
}
