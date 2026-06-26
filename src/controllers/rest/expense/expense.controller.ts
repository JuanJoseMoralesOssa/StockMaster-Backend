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
  Expense,
  ExpenseWithTotal,
  Pagination,
  TransactionDetailRequestDTO,
} from '../../../models'
import {
  ExpenseRepository,
  ExpenseWithTotalRepository,
} from '../../../repositories'
import { ExpenseTransactionService } from '../../../services'
import { validateDate } from '../../../services/date-validation.utils'
import {
  withDetailsCreateSchema,
  withDetailsUpdateSchema,
} from '../detail-schemas'

// Gastos: lectura y mutaciones para Oficina y Admin.
@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class ExpenseController {
  constructor(
    @repository(ExpenseRepository)
    public expenseRepository: ExpenseRepository,
    @repository(ExpenseWithTotalRepository)
    public expenseWithTotalRepository: ExpenseWithTotalRepository,
    @service(ExpenseTransactionService)
    public expenseTransactionService: ExpenseTransactionService,
  ) {}

  @post('/expenses')
  @response(200, {
    description: 'Expense model instance',
    content: {
      'application/json': { schema: getModelSchemaRef(ExpenseWithTotal) },
    },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, {
            title: 'NewExpense',
            exclude: ['id', 'version'],
          }),
        },
      },
    })
    _expense: Omit<Expense, 'id'>,
  ): Promise<ExpenseWithTotal> {
    throw new HttpErrors.MethodNotAllowed(
      'Creating expenses without details is disabled. Use POST /expenses/with-details.',
    )
  }

  @post('/expenses/with-details')
  @response(200, {
    description: 'Expense created with details',
    content: {
      'application/json': {
        schema: getModelSchemaRef(ExpenseWithTotal, { includeRelations: true }),
      },
    },
  })
  async createWithDetails(
    @requestBody({
      content: {
        'application/json': {
          schema: withDetailsCreateSchema('expenseDetails'),
        },
      },
    })
    expense: {
      date: string
      expenseDetails?: TransactionDetailRequestDTO[]
    },
  ): Promise<ExpenseWithTotal> {
    // The facade performs the write AND the canonical WithTotal re-read, so the
    // controller no longer needs to know the read twin or its include set.
    return this.expenseTransactionService.createWithDetails({
      date: expense.date,
      details: expense.expenseDetails,
    })
  }

  @get('/expenses/count')
  @response(200, {
    description: 'Expense model count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async count(@param.where(Expense) where?: Where<Expense>): Promise<Count> {
    return this.expenseRepository.count(where)
  }

  @get('/expenses')
  @response(200, {
    description: 'Paginated list of Expense model instances',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            data: {
              type: 'array',
              items: getModelSchemaRef(ExpenseWithTotal, {
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
    @param.filter(ExpenseWithTotal) filter?: Filter<ExpenseWithTotal>,
    @param.query.number('page') page: number = paginationConfig.DEFAULT_PAGE,
    @param.query.number('limit') limit: number = paginationConfig.DEFAULT_LIMIT,
  ): Promise<Pagination<ExpenseWithTotal>> {
    const pagination = normalizePagination(page, limit)
    const expenses = await this.expenseWithTotalRepository.find({
      ...filter,
      include: filter?.include ?? ['expense_details'],
      skip: pagination.skip,
      limit: pagination.limit,
    })
    const count = await this.expenseWithTotalRepository.count(filter?.where)
    return new Pagination<ExpenseWithTotal>({
      count: count.count,
      data: expenses,
      page: pagination.page,
      limit: pagination.limit,
    })
  }

  @patch('/expenses')
  @response(200, {
    description: 'Expense PATCH success count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, { partial: true }),
        },
      },
    })
    _expense: Expense,
    @param.where(Expense) _where?: Where<Expense>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Bulk expense updates are disabled. Use PUT /expenses/with-details.',
    )
  }

  @get('/expenses/{id}')
  @response(200, {
    description: 'Expense model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(ExpenseWithTotal, { includeRelations: true }),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(ExpenseWithTotal, { exclude: 'where' })
    filter?: FilterExcludingWhere<ExpenseWithTotal>,
  ): Promise<ExpenseWithTotal> {
    return this.expenseWithTotalRepository.findById(id, filter)
  }

  @patch('/expenses/{id}')
  @response(200, {
    description: 'Expense PATCH success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(ExpenseWithTotal, { includeRelations: true }),
      },
    },
  })
  async updateById(
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, { partial: true }),
        },
      },
    })
    _expense: Partial<Expense>,
  ): Promise<ExpenseWithTotal> {
    throw new HttpErrors.MethodNotAllowed(
      'Direct expense updates are disabled (they bypass optimistic locking). Use PUT /expenses/with-details.',
    )
  }

  @put('/expenses/{id}')
  @response(200, {
    description: 'Expense PUT success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(ExpenseWithTotal, { includeRelations: true }),
      },
    },
  })
  async replaceById(
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, {
            title: 'ExpenseReplace',
            exclude: ['id', 'version'],
          }),
        },
      },
    })
    _expense: Omit<Expense, 'id'>,
  ): Promise<ExpenseWithTotal> {
    throw new HttpErrors.MethodNotAllowed(
      'Replacing expenses is disabled. Use PUT /expenses/with-details.',
    )
  }

  @put('/expenses/with-details')
  @response(200, {
    description: 'Expense updated with details',
    content: {
      'application/json': {
        schema: getModelSchemaRef(ExpenseWithTotal, { includeRelations: true }),
      },
    },
  })
  async updateWithDetails(
    @requestBody({
      content: {
        'application/json': {
          schema: withDetailsUpdateSchema('expenseDetails'),
        },
      },
    })
    expenseData: {
      id: number
      version: number
      date?: string
      expenseDetails?: TransactionDetailRequestDTO[]
    },
  ): Promise<ExpenseWithTotal> {
    return this.expenseTransactionService.updateWithDetails({
      id: expenseData.id,
      version: expenseData.version,
      date: expenseData.date,
      details: expenseData.expenseDetails,
    })
  }

  @del('/expenses/{id}')
  @response(204, {
    description: 'Expense DELETE success',
  })
  async deleteById(
    @param.path.number('id') id: number,
    // Obligatorio: el borrado es la mutación más destructiva y recibe la misma
    // protección de bloqueo optimista que las actualizaciones.
    @param.query.number('version', { required: true }) version: number,
  ): Promise<void> {
    await this.expenseTransactionService.deleteWithDetails(id, version)
  }

  @get('/expenses/filtered')
  @response(200, {
    description: 'Array of filtered Expense model instances with pagination',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            data: {
              type: 'array',
              items: getModelSchemaRef(ExpenseWithTotal, {
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
  async getFilteredExpenses(
    @param.query.string('startDate') startDate?: string,
    @param.query.string('endDate') endDate?: string,
    @param.query.number('personId') personId?: number,
    @param.query.number('productId') productId?: number,
    @param.query.number('page') page: number = paginationConfig.DEFAULT_PAGE,
    @param.query.number('limit') limit: number = paginationConfig.DEFAULT_LIMIT,
  ): Promise<Pagination<ExpenseWithTotal>> {
    const pagination = normalizePagination(page, limit)
    if (startDate) validateDate(startDate)
    if (endDate) validateDate(endDate)

    const { data, count } =
      await this.expenseWithTotalRepository.findFilteredExpenses(
        startDate,
        endDate,
        personId,
        productId,
        pagination.page,
        pagination.limit,
      )

    return new Pagination<ExpenseWithTotal>({
      count,
      data,
      page: pagination.page,
      limit: pagination.limit,
    })
  }
}
