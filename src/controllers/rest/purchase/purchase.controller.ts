import {service} from '@loopback/core';
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
  HttpErrors,
  param,
  patch,
  post,
  put,
  requestBody,
  response
} from '@loopback/rest';
import {Pagination, Purchase} from '../../../models';
import {PurchaseRepository} from '../../../repositories/purchase.repository';
import {TransactionService} from '../../../services';

export class PurchaseController {
  constructor(
    @repository(PurchaseRepository)
    public purchaseRepository: PurchaseRepository,
    @service(TransactionService)
    public transactionService: TransactionService,
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
    this.transactionService.validateDate(purchase.date);
    const createdPurchase = await this.purchaseRepository.create(purchase);
    return this.purchaseRepository.findById(createdPurchase.id!, {
      include: ['purchase_details']
    });
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

  /**
   * Crea una compra con sus detalles en una transacción atómica
   */
  @post('/purchases/with-details')
  @response(200, {
    description: 'Purchase created with details',
    content: {'application/json': {schema: getModelSchemaRef(Purchase, {includeRelations: true})}},
  })
  async createWithDetails(
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['date'],
            properties: {
              date: {type: 'string', format: 'date'},
              purchaseDetails: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['weight_kg', 'productId', 'personId'],
                  properties: {
                    weight_kg: {type: 'number'},
                    productId: {type: 'number'},
                    personId: {type: 'number'},
                  }
                }
              }
            }
          }
        },
      },
    })
    purchase: {
      date: string;
      purchaseDetails?: Array<{
        weight_kg: number;
        productId: number;
        personId: number;
      }>;
    },
  ): Promise<Purchase> {
    const details = purchase.purchaseDetails ?? [];
    const newPurchase = {
      date: purchase.date,
      details: details
    } as Partial<Purchase> & {details?: Array<{weight_kg: number; productId: number; personId: number}>};
    return this.transactionService.createWithDetails<Purchase, {
      weight_kg: number;
      productId: number;
      personId: number;
    }>(
      newPurchase,
      this.purchaseRepository,
      'purchase_details'
    );
  }

  /**
   * Actualiza una compra con sus detalles (crear, actualizar, eliminar detalles)
   */
  @put('/purchases/with-details')
  @response(200, {
    description: 'Purchase updated with details',
    content: {'application/json': {schema: getModelSchemaRef(Purchase, {includeRelations: true})}},
  })
  async updateWithDetails(
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id'],
            properties: {
              id: {type: 'number'},
              date: {type: 'string', format: 'date'},
              purchaseDetails: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: {type: 'number'},
                    weight_kg: {type: 'number'},
                    productId: {type: 'number'},
                    personId: {type: 'number'},
                    toCreate: {type: 'boolean'},
                    toUpdate: {type: 'boolean'},
                    toDelete: {type: 'boolean'},
                  }
                }
              }
            }
          }
        },
      },
    })
    purchaseData: {
      id: number;
      date?: string;
      purchaseDetails?: Array<{
        id?: number;
        weight_kg?: number;
        productId?: number;
        personId?: number;
        toCreate?: boolean;
        toUpdate?: boolean;
        toDelete?: boolean;
      }>;
    },
  ): Promise<Purchase> {
    try {
      // Usar el TransactionService para manejar la lógica compleja
      return await this.transactionService.updateWithDetails(
        {
          id: purchaseData.id,
          date: purchaseData.date,
          details: purchaseData.purchaseDetails
        } as any,
        this.purchaseRepository,
        'purchase_details'
      );
    } catch (error) {
      throw new HttpErrors.BadRequest(`Error updating purchase with details: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
