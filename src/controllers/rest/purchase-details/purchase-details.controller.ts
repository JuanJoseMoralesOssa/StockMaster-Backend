import { service } from '@loopback/core'
import {
  Count,
  CountSchema,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from '@loopback/repository'
import {
  del,
  get,
  getModelSchemaRef,
  HttpErrors,
  param,
  patch,
  post,
  put,
  requestBody,
  response,
} from '@loopback/rest'
import { Roles, requireRoles } from '../../../auth'
import { normalizeLimit, paginationConfig } from '../../../config/pagination'
import { fieldRequiredMessage } from '../../../errors'
import { PurchaseDetails } from '../../../models'
import { PurchaseDetailsRepository } from '../../../repositories'
import { PurchaseTransactionService } from '../../../services'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PurchaseDetailsController {
  constructor(
    @repository(PurchaseDetailsRepository)
    public purchaseDetailsRepository: PurchaseDetailsRepository,
    @service(PurchaseTransactionService)
    public purchaseTransactionService: PurchaseTransactionService,
  ) {}

  @post('/purchase-details')
  @response(200, {
    description: 'PurchaseDetails model instance',
    content: {
      'application/json': { schema: getModelSchemaRef(PurchaseDetails) },
    },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PurchaseDetails, {
            title: 'NewPurchaseDetails',
            exclude: ['id'],
          }),
        },
      },
    })
    purchaseDetails: Omit<PurchaseDetails, 'id'>,
    @param.query.number('parentVersion') parentVersion?: number,
  ): Promise<PurchaseDetails> {
    if (purchaseDetails.purchaseId == null) {
      throw new HttpErrors.BadRequest(fieldRequiredMessage('purchaseId'))
    }

    return this.purchaseTransactionService.createDetail(
      purchaseDetails.purchaseId,
      purchaseDetails,
      parentVersion,
    )
  }

  @get('/purchase-details/count')
  @response(200, {
    description: 'PurchaseDetails model count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async count(
    @param.where(PurchaseDetails) where?: Where<PurchaseDetails>,
  ): Promise<Count> {
    return this.purchaseDetailsRepository.count(where)
  }

  @get('/purchase-details')
  @response(200, {
    description: `Array of PurchaseDetails model instances (capped at ${paginationConfig.MAX_LIMIT} rows; use filter.skip/filter.limit to page)`,
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(PurchaseDetails, { includeRelations: true }),
        },
      },
    },
  })
  async find(
    @param.filter(PurchaseDetails) filter?: Filter<PurchaseDetails>,
  ): Promise<PurchaseDetails[]> {
    return this.purchaseDetailsRepository.find({
      ...filter,
      limit: normalizeLimit(filter?.limit ?? paginationConfig.MAX_LIMIT),
    })
  }

  @patch('/purchase-details')
  @response(200, {
    description: 'PurchaseDetails PATCH success count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PurchaseDetails, { partial: true }),
        },
      },
    })
    purchaseDetails: PurchaseDetails,
    @param.where(PurchaseDetails) where?: Where<PurchaseDetails>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Bulk update is disabled for stock consistency. Use PATCH /purchase-details/{id}.',
    )
  }

  @get('/purchase-details/{id}')
  @response(200, {
    description: 'PurchaseDetails model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PurchaseDetails, { includeRelations: true }),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(PurchaseDetails, { exclude: 'where' })
    filter?: FilterExcludingWhere<PurchaseDetails>,
  ): Promise<PurchaseDetails> {
    return this.purchaseDetailsRepository.findById(id, filter)
  }

  @patch('/purchase-details/{id}')
  @response(200, {
    description: 'PurchaseDetails PATCH success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PurchaseDetails, { includeRelations: true }),
      },
    },
  })
  async updateById(
    @param.path.number('id') id: number,
    @param.query.number('parentVersion') parentVersion: number | undefined,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PurchaseDetails, { partial: true }),
        },
      },
    })
    purchaseDetails: Partial<PurchaseDetails>,
  ): Promise<PurchaseDetails> {
    return this.purchaseTransactionService.updateDetail(
      id,
      purchaseDetails,
      parentVersion,
    )
  }

  @put('/purchase-details/{id}')
  @response(200, {
    description: 'PurchaseDetails PUT success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PurchaseDetails, { includeRelations: true }),
      },
    },
  })
  async replaceById(
    @param.path.number('id') id: number,
    @param.query.number('parentVersion') parentVersion: number | undefined,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PurchaseDetails, {
            title: 'PurchaseDetailsReplace',
            exclude: ['id'],
          }),
        },
      },
    })
    purchaseDetails: Omit<PurchaseDetails, 'id'>,
  ): Promise<PurchaseDetails> {
    return this.purchaseTransactionService.updateDetail(
      id,
      purchaseDetails,
      parentVersion,
    )
  }

  @del('/purchase-details/{id}')
  @response(204, {
    description: 'PurchaseDetails DELETE success',
  })
  async deleteById(
    @param.path.number('id') id: number,
    @param.query.number('parentVersion') parentVersion: number | undefined,
  ): Promise<void> {
    await this.purchaseTransactionService.deleteDetail(id, parentVersion)
  }
}
