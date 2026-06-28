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
import { normalizeLimit, paginationConfig } from '../../../config/pagination'
import { fieldRequiredMessage } from '../../../errors'
import { PaymentDetails } from '../../../models'
import { PaymentDetailsRepository } from '../../../repositories'
import { PaymentTransactionService } from '../../../services'
import { singleDetailReplaceSchema } from '../detail-schemas'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PaymentDetailsController {
  constructor(
    // Read-only surface: detail WRITES must go through PaymentTransactionService
    // so balance + Kardex stay consistent. Narrowing the type makes a stray
    // repository.create/updateById/deleteById a compile error (audit Finding M6).
    @repository(PaymentDetailsRepository)
    public paymentDetailsRepository: Pick<
      PaymentDetailsRepository,
      'find' | 'findById' | 'count'
    >,
    @service(PaymentTransactionService)
    public paymentTransactionService: PaymentTransactionService,
  ) {}

  @post('/payment-details')
  @response(200, {
    description: 'PaymentDetails model instance',
    content: {
      'application/json': { schema: getModelSchemaRef(PaymentDetails) },
    },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PaymentDetails, {
            title: 'NewPaymentDetails',
            exclude: ['id'],
          }),
        },
      },
    })
    paymentDetails: Omit<PaymentDetails, 'id'>,
    @param.query.number('parentVersion') parentVersion?: number,
  ): Promise<PaymentDetails> {
    if (paymentDetails.paymentId == null) {
      throw new HttpErrors.BadRequest(fieldRequiredMessage('paymentId'))
    }

    return this.paymentTransactionService.createDetail(
      paymentDetails.paymentId,
      paymentDetails,
      parentVersion,
    )
  }

  @get('/payment-details/count')
  @response(200, {
    description: 'PaymentDetails model count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async count(
    @param.where(PaymentDetails) where?: Where<PaymentDetails>,
  ): Promise<Count> {
    return this.paymentDetailsRepository.count(where)
  }

  @get('/payment-details')
  @response(200, {
    description: `Array of PaymentDetails model instances (capped at ${paginationConfig.MAX_LIMIT} rows; use filter.skip/filter.limit to page)`,
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(PaymentDetails, { includeRelations: true }),
        },
      },
    },
  })
  async find(
    @param.filter(PaymentDetails) filter?: Filter<PaymentDetails>,
  ): Promise<PaymentDetails[]> {
    return this.paymentDetailsRepository.find({
      ...filter,
      limit: normalizeLimit(filter?.limit ?? paginationConfig.MAX_LIMIT),
    })
  }

  @patch('/payment-details')
  @response(200, {
    description: 'PaymentDetails PATCH success count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PaymentDetails, { partial: true }),
        },
      },
    })
    paymentDetails: PaymentDetails,
    @param.where(PaymentDetails) where?: Where<PaymentDetails>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Bulk update is disabled for balance consistency. Use PATCH /payment-details/{id}.',
    )
  }

  @get('/payment-details/{id}')
  @response(200, {
    description: 'PaymentDetails model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PaymentDetails, { includeRelations: true }),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(PaymentDetails, { exclude: 'where' })
    filter?: FilterExcludingWhere<PaymentDetails>,
  ): Promise<PaymentDetails> {
    return this.paymentDetailsRepository.findById(id, filter)
  }

  @patch('/payment-details/{id}')
  @response(200, {
    description: 'PaymentDetails PATCH success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PaymentDetails, { includeRelations: true }),
      },
    },
  })
  async updateById(
    @param.path.number('id') id: number,
    @param.query.number('parentVersion') parentVersion: number | undefined,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(PaymentDetails, { partial: true }),
        },
      },
    })
    paymentDetails: Partial<PaymentDetails>,
  ): Promise<PaymentDetails> {
    return this.paymentTransactionService.updateDetail(
      id,
      paymentDetails,
      parentVersion,
    )
  }

  @put('/payment-details/{id}')
  @response(200, {
    description: 'PaymentDetails PUT success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(PaymentDetails, { includeRelations: true }),
      },
    },
  })
  async replaceById(
    @param.path.number('id') id: number,
    @param.query.number('parentVersion') parentVersion: number | undefined,
    @requestBody({
      content: {
        'application/json': {
          // PUT replaces the whole detail line, so the full representation is
          // required (no partial merge). Use PATCH for partial updates.
          schema: singleDetailReplaceSchema('paymentId'),
        },
      },
    })
    paymentDetails: Omit<PaymentDetails, 'id'>,
  ): Promise<PaymentDetails> {
    return this.paymentTransactionService.updateDetail(
      id,
      paymentDetails,
      parentVersion,
    )
  }

  @del('/payment-details/{id}')
  @response(204, {
    description: 'PaymentDetails DELETE success',
  })
  async deleteById(
    @param.path.number('id') id: number,
    @param.query.number('parentVersion') parentVersion: number | undefined,
  ): Promise<void> {
    await this.paymentTransactionService.deleteDetail(id, parentVersion)
  }
}
