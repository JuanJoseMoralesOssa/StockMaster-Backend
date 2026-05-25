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
import { PurchaseDetails } from '../../../models'
import {
  PurchaseDetailsRepository,
  PurchaseRepository,
} from '../../../repositories'
import { TransactionService } from '../../../services'

export class PurchaseDetailsController {
  constructor(
    @repository(PurchaseDetailsRepository)
    public purchaseDetailsRepository: PurchaseDetailsRepository,
    @repository(PurchaseRepository)
    public purchaseRepository: PurchaseRepository,
    @service(TransactionService)
    public transactionService: TransactionService,
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
  ): Promise<PurchaseDetails> {
    if (purchaseDetails.purchaseId == null) {
      throw new HttpErrors.BadRequest('purchaseId is required')
    }

    return this.transactionService.createSingleDetail(
      purchaseDetails.purchaseId,
      purchaseDetails,
      this.purchaseRepository,
      'purchase_details',
      true,
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
    description: 'Array of PurchaseDetails model instances',
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
    return this.purchaseDetailsRepository.find(filter)
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
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PurchaseDetails, { partial: true }),
        },
      },
    })
    purchaseDetails: Partial<PurchaseDetails>,
  ): Promise<PurchaseDetails> {
    return this.transactionService.updateSingleDetail(
      id,
      purchaseDetails,
      this.purchaseDetailsRepository,
      true, // isPurchase = true
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
    return this.transactionService.updateSingleDetail(
      id,
      purchaseDetails,
      this.purchaseDetailsRepository,
      true, // isPurchase = true
    )
  }

  @del('/purchase-details/{id}')
  @response(204, {
    description: 'PurchaseDetails DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    await this.transactionService.deleteSingleDetail(
      id,
      this.purchaseDetailsRepository,
      true, // isPurchase = true
    )
  }
}
