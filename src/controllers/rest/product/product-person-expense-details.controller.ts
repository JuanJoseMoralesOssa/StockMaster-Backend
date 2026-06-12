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
import { Person, Product } from '../../../models'
import { ProductRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class ProductPersonExpenseDetailsController {
  constructor(
    @repository(ProductRepository)
    protected productRepository: ProductRepository,
  ) {}

  @get('/products/{id}/people-expense-details', {
    responses: {
      '200': {
        description: 'Array of Product has many Person through ExpenseDetails',
        content: {
          'application/json': {
            schema: { type: 'array', items: getModelSchemaRef(Person) },
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<Person>,
  ): Promise<Person[]> {
    return this.productRepository.people_expense_details(id).find(filter)
  }

  @post('/products/{id}/people-expense-details', {
    responses: {
      '200': {
        description: 'create a Person model instance',
        content: { 'application/json': { schema: getModelSchemaRef(Person) } },
      },
    },
  })
  async create(
    @param.path.number('id') _id: typeof Product.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, {
            title: 'NewPersonInProduct',
            exclude: ['id'],
          }),
        },
      },
    })
    _person: Omit<Person, 'id'>,
  ): Promise<Person> {
    throw new HttpErrors.MethodNotAllowed(
      'Use POST /expenses/with-details to create expenses.',
    )
  }

  @patch('/products/{id}/people-expense-details', {
    responses: {
      '200': {
        description: 'Product.Person PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async patch(
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, { partial: true }),
        },
      },
    })
    _person: Partial<Person>,
    @param.query.object('where', getWhereSchemaFor(Person))
    _where?: Where<Person>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Use PUT /expenses/with-details to update expenses.',
    )
  }

  @del('/products/{id}/people-expense-details', {
    responses: {
      '200': {
        description: 'Product.Person DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') _id: number,
    @param.query.object('where', getWhereSchemaFor(Person))
    _where?: Where<Person>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Use DELETE /expenses/{id} to delete expenses.',
    )
  }
}
