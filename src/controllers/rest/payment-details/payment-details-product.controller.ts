import { repository } from '@loopback/repository'
import { get, getModelSchemaRef, param } from '@loopback/rest'
import { Roles, requireRoles } from '../../../auth'
import { PaymentDetails, Product } from '../../../models'
import { PaymentDetailsRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PaymentDetailsProductController {
  constructor(
    @repository(PaymentDetailsRepository)
    public paymentDetailsRepository: PaymentDetailsRepository,
  ) {}

  @get('/payment-details/{id}/product', {
    responses: {
      '200': {
        description: 'Product belonging to PaymentDetails',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Product),
          },
        },
      },
    },
  })
  async getProduct(
    @param.path.number('id') id: typeof PaymentDetails.prototype.id,
  ): Promise<Product> {
    return this.paymentDetailsRepository.product(id)
  }
}
