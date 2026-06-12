import { repository } from '@loopback/repository'
import { get, getModelSchemaRef, param } from '@loopback/rest'
import { Roles, requireRoles } from '../../../auth'
import { Product, PurchaseDetails } from '../../../models'
import { PurchaseDetailsRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PurchaseDetailsProductController {
  constructor(
    @repository(PurchaseDetailsRepository)
    public purchaseDetailsRepository: PurchaseDetailsRepository,
  ) {}

  @get('/purchase-details/{id}/product', {
    responses: {
      '200': {
        description: 'Product belonging to PurchaseDetails',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Product),
          },
        },
      },
    },
  })
  async getProduct(
    @param.path.number('id') id: typeof PurchaseDetails.prototype.id,
  ): Promise<Product> {
    return this.purchaseDetailsRepository.product(id)
  }
}
