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
import { Product, Purchase } from '../../../models'
import { PurchaseRepository } from '../../../repositories/purchase.repository'

export class PurchaseProductController {
  constructor(
    @repository(PurchaseRepository)
    protected purchaseRepository: PurchaseRepository,
  ) {}

  @get('/purchases/{id}/products', {
    responses: {
      '200': {
        description:
          'Array of Purchase has many Product through PurchaseDetails',
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
    return this.purchaseRepository.products(id).find(filter)
  }

  @post('/purchases/{id}/products', {
    responses: {
      '200': {
        description: 'create a Product model instance',
        content: { 'application/json': { schema: getModelSchemaRef(Product) } },
      },
    },
  })
  async create(
    @param.path.number('id') id: typeof Purchase.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, {
            title: 'NewProductInPurchase',
            exclude: ['id'],
          }),
        },
      },
    })
    product: Omit<Product, 'id'>,
  ): Promise<Product> {
    return this.purchaseRepository.products(id).create(product)
  }

  @patch('/purchases/{id}/products', {
    responses: {
      '200': {
        description: 'Purchase.Product PATCH success count',
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
    return this.purchaseRepository.products(id).patch(product, where)
  }

  @del('/purchases/{id}/products', {
    responses: {
      '200': {
        description: 'Purchase.Product DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(Product))
    where?: Where<Product>,
  ): Promise<Count> {
    return this.purchaseRepository.products(id).delete(where)
  }
}
