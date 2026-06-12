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
import { Expense, Product } from '../../../models'
import { ProductRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class ProductExpenseController {
  constructor(
    @repository(ProductRepository)
    protected productRepository: ProductRepository,
  ) {}

  @get('/products/{id}/expenses', {
    responses: {
      '200': {
        description: 'Array of Product has many Expense through ExpenseDetails',
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
    return this.productRepository.expenses(id).find(filter)
  }

  @post('/products/{id}/expenses', {
    responses: {
      '200': {
        description: 'create a Expense model instance',
        content: { 'application/json': { schema: getModelSchemaRef(Expense) } },
      },
    },
  })
  async create(
    @param.path.number('id') _id: typeof Product.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, {
            title: 'NewExpenseInProduct',
            exclude: ['id'],
          }),
        },
      },
    })
    _expense: Omit<Expense, 'id'>,
  ): Promise<Expense> {
    throw new HttpErrors.MethodNotAllowed(
      'Use POST /expenses/with-details to create expenses.',
    )
  }

  @patch('/products/{id}/expenses', {
    responses: {
      '200': {
        description: 'Product.Expense PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async patch(
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, { partial: true }),
        },
      },
    })
    _expense: Partial<Expense>,
    @param.query.object('where', getWhereSchemaFor(Expense))
    _where?: Where<Expense>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Use PUT /expenses/with-details to update expenses.',
    )
  }

  @del('/products/{id}/expenses', {
    responses: {
      '200': {
        description: 'Product.Expense DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') _id: number,
    @param.query.object('where', getWhereSchemaFor(Expense))
    _where?: Where<Expense>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Use DELETE /expenses/{id} to delete expenses.',
    )
  }
}
