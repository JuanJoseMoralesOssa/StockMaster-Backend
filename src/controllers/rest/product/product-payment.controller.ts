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
import { ProductRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class ProductPaymentController {
  constructor(
    @repository(ProductRepository)
    protected productRepository: ProductRepository,
  ) {}

  @get('/products/{id}/payments', {
    responses: {
      '200': {
        description: 'Array of Product has many Payment through PaymentDetails',
        content: {
          'application/json': {
            schema: { type: 'array', items: getModelSchemaRef(Payment) },
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<Payment>,
  ): Promise<Payment[]> {
    return this.productRepository.payments(id).find(filter)
  }

  @post('/products/{id}/payments', {
    responses: {
      '200': {
        description: 'create a Payment model instance',
        content: { 'application/json': { schema: getModelSchemaRef(Payment) } },
      },
    },
  })
  async create(
    @param.path.number('id') _id: typeof Product.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Payment, {
            title: 'NewPaymentInProduct',
            exclude: ['id'],
          }),
        },
      },
    })
    _payment: Omit<Payment, 'id'>,
  ): Promise<Payment> {
    throw new HttpErrors.MethodNotAllowed(
      'Use POST /payments/with-details to create payments.',
    )
  }

  @patch('/products/{id}/payments', {
    responses: {
      '200': {
        description: 'Product.Payment PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async patch(
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Payment, { partial: true }),
        },
      },
    })
    _payment: Partial<Payment>,
    @param.query.object('where', getWhereSchemaFor(Payment))
    _where?: Where<Payment>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Use PUT /payments/with-details to update payments.',
    )
  }

  @del('/products/{id}/payments', {
    responses: {
      '200': {
        description: 'Product.Payment DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') _id: number,
    @param.query.object('where', getWhereSchemaFor(Payment))
    _where?: Where<Payment>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Use DELETE /payments/{id} to delete payments.',
    )
  }
}
