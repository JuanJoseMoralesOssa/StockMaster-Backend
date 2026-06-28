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
  PaymentDetails,
  Kardex,
  Pagination,
  Person,
  PurchaseDetails,
} from '../../../models'
import {
  PaymentDetailsRepository,
  KardexRepository,
  PurchaseDetailsRepository,
} from '../../../repositories'

/**
 * Plain Kardex row (as serialized by `toJSON`) augmented with the supplier
 * resolved from its source detail line. Not the model class — these are plain
 * objects, so the Entity methods are intentionally absent.
 */
type KardexWithSupplier = Record<string, unknown> & { supplierName?: string }

// Kardex: lectura para Oficina y Admin (Operador sin acceso). Las mutaciones
// directas están bloqueadas (MethodNotAllowed); el kardex lo genera el sistema.
@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class KardexController {
  constructor(
    @repository(KardexRepository)
    public kardexRepository: KardexRepository,
    @repository(PurchaseDetailsRepository)
    protected purchaseDetailsRepository: PurchaseDetailsRepository,
    @repository(PaymentDetailsRepository)
    protected paymentDetailsRepository: PaymentDetailsRepository,
  ) {}

  /**
   * Attaches the supplier name to each Kardex row. The Kardex has no person
   * relation — provenance is `sourceKind` + `sourceDetailId` — so resolve it by
   * batching the detail-line lookups (one query per kind, `inq` on the ids) and
   * reading `person.name`. Manual adjustments / opening balances have no source,
   * so they simply get `supplierName: undefined`. Returns plain objects (not
   * model instances) so the extra field survives strict-model serialization.
   */
  private async withSuppliers(
    kardexes: Kardex[],
  ): Promise<KardexWithSupplier[]> {
    const idsByKind = (kind: 'purchase' | 'payment'): number[] => [
      ...new Set(
        kardexes
          .filter(k => k.sourceKind === kind && k.sourceDetailId != null)
          .map(k => k.sourceDetailId as number),
      ),
    ]
    const purchaseDetailIds = idsByKind('purchase')
    const paymentDetailIds = idsByKind('payment')

    const [purchaseDetails, paymentDetails] = await Promise.all([
      purchaseDetailIds.length > 0
        ? this.purchaseDetailsRepository.find({
            where: { id: { inq: purchaseDetailIds } },
            include: [{ relation: 'person' }],
          })
        : Promise.resolve([]),
      paymentDetailIds.length > 0
        ? this.paymentDetailsRepository.find({
            where: { id: { inq: paymentDetailIds } },
            include: [{ relation: 'person' }],
          })
        : Promise.resolve([]),
    ])

    const supplierByKey = new Map<string, string>()
    const indexDetails = (
      kind: 'purchase' | 'payment',
      details: Array<(PurchaseDetails | PaymentDetails) & { person?: Person }>,
    ): void => {
      for (const detail of details) {
        if (detail.id != null && detail.person?.name) {
          supplierByKey.set(`${kind}:${detail.id}`, detail.person.name)
        }
      }
    }
    indexDetails(
      'purchase',
      purchaseDetails as Array<PurchaseDetails & { person?: Person }>,
    )
    indexDetails(
      'payment',
      paymentDetails as Array<PaymentDetails & { person?: Person }>,
    )

    return kardexes.map(kardex => ({
      ...(kardex.toJSON() as Record<string, unknown>),
      supplierName:
        kardex.sourceKind && kardex.sourceDetailId != null
          ? supplierByKey.get(`${kardex.sourceKind}:${kardex.sourceDetailId}`)
          : undefined,
    }))
  }

  @post('/kardexes')
  @response(200, {
    description: 'Kardex model instance',
    content: {
      'application/json': { schema: getModelSchemaRef(Kardex) },
    },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Kardex, {
            title: 'NewKardex',
            exclude: ['id'],
          }),
        },
      },
    })
    _kardex: Omit<Kardex, 'id'>,
  ): Promise<Kardex> {
    throw new HttpErrors.MethodNotAllowed(
      'Creating kardex entries manually is disabled. Entries are system-generated.',
    )
  }

  @get('/kardexes/count')
  @response(200, {
    description: 'Kardex model count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async count(@param.where(Kardex) where?: Where<Kardex>): Promise<Count> {
    return this.kardexRepository.count(where)
  }

  @get('/kardexes')
  @response(200, {
    description: 'Array of Kardex model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(Kardex, { includeRelations: true }),
        },
      },
    },
  })
  async find(
    @param.filter(Kardex) filter?: Filter<Kardex>,
    @param.query.number('page') page: number = paginationConfig.DEFAULT_PAGE,
    @param.query.number('limit') limit: number = paginationConfig.DEFAULT_LIMIT,
  ): Promise<Pagination<Kardex>> {
    const pagination = normalizePagination(page, limit)
    const kardexes = await this.kardexRepository.find({
      ...filter,
      skip: pagination.skip,
      limit: pagination.limit,
    })
    const count = await this.kardexRepository.count(filter?.where)
    return new Pagination<Kardex>({
      count: count.count,
      data: (await this.withSuppliers(kardexes)) as unknown as Kardex[],
      page: pagination.page,
      limit: pagination.limit,
    })
  }

  @patch('/kardexes')
  @response(200, {
    description: 'Kardex PATCH success count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Kardex, { partial: true }),
        },
      },
    })
    _kardex: Kardex,
    @param.where(Kardex) _where?: Where<Kardex>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Updating kardex entries is disabled. Entries are append-only.',
    )
  }

  @get('/kardexes/filtered')
  @response(200, {
    description: 'Filtered and paginated list of Kardex model instances',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            data: {
              type: 'array',
              items: getModelSchemaRef(Kardex, { includeRelations: true }),
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
  async getFilteredKardexes(
    @param.query.string('startDate') startDate?: string,
    @param.query.string('endDate') endDate?: string,
    @param.query.number('productId') productId?: number,
    @param.query.number('operation') operation?: number,
    @param.query.number('page') page: number = paginationConfig.DEFAULT_PAGE,
    @param.query.number('limit') limit: number = paginationConfig.DEFAULT_LIMIT,
  ): Promise<Pagination<Kardex>> {
    const pagination = normalizePagination(page, limit)
    const where: Where<Kardex> = {}

    if (startDate && endDate) {
      where.date = { between: [startDate, endDate] }
    } else if (startDate) {
      where.date = { gte: startDate }
    } else if (endDate) {
      where.date = { lte: endDate }
    }

    if (productId !== undefined) {
      where.productId = productId
    }

    if (operation !== undefined) {
      where.operation = operation
    }

    const [data, countResult] = await Promise.all([
      this.kardexRepository.find({
        where,
        include: [{ relation: 'product' }],
        order: ['date DESC'],
        skip: pagination.skip,
        limit: pagination.limit,
      }),
      this.kardexRepository.count(where),
    ])

    return new Pagination<Kardex>({
      count: countResult.count,
      data: (await this.withSuppliers(data)) as unknown as Kardex[],
      page: pagination.page,
      limit: pagination.limit,
    })
  }

  @get('/kardexes/{id}')
  @response(200, {
    description: 'Kardex model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Kardex, { includeRelations: true }),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(Kardex, { exclude: 'where' })
    filter?: FilterExcludingWhere<Kardex>,
  ): Promise<Kardex> {
    return this.kardexRepository.findById(id, filter)
  }

  @patch('/kardexes/{id}')
  @response(204, {
    description: 'Kardex PATCH success',
  })
  async updateById(
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Kardex, { partial: true }),
        },
      },
    })
    _kardex: Kardex,
  ): Promise<void> {
    throw new HttpErrors.MethodNotAllowed(
      'Updating kardex entries is disabled. Entries are append-only.',
    )
  }

  @put('/kardexes/{id}')
  @response(204, {
    description: 'Kardex PUT success',
  })
  async replaceById(
    @param.path.number('id') _id: number,
    @requestBody() _kardex: Kardex,
  ): Promise<void> {
    throw new HttpErrors.MethodNotAllowed(
      'Replacing kardex entries is disabled. Entries are append-only.',
    )
  }

  @del('/kardexes/{id}')
  @response(204, {
    description: 'Kardex DELETE success',
  })
  async deleteById(@param.path.number('id') _id: number): Promise<void> {
    throw new HttpErrors.MethodNotAllowed(
      'Deleting kardex entries is disabled. Entries are append-only.',
    )
  }
}
