import { repository } from '@loopback/repository'
import { get, getModelSchemaRef, param } from '@loopback/rest'
import { Roles, requireRoles } from '../../../auth'
import { Person, PurchaseDetails } from '../../../models'
import { PurchaseDetailsRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PurchaseDetailsPersonController {
  constructor(
    @repository(PurchaseDetailsRepository)
    public purchaseDetailsRepository: PurchaseDetailsRepository,
  ) {}

  @get('/purchase-details/{id}/person', {
    responses: {
      '200': {
        description: 'Person belonging to PurchaseDetails',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Person),
          },
        },
      },
    },
  })
  async getPerson(
    @param.path.number('id') id: typeof PurchaseDetails.prototype.id,
  ): Promise<Person> {
    return this.purchaseDetailsRepository.person(id)
  }
}
