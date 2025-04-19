import {
  Count,
  CountSchema,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from '@loopback/repository';
import {
  post,
  param,
  get,
  getModelSchemaRef,
  patch,
  put,
  del,
  requestBody,
  response,
} from '@loopback/rest';
import {PurchaseDetails} from '../models';
import {PurchaseDetailsRepository} from '../repositories';

export class PurchaseDetailsController {
  constructor(
    @repository(PurchaseDetailsRepository)
    public purchaseDetailsRepository : PurchaseDetailsRepository,
  ) {}

  @post('/purchase-details')
  @response(200, {
    description: 'PurchaseDetails model instance',
    content: {'application/json': {schema: getModelSchemaRef(PurchaseDetails)}},
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
    return this.purchaseDetailsRepository.create(purchaseDetails);
  }

  @get('/purchase-details/count')
  @response(200, {
    description: 'PurchaseDetails model count',
    content: {'application/json': {schema: CountSchema}},
  })
  async count(
    @param.where(PurchaseDetails) where?: Where<PurchaseDetails>,
  ): Promise<Count> {
    return this.purchaseDetailsRepository.count(where);
  }

  @get('/purchase-details')
  @response(200, {
    description: 'Array of PurchaseDetails model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(PurchaseDetails, {includeRelations: true}),
        },
      },
    },
  })
  async find(
    @param.filter(PurchaseDetails) filter?: Filter<PurchaseDetails>,
  ): Promise<PurchaseDetails[]> {
    return this.purchaseDetailsRepository.find(filter);
  }

  @patch('/purchase-details')
  @response(200, {
    description: 'PurchaseDetails PATCH success count',
    content: {'application/json': {schema: CountSchema}},
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PurchaseDetails, {partial: true}),
        },
      },
    })
    purchaseDetails: PurchaseDetails,
    @param.where(PurchaseDetails) where?: Where<PurchaseDetails>,
  ): Promise<Count> {
    return this.purchaseDetailsRepository.updateAll(purchaseDetails, where);
  }

  @get('/purchase-details/{id}')
  @response(200, {
    description: 'PurchaseDetails model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PurchaseDetails, {includeRelations: true}),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(PurchaseDetails, {exclude: 'where'}) filter?: FilterExcludingWhere<PurchaseDetails>
  ): Promise<PurchaseDetails> {
    return this.purchaseDetailsRepository.findById(id, filter);
  }

  @patch('/purchase-details/{id}')
  @response(204, {
    description: 'PurchaseDetails PATCH success',
  })
  async updateById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PurchaseDetails, {partial: true}),
        },
      },
    })
    purchaseDetails: PurchaseDetails,
  ): Promise<void> {
    await this.purchaseDetailsRepository.updateById(id, purchaseDetails);
  }

  @put('/purchase-details/{id}')
  @response(204, {
    description: 'PurchaseDetails PUT success',
  })
  async replaceById(
    @param.path.number('id') id: number,
    @requestBody() purchaseDetails: PurchaseDetails,
  ): Promise<void> {
    await this.purchaseDetailsRepository.replaceById(id, purchaseDetails);
  }

  @del('/purchase-details/{id}')
  @response(204, {
    description: 'PurchaseDetails DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    await this.purchaseDetailsRepository.deleteById(id);
  }
}
