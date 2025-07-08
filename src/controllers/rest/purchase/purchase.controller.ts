import {
  Count,
  CountSchema,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from '@loopback/repository';
import {
  del,
  get,
  getModelSchemaRef,
  param,
  patch,
  post,
  put,
  requestBody,
  response,
} from '@loopback/rest';
import {Pagination, Purchase} from '../../../models';
import {PurchaseRepository} from '../../../repositories/purchase.repository';

export class PurchaseController {
  constructor(
    @repository(PurchaseRepository)
    public purchaseRepository: PurchaseRepository,
  ) { }

  @post('/purchases')
  @response(200, {
    description: 'Purchase model instance',
    content: {'application/json': {schema: getModelSchemaRef(Purchase)}},
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, {
            title: 'NewPurchase',
            exclude: ['id'],
          }),
        },
      },
    })
    purchase: Omit<Purchase, 'id'>,
  ): Promise<Purchase> {
    return this.purchaseRepository.create(purchase);
  }

  @get('/purchases/count')
  @response(200, {
    description: 'Purchase model count',
    content: {'application/json': {schema: CountSchema}},
  })
  async count(
    @param.where(Purchase) where?: Where<Purchase>,
  ): Promise<Count> {
    return this.purchaseRepository.count(where);
  }

  @get('/purchases')
  @response(200, {
    description: 'Array of Purchase model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(Purchase, {includeRelations: true}),
        },
      },
    },
  })
  async find(
    @param.filter(Purchase) filter?: Filter<Purchase>,
    @param.query.number('page') page: number = 1,
    @param.query.number('limit') limit: number = 10,
  ): Promise<Pagination<Purchase>> {
    const purchases = await this.purchaseRepository.find({
      ...filter,
      skip: (page - 1) * limit,
      limit: limit
    });
    const count = await this.purchaseRepository.count(filter?.where);
    return new Pagination<Purchase>({
      count: count.count,
      data: purchases,
      page: page,
      limit: limit
    });
  }

  @patch('/purchases')
  @response(200, {
    description: 'Purchase PATCH success count',
    content: {'application/json': {schema: CountSchema}},
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, {partial: true}),
        },
      },
    })
    purchase: Purchase,
    @param.where(Purchase) where?: Where<Purchase>,
  ): Promise<Count> {
    return this.purchaseRepository.updateAll(purchase, where);
  }

  @get('/purchases/{id}')
  @response(200, {
    description: 'Purchase model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Purchase, {includeRelations: true}),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(Purchase, {exclude: 'where'}) filter?: FilterExcludingWhere<Purchase>
  ): Promise<Purchase> {
    return this.purchaseRepository.findById(id, filter);
  }

  @patch('/purchases/{id}')
  @response(200, {
    description: 'Purchase PATCH success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Purchase, {includeRelations: true}),
      },
    },
  })
  async updateById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, {partial: true}),
        },
      },
    })
    purchase: Partial<Purchase>,
  ): Promise<Purchase> {
    await this.purchaseRepository.updateById(id, purchase);
    return this.purchaseRepository.findById(id, {include: ["purchase_details"]});
  }

  @put('/purchases/{id}')
  @response(200, {
    description: 'Purchase PUT success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Purchase, {includeRelations: true}),
      },
    },
  })
  async replaceById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, {
            title: 'PurchaseReplace',
            exclude: ['id'],
          }),
        },
      },
    })
    purchase: Omit<Purchase, 'id'>,
  ): Promise<Purchase> {
    await this.purchaseRepository.replaceById(id, purchase);
    return this.purchaseRepository.findById(id, {include: ["purchase_details"]});
  }

  @del('/purchases/{id}')
  @response(204, {
    description: 'Purchase DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    await this.purchaseRepository.deleteById(id);
  }
}
