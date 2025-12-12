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
  param,
  patch,
  post,
  requestBody,
} from '@loopback/rest'
import { Purchase, PurchaseDetails } from '../../../models'
import { PurchaseRepository } from '../../../repositories/purchase.repository'

export class PurchasePurchaseDetailsController {
  constructor(
    @repository(PurchaseRepository)
    protected purchaseRepository: PurchaseRepository,
  ) {}

  @get('/purchases/{id}/purchase-details', {
    responses: {
      '200': {
        description: 'Array of Purchase has many PurchaseDetails',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: getModelSchemaRef(PurchaseDetails),
            },
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<PurchaseDetails>,
  ): Promise<PurchaseDetails[]> {
    return this.purchaseRepository.purchase_details(id).find(filter)
  }

  @post('/purchases/{id}/purchase-details', {
    responses: {
      '200': {
        description: 'Purchase model instance',
        content: {
          'application/json': { schema: getModelSchemaRef(PurchaseDetails) },
        },
      },
    },
  })
  async create(
    @param.path.number('id') id: typeof Purchase.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PurchaseDetails, {
            title: 'NewPurchaseDetailsInPurchase',
            exclude: ['id'],
            optional: ['purchaseId'],
          }),
        },
      },
    })
    purchaseDetails: Omit<PurchaseDetails, 'id'>,
  ): Promise<PurchaseDetails> {
    return this.purchaseRepository.purchase_details(id).create(purchaseDetails)
  }

  @patch('/purchases/{id}/purchase-details', {
    responses: {
      '200': {
        description: 'Purchase.PurchaseDetails PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async patch(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PurchaseDetails, { partial: true }),
        },
      },
    })
    purchaseDetails: Partial<PurchaseDetails>,
    @param.query.object('where', getWhereSchemaFor(PurchaseDetails))
    where?: Where<PurchaseDetails>,
  ): Promise<Count> {
    return this.purchaseRepository
      .purchase_details(id)
      .patch(purchaseDetails, where)
  }

  @del('/purchases/{id}/purchase-details', {
    responses: {
      '200': {
        description: 'Purchase.PurchaseDetails DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(PurchaseDetails))
    where?: Where<PurchaseDetails>,
  ): Promise<Count> {
    return this.purchaseRepository.purchase_details(id).delete(where)
  }
}
