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
import { Expense, ExpenseWithTotal, Pagination } from '../../../models'
import {
  ExpenseRepository,
  ExpenseWithTotalRepository,
} from '../../../repositories'
import { TransactionService } from '../../../services'

export class ExpenseController {
  constructor(
    @repository(ExpenseRepository)
    public expenseRepository: ExpenseRepository,
    @repository(ExpenseWithTotalRepository)
    public expenseWithTotalRepository: ExpenseWithTotalRepository,
    @service(TransactionService)
    public transactionService: TransactionService,
  ) {}

  // @requireAuthAndRoles('admin', 'manager')  // Solo admin y manager pueden crear
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
    expense: Omit<Expense, 'id'>,
  ): Promise<ExpenseWithTotal> {
    this.transactionService.validateDate(expense.date)
    const createdExpense = await this.expenseRepository.create(expense)
    return this.expenseWithTotalRepository.findById(createdExpense.id!, {
      include: ['expense_details'],
    })
  }

  /**
   * Crea un gasto con sus detalles en una transacción atómica
   */
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
          schema: {
            type: 'object',
            required: ['date'],
            properties: {
              date: { type: 'string', format: 'date' },
              expenseDetails: {
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
    expense: {
      date: string
      expenseDetails?: Array<{
        weight_kg: number
        productId: number
        personId: number
      }>
    },
  ): Promise<ExpenseWithTotal> {
    const details = expense.expenseDetails ?? []
    const newExpense = {
      date: expense.date,
      details: details,
    } as Partial<Expense> & {
      details?: Array<{
        weight_kg: number
        productId: number
        personId: number
      }>
    }
    const createdExpense = await this.transactionService.createWithDetails<
      Expense,
      {
        weight_kg: number
        productId: number
        personId: number
      }
    >(newExpense, this.expenseRepository, 'expense_details', false)
    return this.expenseWithTotalRepository.findById(createdExpense.id!, {
      include: ['expense_details'],
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

  // @requireAuth() // Cualquier usuario autenticado puede leer
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
    @param.query.number('page') page: number = 1,
    @param.query.number('limit') limit: number = 10,
  ): Promise<Pagination<ExpenseWithTotal>> {
    const expenses = await this.expenseWithTotalRepository.find({
      ...filter,
      include: filter?.include ?? ['expense_details'],
      skip: (page - 1) * limit,
      limit: limit,
    })
    const count = await this.expenseWithTotalRepository.count(filter?.where)
    return new Pagination<ExpenseWithTotal>({
      count: count.count,
      data: expenses,
      page: page,
      limit: limit,
    })
  }

  // O usar por separado si prefieres
  // @requireAuth()
  // @requireRoles('admin')
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
    expense: Expense,
    @param.where(Expense) where?: Where<Expense>,
  ): Promise<Count> {
    return this.expenseRepository.updateAll(expense, where)
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
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, { partial: true }),
        },
      },
    })
    expense: Partial<Expense>,
  ): Promise<ExpenseWithTotal> {
    await this.expenseRepository.updateById(id, expense)
    return this.expenseWithTotalRepository.findById(id, {
      include: ['expense_details'],
    })
  }

  /**
   * Actualiza un gasto con sus detalles (crear, actualizar, eliminar detalles) usando Server-Side Reconciliation
   */
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
          schema: {
            type: 'object',
            required: ['id', 'version'],
            properties: {
              id: { type: 'number' },
              version: { type: 'number' },
              date: { type: 'string', format: 'date' },
              expenseDetails: {
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
    expenseData: {
      id: number
      version: number
      date?: string
      expenseDetails?: Array<{
        id?: number
        weight_kg: number
        productId: number
        personId: number
      }>
    },
  ): Promise<ExpenseWithTotal> {
    try {
      // Usar el TransactionService para manejar la lógica compleja
      await this.transactionService.updateWithDetails<
        Expense,
        {
          id?: number
          weight_kg: number
          productId: number
          personId: number
        }
      >(
        {
          id: expenseData.id,
          version: expenseData.version,
          date: expenseData.date,
          details: expenseData.expenseDetails,
        },
        this.expenseRepository,
        'expense_details',
        false,
      )
      return await this.expenseWithTotalRepository.findById(expenseData.id, {
        include: ['expense_details'],
      })
    } catch (error) {
      if (error && (error as { statusCode?: number }).statusCode) throw error
      throw new HttpErrors.BadRequest(
        `Error updating expense with details: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  // @requireAuthAndRoles('admin') // Solo admin puede eliminar
  @del('/expenses/{id}')
  @response(204, {
    description: 'Expense DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    await this.transactionService.deleteWithDetails(
      id,
      this.expenseRepository,
      'expense_details',
      false,
    )
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
    @param.query.number('page') page: number = 1,
    @param.query.number('limit') limit: number = 10,
  ): Promise<Pagination<ExpenseWithTotal>> {
    // Validar fechas si se proporcionan
    if (startDate) {
      this.transactionService.validateDate(startDate)
    }
    if (endDate) {
      this.transactionService.validateDate(endDate)
    }

    const { data, count } =
      await this.expenseWithTotalRepository.findFilteredExpenses(
        startDate,
        endDate,
        personId,
        productId,
        page,
        limit,
      )

    return new Pagination<ExpenseWithTotal>({
      count,
      data,
      page,
      limit,
    })
  }
}
