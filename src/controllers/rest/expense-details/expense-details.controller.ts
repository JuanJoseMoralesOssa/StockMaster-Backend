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
import { ExpenseDetails } from '../../../models'
import {
  ExpenseDetailsRepository,
  ExpenseRepository,
} from '../../../repositories'
import { TransactionService } from '../../../services'

export class ExpenseDetailsController {
  constructor(
    @repository(ExpenseDetailsRepository)
    public expenseDetailsRepository: ExpenseDetailsRepository,
    @repository(ExpenseRepository)
    public expenseRepository: ExpenseRepository,
    @service(TransactionService)
    public transactionService: TransactionService,
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
  ): Promise<ExpenseDetails> {
    if (expenseDetails.expenseId == null) {
      throw new HttpErrors.BadRequest('expenseId is required')
    }

    return this.transactionService.createSingleDetail(
      expenseDetails.expenseId,
      expenseDetails,
      this.expenseRepository,
      'expense_details',
      false,
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
    description: 'Array of ExpenseDetails model instances',
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
    return this.expenseDetailsRepository.find(filter)
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
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(ExpenseDetails, { partial: true }),
        },
      },
    })
    expenseDetails: Partial<ExpenseDetails>,
  ): Promise<ExpenseDetails> {
    return this.transactionService.updateSingleDetail(
      id,
      expenseDetails,
      this.expenseDetailsRepository,
      false, // isPurchase = false
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
    return this.transactionService.updateSingleDetail(
      id,
      expenseDetails,
      this.expenseDetailsRepository,
      false, // isPurchase = false
    )
  }

  @del('/expense-details/{id}')
  @response(204, {
    description: 'ExpenseDetails DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    await this.transactionService.deleteSingleDetail(
      id,
      this.expenseDetailsRepository,
      false, // isPurchase = false
    )
  }
}
