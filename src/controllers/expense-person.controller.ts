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
import {
Expense,
ExpenseDetails,
Person,
} from '../models';
import {ExpenseRepository} from '../repositories';

export class ExpensePersonController {
  constructor(
    @repository(ExpenseRepository) protected expenseRepository: ExpenseRepository,
  ) { }

  @get('/expenses/{id}/people', {
    responses: {
      '200': {
        description: 'Array of Expense has many Person through ExpenseDetails',
        content: {
          'application/json': {
            schema: {type: 'array', items: getModelSchemaRef(Person)},
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<Person>,
  ): Promise<Person[]> {
    return this.expenseRepository.people(id).find(filter);
  }

  @post('/expenses/{id}/people', {
    responses: {
      '200': {
        description: 'create a Person model instance',
        content: {'application/json': {schema: getModelSchemaRef(Person)}},
      },
    },
  })
  async create(
    @param.path.number('id') id: typeof Expense.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, {
            title: 'NewPersonInExpense',
            exclude: ['id'],
          }),
        },
      },
    }) person: Omit<Person, 'id'>,
  ): Promise<Person> {
    return this.expenseRepository.people(id).create(person);
  }

  @patch('/expenses/{id}/people', {
    responses: {
      '200': {
        description: 'Expense.Person PATCH success count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async patch(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, {partial: true}),
        },
      },
    })
    person: Partial<Person>,
    @param.query.object('where', getWhereSchemaFor(Person)) where?: Where<Person>,
  ): Promise<Count> {
    return this.expenseRepository.people(id).patch(person, where);
  }

  @del('/expenses/{id}/people', {
    responses: {
      '200': {
        description: 'Expense.Person DELETE success count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async delete(
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(Person)) where?: Where<Person>,
  ): Promise<Count> {
    return this.expenseRepository.people(id).delete(where);
  }
}
