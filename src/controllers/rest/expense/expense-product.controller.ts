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
import { ExpenseRepository } from '../../../repositories'

export class ExpenseProductController {
  constructor(
    @repository(ExpenseRepository)
    protected expenseRepository: ExpenseRepository,
  ) {}

  @get('/expenses/{id}/products', {
    responses: {
      '200': {
        description: 'Array of Expense has many Product through ExpenseDetails',
        content: {
          'application/json': {
            schema: { type: 'array', items: getModelSchemaRef(Product) },
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<Product>,
  ): Promise<Product[]> {
    return this.expenseRepository.products(id).find(filter)
  }

  @post('/expenses/{id}/products', {
    responses: {
      '200': {
        description: 'create a Product model instance',
        content: { 'application/json': { schema: getModelSchemaRef(Product) } },
      },
    },
  })
  async create(
    @param.path.number('id') id: typeof Expense.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, {
            title: 'NewProductInExpense',
            exclude: ['id'],
          }),
        },
      },
    })
    product: Omit<Product, 'id'>,
  ): Promise<Product> {
    return this.expenseRepository.products(id).create(product)
  }

  @patch('/expenses/{id}/products', {
    responses: {
      '200': {
        description: 'Expense.Product PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async patch(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, { partial: true }),
        },
      },
    })
    product: Partial<Product>,
    @param.query.object('where', getWhereSchemaFor(Product))
    where?: Where<Product>,
  ): Promise<Count> {
    return this.expenseRepository.products(id).patch(product, where)
  }

  @del('/expenses/{id}/products', {
    responses: {
      '200': {
        description: 'Expense.Product DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(Product))
    where?: Where<Product>,
  ): Promise<Count> {
    return this.expenseRepository.products(id).delete(where)
  }
}
