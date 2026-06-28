import { repository } from '@loopback/repository'
import { get, getModelSchemaRef, param } from '@loopback/rest'
import { Roles, requireRoles } from '../../../auth'
import { PaymentDetails, Person } from '../../../models'
import { PaymentDetailsRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PaymentDetailsPersonController {
  constructor(
    @repository(PaymentDetailsRepository)
    public paymentDetailsRepository: PaymentDetailsRepository,
  ) {}

  @get('/payment-details/{id}/person', {
    responses: {
      '200': {
        description: 'Person belonging to PaymentDetails',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Person),
          },
        },
      },
    },
  })
  async getPerson(
    @param.path.number('id') id: typeof PaymentDetails.prototype.id,
  ): Promise<Person> {
    return this.paymentDetailsRepository.person(id)
  }
}
