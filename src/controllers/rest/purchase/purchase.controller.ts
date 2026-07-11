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
import {
  normalizePagination,
  paginationConfig,
} from '../../../config/pagination'
import {
  Pagination,
  Purchase,
  PurchaseWithTotal,
  TransactionDetailRequestDTO,
} from '../../../models'
import {
  PurchaseRepository,
  PurchaseWithTotalRepository,
} from '../../../repositories'
import { PurchaseTransactionService } from '../../../services'
import { validateDate } from '../../../services/date-validation.utils'
import {
  withDetailsCreateSchema,
  withDetailsUpdateSchema,
} from '../detail-schemas'
import { paginatedSchema } from '../pagination-schema'

// Compras: lectura y mutaciones para Oficina y Admin.
@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PurchaseController {
  constructor(
    @repository(PurchaseRepository)
    public purchaseRepository: PurchaseRepository,
    @repository(PurchaseWithTotalRepository)
    public purchaseWithTotalRepository: PurchaseWithTotalRepository,
    @service(PurchaseTransactionService)
    public purchaseTransactionService: PurchaseTransactionService,
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
    _purchase: Omit<Purchase, 'id'>,
  ): Promise<PurchaseWithTotal> {
    throw new HttpErrors.MethodNotAllowed(
      'Creating purchases without details is disabled. Use POST /purchases/with-details.',
    )
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
      'application/json': { schema: paginatedSchema(PurchaseWithTotal) },
    },
  })
  async find(
    @param.filter(PurchaseWithTotal) filter?: Filter<PurchaseWithTotal>,
    @param.query.number('page') page: number = paginationConfig.DEFAULT_PAGE,
    @param.query.number('limit') limit: number = paginationConfig.DEFAULT_LIMIT,
  ): Promise<Pagination<PurchaseWithTotal>> {
    const pagination = normalizePagination(page, limit)
    const purchases = await this.purchaseWithTotalRepository.find({
      ...filter,
      include: filter?.include ?? ['purchase_details'],
      skip: pagination.skip,
      limit: pagination.limit,
    })
    const count = await this.purchaseWithTotalRepository.count(filter?.where)
    return new Pagination<PurchaseWithTotal>({
      count: count.count,
      data: purchases,
      page: pagination.page,
      limit: pagination.limit,
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
    _purchase: Purchase,
    @param.where(Purchase) _where?: Where<Purchase>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Bulk purchase updates are disabled. Use PUT /purchases/with-details.',
    )
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
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, { partial: true }),
        },
      },
    })
    _purchase: Partial<Purchase>,
  ): Promise<PurchaseWithTotal> {
    throw new HttpErrors.MethodNotAllowed(
      'Direct purchase updates are disabled (they bypass optimistic locking). Use PUT /purchases/with-details.',
    )
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
    @param.path.number('id') _id: number,
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
    _purchase: Omit<Purchase, 'id'>,
  ): Promise<PurchaseWithTotal> {
    throw new HttpErrors.MethodNotAllowed(
      'Replacing purchases is disabled. Use PUT /purchases/with-details.',
    )
  }

  @del('/purchases/{id}')
  @response(204, {
    description: 'Purchase DELETE success',
  })
  async deleteById(
    @param.path.number('id') id: number,
    // Obligatorio: el borrado es la mutación más destructiva y recibe la misma
    // protección de bloqueo optimista que las actualizaciones.
    @param.query.number('version', { required: true }) version: number,
  ): Promise<void> {
    await this.purchaseTransactionService.deleteWithDetails(id, version)
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
          schema: withDetailsCreateSchema('purchaseDetails'),
        },
      },
    })
    purchase: {
      date: string
      purchaseDetails?: TransactionDetailRequestDTO[]
    },
  ): Promise<PurchaseWithTotal> {
    // The facade performs the write AND the canonical WithTotal re-read, so the
    // controller no longer needs to know the read twin or its include set.
    return this.purchaseTransactionService.createWithDetails({
      date: purchase.date,
      details: purchase.purchaseDetails,
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
          schema: withDetailsUpdateSchema('purchaseDetails'),
        },
      },
    })
    purchaseData: {
      id: number
      version: number
      date?: string
      purchaseDetails?: TransactionDetailRequestDTO[]
    },
  ): Promise<PurchaseWithTotal> {
    return this.purchaseTransactionService.updateWithDetails({
      id: purchaseData.id,
      version: purchaseData.version,
      date: purchaseData.date,
      details: purchaseData.purchaseDetails,
    })
  }

  @get('/purchases/filtered')
  @response(200, {
    description: 'Array of filtered Purchase model instances with pagination',
    content: {
      'application/json': { schema: paginatedSchema(PurchaseWithTotal) },
    },
  })
  async getFilteredPurchases(
    @param.query.string('startDate') startDate?: string,
    @param.query.string('endDate') endDate?: string,
    @param.query.number('personId') personId?: number,
    @param.query.number('productId') productId?: number,
    @param.query.number('page') page: number = paginationConfig.DEFAULT_PAGE,
    @param.query.number('limit') limit: number = paginationConfig.DEFAULT_LIMIT,
  ): Promise<Pagination<PurchaseWithTotal>> {
    const pagination = normalizePagination(page, limit)
    if (startDate) validateDate(startDate)
    if (endDate) validateDate(endDate)

    const { data, count } =
      await this.purchaseWithTotalRepository.findFilteredPurchases(
        startDate,
        endDate,
        personId,
        productId,
        pagination.page,
        pagination.limit,
      )

    return new Pagination<PurchaseWithTotal>({
      count,
      data,
      page: pagination.page,
      limit: pagination.limit,
    })
  }
}
