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
import { Product, Purchase } from '../../../models'
import { ProductRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class ProductPurchaseController {
  constructor(
    @repository(ProductRepository)
    protected productRepository: ProductRepository,
  ) {}

  @get('/products/{id}/purchases', {
    responses: {
      '200': {
        description:
          'Array of Product has many Purchase through PurchaseDetails',
        content: {
          'application/json': {
            schema: { type: 'array', items: getModelSchemaRef(Purchase) },
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<Purchase>,
  ): Promise<Purchase[]> {
    return this.productRepository.purchases(id).find(filter)
  }

  @post('/products/{id}/purchases', {
    responses: {
      '200': {
        description: 'create a Purchase model instance',
        content: {
          'application/json': { schema: getModelSchemaRef(Purchase) },
        },
      },
    },
  })
  async create(
    @param.path.number('id') _id: typeof Product.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, {
            title: 'NewPurchaseInProduct',
            exclude: ['id'],
          }),
        },
      },
    })
    _purchase: Omit<Purchase, 'id'>,
  ): Promise<Purchase> {
    throw new HttpErrors.MethodNotAllowed(
      'Use POST /purchases/with-details to create purchases.',
    )
  }

  @patch('/products/{id}/purchases', {
    responses: {
      '200': {
        description: 'Product.Purchase PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async patch(
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, { partial: true }),
        },
      },
    })
    _purchase: Partial<Purchase>,
    @param.query.object('where', getWhereSchemaFor(Purchase))
    _where?: Where<Purchase>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Use PUT /purchases/with-details to update purchases.',
    )
  }

  @del('/products/{id}/purchases', {
    responses: {
      '200': {
        description: 'Product.Purchase DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') _id: number,
    @param.query.object('where', getWhereSchemaFor(Purchase))
    _where?: Where<Purchase>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Use DELETE /purchases/{id} to delete purchases.',
    )
  }
}
