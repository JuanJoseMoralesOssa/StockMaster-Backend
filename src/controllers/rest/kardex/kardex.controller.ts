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
import { Kardex, Pagination } from '../../../models'
import { KardexRepository } from '../../../repositories'

// Kardex: lectura para Oficina y Admin (Operador sin acceso). Las mutaciones
// directas están bloqueadas (MethodNotAllowed); el kardex lo genera el sistema.
@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class KardexController {
  constructor(
    @repository(KardexRepository)
    public kardexRepository: KardexRepository,
  ) {}

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
      data: kardexes,
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
    @param.query.string('balanceRecord') balanceRecord?: 'yes' | 'no',
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

    if (balanceRecord === 'yes') {
      where.balance_record = true
    } else if (balanceRecord === 'no') {
      where.balance_record = false
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
      data,
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
