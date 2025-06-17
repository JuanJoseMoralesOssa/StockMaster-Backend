import {
  repository,
} from '@loopback/repository';
import {
  param,
  get,
  getModelSchemaRef,
} from '@loopback/rest';
import {
  PurchaseDetails,
  Person,
} from '../models';
import {PurchaseDetailsRepository} from '../repositories';

export class PurchaseDetailsPersonController {
  constructor(
    @repository(PurchaseDetailsRepository)
    public purchaseDetailsRepository: PurchaseDetailsRepository,
  ) { }

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
    return this.purchaseDetailsRepository.person(id);
  }
}
