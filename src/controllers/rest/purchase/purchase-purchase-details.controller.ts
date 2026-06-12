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
import { Purchase, PurchaseDetails } from '../../../models'
import { PurchaseRepository } from '../../../repositories/purchase.repository'
import { PurchaseTransactionService } from '../../../services'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PurchasePurchaseDetailsController {
  constructor(
    @repository(PurchaseRepository)
    protected purchaseRepository: PurchaseRepository,
    @service(PurchaseTransactionService)
    public purchaseTransactionService: PurchaseTransactionService,
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
    @param.query.number('parentVersion') parentVersion: number | undefined,
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
    return this.purchaseTransactionService.createDetail(
      id!,
      purchaseDetails,
      parentVersion,
    )
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
    _purchaseDetails: Partial<PurchaseDetails>,
    @param.query.object('where', getWhereSchemaFor(PurchaseDetails))
    _where?: Where<PurchaseDetails>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Bulk update is disabled for stock consistency. Use PATCH /purchase-details/{id}.',
    )
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
    @param.path.number('id') _id: number,
    @param.query.object('where', getWhereSchemaFor(PurchaseDetails))
    _where?: Where<PurchaseDetails>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Nested detail deletion is disabled for stock consistency. Use DELETE /purchases/{id} to delete the whole purchase, or DELETE /purchase-details/{id} for one detail.',
    )
  }
}
