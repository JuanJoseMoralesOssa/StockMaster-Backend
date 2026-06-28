import { service } from '@loopback/core'
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
import { Payment, PaymentDetails } from '../../../models'
import { PaymentRepository } from '../../../repositories'
import { PaymentTransactionService } from '../../../services'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PaymentPaymentDetailsController {
  constructor(
    @repository(PaymentRepository)
    protected paymentRepository: PaymentRepository,
    @service(PaymentTransactionService)
    public paymentTransactionService: PaymentTransactionService,
  ) {}

  @get('/payments/{id}/payment-details', {
    responses: {
      '200': {
        description: 'Array of Payment has many PaymentDetails',
        content: {
          'application/json': {
            schema: { type: 'array', items: getModelSchemaRef(PaymentDetails) },
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<PaymentDetails>,
  ): Promise<PaymentDetails[]> {
    return this.paymentRepository.payment_details(id).find(filter)
  }

  @post('/payments/{id}/payment-details', {
    responses: {
      '200': {
        description: 'Payment model instance',
        content: {
          'application/json': { schema: getModelSchemaRef(PaymentDetails) },
        },
      },
    },
  })
  async create(
    @param.path.number('id') id: typeof Payment.prototype.id,
    @param.query.number('parentVersion') parentVersion: number | undefined,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PaymentDetails, {
            title: 'NewPaymentDetailsInPayment',
            exclude: ['id'],
            optional: ['paymentId'],
          }),
        },
      },
    })
    paymentDetails: Omit<PaymentDetails, 'id'>,
  ): Promise<PaymentDetails> {
    return this.paymentTransactionService.createDetail(
      id!,
      paymentDetails,
      parentVersion,
    )
  }

  @patch('/payments/{id}/payment-details', {
    responses: {
      '200': {
        description: 'Payment.PaymentDetails PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async patch(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PaymentDetails, { partial: true }),
        },
      },
    })
    _paymentDetails: Partial<PaymentDetails>,
    @param.query.object('where', getWhereSchemaFor(PaymentDetails))
    _where?: Where<PaymentDetails>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Bulk update is disabled for balance consistency. Use PATCH /payment-details/{id}.',
    )
  }

  @del('/payments/{id}/payment-details', {
    responses: {
      '200': {
        description: 'Payment.PaymentDetails DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') _id: number,
    @param.query.object('where', getWhereSchemaFor(PaymentDetails))
    _where?: Where<PaymentDetails>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Nested detail deletion is disabled for balance consistency. Use DELETE /payments/{id} to delete the whole payment, or DELETE /payment-details/{id} for one detail.',
    )
  }
}
