import { repository } from '@loopback/repository'
import { get, getModelSchemaRef, param } from '@loopback/rest'
import { Roles, requireRoles } from '../../../auth'
import { Payment, PaymentDetails } from '../../../models'
import { PaymentDetailsRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PaymentDetailsPaymentController {
  constructor(
    @repository(PaymentDetailsRepository)
    public paymentDetailsRepository: PaymentDetailsRepository,
  ) {}

  @get('/payment-details/{id}/payment', {
    responses: {
      '200': {
        description: 'Payment belonging to PaymentDetails',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Payment),
          },
        },
      },
    },
  })
  async getPayment(
    @param.path.number('id') id: typeof PaymentDetails.prototype.id,
  ): Promise<Payment> {
    return this.paymentDetailsRepository.payment(id)
  }
}
