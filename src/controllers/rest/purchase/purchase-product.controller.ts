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
import { PurchaseRepository } from '../../../repositories/purchase.repository'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
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
    @param.path.number('id') _id: typeof Purchase.prototype.id,
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
    _product: Omit<Product, 'id'>,
  ): Promise<Product> {
    throw new HttpErrors.MethodNotAllowed(
      'Creating products through purchases is disabled for stock consistency. Use POST /purchase-details with parentVersion.',
    )
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
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, { partial: true }),
        },
      },
    })
    _product: Partial<Product>,
    @param.query.object('where', getWhereSchemaFor(Product))
    _where?: Where<Product>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Updating products through purchases is disabled for stock consistency. Use PATCH /products/{id}; stock is managed by transaction details.',
    )
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
    @param.path.number('id') _id: number,
    @param.query.object('where', getWhereSchemaFor(Product))
    _where?: Where<Product>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Deleting products through purchases is disabled for stock consistency. Use DELETE /products/{id}.',
    )
  }
}
