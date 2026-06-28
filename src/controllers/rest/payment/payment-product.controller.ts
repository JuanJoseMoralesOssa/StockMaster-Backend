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
import { Payment, Product } from '../../../models'
import { PaymentRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PaymentProductController {
  constructor(
    @repository(PaymentRepository)
    protected paymentRepository: PaymentRepository,
  ) {}

  @get('/payments/{id}/products', {
    responses: {
      '200': {
        description: 'Array of Payment has many Product through PaymentDetails',
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
    return this.paymentRepository.products(id).find(filter)
  }

  @post('/payments/{id}/products', {
    responses: {
      '200': {
        description: 'create a Product model instance',
        content: { 'application/json': { schema: getModelSchemaRef(Product) } },
      },
    },
  })
  async create(
    @param.path.number('id') _id: typeof Payment.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, {
            title: 'NewProductInPayment',
            exclude: ['id'],
          }),
        },
      },
    })
    _product: Omit<Product, 'id'>,
  ): Promise<Product> {
    throw new HttpErrors.MethodNotAllowed(
      'Creating products through payments is disabled for balance consistency. Use POST /payment-details with parentVersion.',
    )
  }

  @patch('/payments/{id}/products', {
    responses: {
      '200': {
        description: 'Payment.Product PATCH success count',
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
      'Updating products through payments is disabled for balance consistency. Use PATCH /products/{id}; balance is managed by transaction details.',
    )
  }

  @del('/payments/{id}/products', {
    responses: {
      '200': {
        description: 'Payment.Product DELETE success count',
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
      'Deleting products through payments is disabled for balance consistency. Use DELETE /products/{id}.',
    )
  }
}
