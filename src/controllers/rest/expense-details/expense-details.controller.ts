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
import { ExpenseDetails } from '../../../models'
import { ExpenseDetailsRepository } from '../../../repositories'
import { ExpenseTransactionService } from '../../../services'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class ExpenseDetailsController {
  constructor(
    @repository(ExpenseDetailsRepository)
    public expenseDetailsRepository: ExpenseDetailsRepository,
    @service(ExpenseTransactionService)
    public expenseTransactionService: ExpenseTransactionService,
  ) {}

  @post('/expense-details')
  @response(200, {
    description: 'ExpenseDetails model instance',
    content: {
      'application/json': { schema: getModelSchemaRef(ExpenseDetails) },
    },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(ExpenseDetails, {
            title: 'NewExpenseDetails',
            exclude: ['id'],
          }),
        },
      },
    })
    expenseDetails: Omit<ExpenseDetails, 'id'>,
    @param.query.number('parentVersion') parentVersion?: number,
  ): Promise<ExpenseDetails> {
    if (expenseDetails.expenseId == null) {
      throw new HttpErrors.BadRequest(fieldRequiredMessage('expenseId'))
    }

    return this.expenseTransactionService.createDetail(
      expenseDetails.expenseId,
      expenseDetails,
      parentVersion,
    )
  }

  @get('/expense-details/count')
  @response(200, {
    description: 'ExpenseDetails model count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async count(
    @param.where(ExpenseDetails) where?: Where<ExpenseDetails>,
  ): Promise<Count> {
    return this.expenseDetailsRepository.count(where)
  }

  @get('/expense-details')
  @response(200, {
    description: `Array of ExpenseDetails model instances (capped at ${paginationConfig.MAX_LIMIT} rows; use filter.skip/filter.limit to page)`,
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(ExpenseDetails, { includeRelations: true }),
        },
      },
    },
  })
  async find(
    @param.filter(ExpenseDetails) filter?: Filter<ExpenseDetails>,
  ): Promise<ExpenseDetails[]> {
    return this.expenseDetailsRepository.find({
      ...filter,
      limit: normalizeLimit(filter?.limit ?? paginationConfig.MAX_LIMIT),
    })
  }

  @patch('/expense-details')
  @response(200, {
    description: 'ExpenseDetails PATCH success count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(ExpenseDetails, { partial: true }),
        },
      },
    })
    expenseDetails: ExpenseDetails,
    @param.where(ExpenseDetails) where?: Where<ExpenseDetails>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Bulk update is disabled for stock consistency. Use PATCH /expense-details/{id}.',
    )
  }

  @get('/expense-details/{id}')
  @response(200, {
    description: 'ExpenseDetails model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(ExpenseDetails, { includeRelations: true }),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(ExpenseDetails, { exclude: 'where' })
    filter?: FilterExcludingWhere<ExpenseDetails>,
  ): Promise<ExpenseDetails> {
    return this.expenseDetailsRepository.findById(id, filter)
  }

  @patch('/expense-details/{id}')
  @response(200, {
    description: 'ExpenseDetails PATCH success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(ExpenseDetails, { includeRelations: true }),
      },
    },
  })
  async updateById(
    @param.path.number('id') id: number,
    @param.query.number('parentVersion') parentVersion: number | undefined,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(ExpenseDetails, { partial: true }),
        },
      },
    })
    expenseDetails: Partial<ExpenseDetails>,
  ): Promise<ExpenseDetails> {
    return this.expenseTransactionService.updateDetail(
      id,
      expenseDetails,
      parentVersion,
    )
  }

  @put('/expense-details/{id}')
  @response(200, {
    description: 'ExpenseDetails PUT success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(ExpenseDetails, { includeRelations: true }),
      },
    },
  })
  async replaceById(
    @param.path.number('id') id: number,
    @param.query.number('parentVersion') parentVersion: number | undefined,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(ExpenseDetails, {
            title: 'ExpenseDetailsReplace',
            exclude: ['id'],
          }),
        },
      },
    })
    expenseDetails: Omit<ExpenseDetails, 'id'>,
  ): Promise<ExpenseDetails> {
    return this.expenseTransactionService.updateDetail(
      id,
      expenseDetails,
      parentVersion,
    )
  }

  @del('/expense-details/{id}')
  @response(204, {
    description: 'ExpenseDetails DELETE success',
  })
  async deleteById(
    @param.path.number('id') id: number,
    @param.query.number('parentVersion') parentVersion: number | undefined,
  ): Promise<void> {
    await this.expenseTransactionService.deleteDetail(id, parentVersion)
  }
}
