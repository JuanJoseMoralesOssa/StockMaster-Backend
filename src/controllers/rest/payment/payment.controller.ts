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
  Payment,
  PaymentWithTotal,
  Pagination,
  TransactionDetailRequestDTO,
} from '../../../models'
import {
  PaymentRepository,
  PaymentWithTotalRepository,
} from '../../../repositories'
import { PaymentTransactionService } from '../../../services'
import { validateDate } from '../../../services/date-validation.utils'
import {
  withDetailsCreateSchema,
  withDetailsUpdateSchema,
} from '../detail-schemas'

// Pagos: lectura y mutaciones para Oficina y Admin.
@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PaymentController {
  constructor(
    @repository(PaymentRepository)
    public paymentRepository: PaymentRepository,
    @repository(PaymentWithTotalRepository)
    public paymentWithTotalRepository: PaymentWithTotalRepository,
    @service(PaymentTransactionService)
    public paymentTransactionService: PaymentTransactionService,
  ) {}

  @post('/payments')
  @response(200, {
    description: 'Payment model instance',
    content: {
      'application/json': { schema: getModelSchemaRef(PaymentWithTotal) },
    },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Payment, {
            title: 'NewPayment',
            exclude: ['id', 'version'],
          }),
        },
      },
    })
    _payment: Omit<Payment, 'id'>,
  ): Promise<PaymentWithTotal> {
    throw new HttpErrors.MethodNotAllowed(
      'Creating payments without details is disabled. Use POST /payments/with-details.',
    )
  }

  @post('/payments/with-details')
  @response(200, {
    description: 'Payment created with details',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PaymentWithTotal, { includeRelations: true }),
      },
    },
  })
  async createWithDetails(
    @requestBody({
      content: {
        'application/json': {
          schema: withDetailsCreateSchema('paymentDetails'),
        },
      },
    })
    payment: {
      date: string
      paymentDetails?: TransactionDetailRequestDTO[]
    },
  ): Promise<PaymentWithTotal> {
    // The facade performs the write AND the canonical WithTotal re-read, so the
    // controller no longer needs to know the read twin or its include set.
    return this.paymentTransactionService.createWithDetails({
      date: payment.date,
      details: payment.paymentDetails,
    })
  }

  @get('/payments/count')
  @response(200, {
    description: 'Payment model count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async count(@param.where(Payment) where?: Where<Payment>): Promise<Count> {
    return this.paymentRepository.count(where)
  }

  @get('/payments')
  @response(200, {
    description: 'Paginated list of Payment model instances',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            data: {
              type: 'array',
              items: getModelSchemaRef(PaymentWithTotal, {
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
    @param.filter(PaymentWithTotal) filter?: Filter<PaymentWithTotal>,
    @param.query.number('page') page: number = paginationConfig.DEFAULT_PAGE,
    @param.query.number('limit') limit: number = paginationConfig.DEFAULT_LIMIT,
  ): Promise<Pagination<PaymentWithTotal>> {
    const pagination = normalizePagination(page, limit)
    const payments = await this.paymentWithTotalRepository.find({
      ...filter,
      include: filter?.include ?? ['payment_details'],
      skip: pagination.skip,
      limit: pagination.limit,
    })
    const count = await this.paymentWithTotalRepository.count(filter?.where)
    return new Pagination<PaymentWithTotal>({
      count: count.count,
      data: payments,
      page: pagination.page,
      limit: pagination.limit,
    })
  }

  @patch('/payments')
  @response(200, {
    description: 'Payment PATCH success count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Payment, { partial: true }),
        },
      },
    })
    _payment: Payment,
    @param.where(Payment) _where?: Where<Payment>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Bulk payment updates are disabled. Use PUT /payments/with-details.',
    )
  }

  @get('/payments/{id}')
  @response(200, {
    description: 'Payment model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PaymentWithTotal, { includeRelations: true }),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(PaymentWithTotal, { exclude: 'where' })
    filter?: FilterExcludingWhere<PaymentWithTotal>,
  ): Promise<PaymentWithTotal> {
    return this.paymentWithTotalRepository.findById(id, filter)
  }

  @patch('/payments/{id}')
  @response(200, {
    description: 'Payment PATCH success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PaymentWithTotal, { includeRelations: true }),
      },
    },
  })
  async updateById(
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Payment, { partial: true }),
        },
      },
    })
    _payment: Partial<Payment>,
  ): Promise<PaymentWithTotal> {
    throw new HttpErrors.MethodNotAllowed(
      'Direct payment updates are disabled (they bypass optimistic locking). Use PUT /payments/with-details.',
    )
  }

  @put('/payments/{id}')
  @response(200, {
    description: 'Payment PUT success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PaymentWithTotal, { includeRelations: true }),
      },
    },
  })
  async replaceById(
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Payment, {
            title: 'PaymentReplace',
            exclude: ['id', 'version'],
          }),
        },
      },
    })
    _payment: Omit<Payment, 'id'>,
  ): Promise<PaymentWithTotal> {
    throw new HttpErrors.MethodNotAllowed(
      'Replacing payments is disabled. Use PUT /payments/with-details.',
    )
  }

  @put('/payments/with-details')
  @response(200, {
    description: 'Payment updated with details',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PaymentWithTotal, { includeRelations: true }),
      },
    },
  })
  async updateWithDetails(
    @requestBody({
      content: {
        'application/json': {
          schema: withDetailsUpdateSchema('paymentDetails'),
        },
      },
    })
    paymentData: {
      id: number
      version: number
      date?: string
      paymentDetails?: TransactionDetailRequestDTO[]
    },
  ): Promise<PaymentWithTotal> {
    return this.paymentTransactionService.updateWithDetails({
      id: paymentData.id,
      version: paymentData.version,
      date: paymentData.date,
      details: paymentData.paymentDetails,
    })
  }

  @del('/payments/{id}')
  @response(204, {
    description: 'Payment DELETE success',
  })
  async deleteById(
    @param.path.number('id') id: number,
    // Obligatorio: el borrado es la mutación más destructiva y recibe la misma
    // protección de bloqueo optimista que las actualizaciones.
    @param.query.number('version', { required: true }) version: number,
  ): Promise<void> {
    await this.paymentTransactionService.deleteWithDetails(id, version)
  }

  @get('/payments/filtered')
  @response(200, {
    description: 'Array of filtered Payment model instances with pagination',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            data: {
              type: 'array',
              items: getModelSchemaRef(PaymentWithTotal, {
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
  async getFilteredPayments(
    @param.query.string('startDate') startDate?: string,
    @param.query.string('endDate') endDate?: string,
    @param.query.number('personId') personId?: number,
    @param.query.number('productId') productId?: number,
    @param.query.number('page') page: number = paginationConfig.DEFAULT_PAGE,
    @param.query.number('limit') limit: number = paginationConfig.DEFAULT_LIMIT,
  ): Promise<Pagination<PaymentWithTotal>> {
    const pagination = normalizePagination(page, limit)
    if (startDate) validateDate(startDate)
    if (endDate) validateDate(endDate)

    const { data, count } =
      await this.paymentWithTotalRepository.findFilteredPayments(
        startDate,
        endDate,
        personId,
        productId,
        pagination.page,
        pagination.limit,
      )

    return new Pagination<PaymentWithTotal>({
      count,
      data,
      page: pagination.page,
      limit: pagination.limit,
    })
  }
}
