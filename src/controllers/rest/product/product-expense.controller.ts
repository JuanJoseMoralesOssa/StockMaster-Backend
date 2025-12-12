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
import { Expense, Product } from '../../../models'
import { ProductRepository } from '../../../repositories'

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
    @param.path.number('id') id: typeof Product.prototype.id,
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
    expense: Omit<Expense, 'id'>,
  ): Promise<Expense> {
    return this.productRepository.expenses(id).create(expense)
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
    return this.productRepository.expenses(id).patch(expense, where)
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
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(Expense))
    where?: Where<Expense>,
  ): Promise<Count> {
    return this.productRepository.expenses(id).delete(where)
  }
}
