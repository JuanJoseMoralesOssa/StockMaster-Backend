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
  Purchase,
} from '../models';
import {PurchaseDetailsRepository} from '../repositories';

export class PurchaseDetailsPurchaseController {
  constructor(
    @repository(PurchaseDetailsRepository)
    public purchaseDetailsRepository: PurchaseDetailsRepository,
  ) { }

  @get('/purchase-details/{id}/purchase', {
    responses: {
      '200': {
        description: 'Purchase belonging to PurchaseDetails',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Purchase),
          },
        },
      },
    },
  })
  async getPurchase(
    @param.path.number('id') id: typeof PurchaseDetails.prototype.id,
  ): Promise<Purchase> {
    return this.purchaseDetailsRepository.purchase(id);
  }
}
