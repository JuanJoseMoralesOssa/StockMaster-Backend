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
import { Pagination, Purchase, PurchaseWithTotal } from '../../../models'
import {
  PurchaseRepository,
  PurchaseWithTotalRepository,
} from '../../../repositories'
import { TransactionService } from '../../../services'

export class PurchaseController {
  constructor(
    @repository(PurchaseRepository)
    public purchaseRepository: PurchaseRepository,
    @repository(PurchaseWithTotalRepository)
    public purchaseWithTotalRepository: PurchaseWithTotalRepository,
    @service(TransactionService)
    public transactionService: TransactionService,
  ) {}

  @post('/purchases')
  @response(200, {
    description: 'Purchase model instance',
    content: {
      'application/json': { schema: getModelSchemaRef(PurchaseWithTotal) },
    },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, {
            title: 'NewPurchase',
            exclude: ['id', 'version'],
          }),
        },
      },
    })
    purchase: Omit<Purchase, 'id'>,
  ): Promise<PurchaseWithTotal> {
    this.transactionService.validateDate(purchase.date)
    const createdPurchase = await this.purchaseRepository.create(purchase)
    return this.purchaseWithTotalRepository.findById(createdPurchase.id!, {
      include: ['purchase_details'],
    })
  }

  @get('/purchases/count')
  @response(200, {
    description: 'Purchase model count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async count(@param.where(Purchase) where?: Where<Purchase>): Promise<Count> {
    return this.purchaseRepository.count(where)
  }

  @get('/purchases')
  @response(200, {
    description: 'Paginated list of Purchase model instances',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            data: {
              type: 'array',
              items: getModelSchemaRef(PurchaseWithTotal, {
                includeRelations: true,
              }),
            },
            page: { type: 'number' },
            limit: { type: 'number' },
            totalPages: { type: 'number' },
            hasNext: { type: 'boolean' },
            hasPrevious: { type: 'boolean' },
          },
        },
      },
    },
  })
  async find(
    @param.filter(PurchaseWithTotal) filter?: Filter<PurchaseWithTotal>,
    @param.query.number('page') page: number = 1,
    @param.query.number('limit') limit: number = 10,
  ): Promise<Pagination<PurchaseWithTotal>> {
    const purchases = await this.purchaseWithTotalRepository.find({
      ...filter,
      include: filter?.include ?? ['purchase_details'],
      skip: (page - 1) * limit,
      limit: limit,
    })
    const count = await this.purchaseWithTotalRepository.count(filter?.where)
    return new Pagination<PurchaseWithTotal>({
      count: count.count,
      data: purchases,
      page: page,
      limit: limit,
    })
  }

  @patch('/purchases')
  @response(200, {
    description: 'Purchase PATCH success count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, { partial: true }),
        },
      },
    })
    purchase: Purchase,
    @param.where(Purchase) where?: Where<Purchase>,
  ): Promise<Count> {
    return this.purchaseRepository.updateAll(purchase, where)
  }

  @get('/purchases/{id}')
  @response(200, {
    description: 'Purchase model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PurchaseWithTotal, {
          includeRelations: true,
        }),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(PurchaseWithTotal, { exclude: 'where' })
    filter?: FilterExcludingWhere<PurchaseWithTotal>,
  ): Promise<PurchaseWithTotal> {
    return this.purchaseWithTotalRepository.findById(id, filter)
  }

  @patch('/purchases/{id}')
  @response(200, {
    description: 'Purchase PATCH success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PurchaseWithTotal, {
          includeRelations: true,
        }),
      },
    },
  })
  async updateById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, { partial: true }),
        },
      },
    })
    purchase: Partial<Purchase>,
  ): Promise<PurchaseWithTotal> {
    await this.purchaseRepository.updateById(id, purchase)
    return this.purchaseWithTotalRepository.findById(id, {
      include: ['purchase_details'],
    })
  }

  @put('/purchases/{id}')
  @response(200, {
    description: 'Purchase PUT success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PurchaseWithTotal, {
          includeRelations: true,
        }),
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
            exclude: ['id', 'version'],
          }),
        },
      },
    })
    purchase: Omit<Purchase, 'id'>,
  ): Promise<PurchaseWithTotal> {
    await this.purchaseRepository.replaceById(id, purchase)
    return this.purchaseWithTotalRepository.findById(id, {
      include: ['purchase_details'],
    })
  }

  @del('/purchases/{id}')
  @response(204, {
    description: 'Purchase DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    await this.transactionService.deleteWithDetails(
      id,
      this.purchaseRepository,
      'purchase_details',
      true,
    )
  }

  /**
   * Crea una compra con sus detalles en una transacción atómica
   */
  @post('/purchases/with-details')
  @response(200, {
    description: 'Purchase created with details',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PurchaseWithTotal, {
          includeRelations: true,
        }),
      },
    },
  })
  async createWithDetails(
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['date'],
            properties: {
              date: { type: 'string', format: 'date' },
              purchaseDetails: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['weight_kg', 'productId', 'personId'],
                  properties: {
                    weight_kg: { type: 'number' },
                    productId: { type: 'number' },
                    personId: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    })
    purchase: {
      date: string
      purchaseDetails?: Array<{
        weight_kg: number
        productId: number
        personId: number
      }>
    },
  ): Promise<PurchaseWithTotal> {
    const details = purchase.purchaseDetails ?? []
    const newPurchase = {
      date: purchase.date,
      details: details,
    } as Partial<Purchase> & {
      details?: Array<{
        weight_kg: number
        productId: number
        personId: number
      }>
    }
    const createdPurchase = await this.transactionService.createWithDetails<
      Purchase,
      {
        weight_kg: number
        productId: number
        personId: number
      }
    >(newPurchase, this.purchaseRepository, 'purchase_details', true)
    return this.purchaseWithTotalRepository.findById(createdPurchase.id!, {
      include: ['purchase_details'],
    })
  }

  /**
   * Actualiza una compra con sus detalles usando Server-Side Reconciliation
   */
  @put('/purchases/with-details')
  @response(200, {
    description: 'Purchase updated with details',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PurchaseWithTotal, {
          includeRelations: true,
        }),
      },
    },
  })
  async updateWithDetails(
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id', 'version'],
            properties: {
              id: { type: 'number' },
              version: { type: 'number' },
              date: { type: 'string', format: 'date' },
              purchaseDetails: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'number' },
                    weight_kg: { type: 'number' },
                    productId: { type: 'number' },
                    personId: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    })
    purchaseData: {
      id: number
      version: number
      date?: string
      purchaseDetails?: Array<{
        id?: number
        weight_kg: number
        productId: number
        personId: number
      }>
    },
  ): Promise<PurchaseWithTotal> {
    try {
      // Usar el TransactionService para manejar la lógica compleja
      await this.transactionService.updateWithDetails<
        Purchase,
        {
          id?: number
          weight_kg: number
          productId: number
          personId: number
        }
      >(
        {
          id: purchaseData.id,
          version: purchaseData.version,
          date: purchaseData.date,
          details: purchaseData.purchaseDetails,
        },
        this.purchaseRepository,
        'purchase_details',
        true,
      )
      return await this.purchaseWithTotalRepository.findById(purchaseData.id, {
        include: ['purchase_details'],
      })
    } catch (error) {
      if (error && (error as { statusCode?: number }).statusCode) throw error
      throw new HttpErrors.BadRequest(
        `Error updating purchase with details: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  @get('/purchases/filtered')
  @response(200, {
    description: 'Array of filtered Purchase model instances with pagination',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            data: {
              type: 'array',
              items: getModelSchemaRef(PurchaseWithTotal, {
                includeRelations: true,
              }),
            },
            page: { type: 'number' },
            limit: { type: 'number' },
          },
        },
      },
    },
  })
  async getFilteredPurchases(
    @param.query.string('startDate') startDate?: string,
    @param.query.string('endDate') endDate?: string,
    @param.query.number('personId') personId?: number,
    @param.query.number('productId') productId?: number,
    @param.query.number('page') page: number = 1,
    @param.query.number('limit') limit: number = 10,
  ): Promise<Pagination<PurchaseWithTotal>> {
    // Validar fechas si se proporcionan
    if (startDate) {
      this.transactionService.validateDate(startDate)
    }
    if (endDate) {
      this.transactionService.validateDate(endDate)
    }

    const { data, count } =
      await this.purchaseWithTotalRepository.findFilteredPurchases(
        startDate,
        endDate,
        personId,
        productId,
        page,
        limit,
      )

    return new Pagination<PurchaseWithTotal>({
      count,
      data,
      page,
      limit,
    })
  }
}
