import {service} from '@loopback/core';
import {
  Count,
  CountSchema,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from '@loopback/repository';
import {
  del,
  get,
  getModelSchemaRef,
  param,
  patch,
  post,
  put,
  requestBody,
  response
} from '@loopback/rest';
import {Expense, Pagination} from '../../../models';
import {ExpenseRepository} from '../../../repositories';
import {TransactionService} from '../../../services';
// import {requireAuth, requireAuthAndRoles} from '../auth';

export class ExpenseController {
  constructor(
    @repository(ExpenseRepository)
    public expenseRepository: ExpenseRepository,
    @service(TransactionService)
    public transactionService: TransactionService,
  ) { }

  // @requireAuthAndRoles('admin', 'manager')  // Solo admin y manager pueden crear
  @post('/expenses')
  @response(200, {
    description: 'Expense model instance',
    content: {'application/json': {schema: getModelSchemaRef(Expense)}},
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, {
            title: 'NewExpense',
            exclude: ['id'],
          }),
        },
      },
    })
    expense: Omit<Expense, 'id'>,
  ): Promise<Expense> {
    this.transactionService.validateDate(expense.date);
    const createdExpense = await this.expenseRepository.create(expense);
    return this.expenseRepository.findById(createdExpense.id!, {
      include: ['expense_details']
    });
  }

  /**
   * Crea un gasto con sus detalles en una transacción atómica
   */
  @post('/expenses/with-details')
  @response(200, {
    description: 'Expense created with details',
    content: {'application/json': {schema: getModelSchemaRef(Expense, {includeRelations: true})}},
  })
  async createWithDetails(
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['date'],
            properties: {
              date: {type: 'string', format: 'date'},
              expenseDetails: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['weight_kg', 'productId', 'personId'],
                  properties: {
                    weight_kg: {type: 'number'},
                    productId: {type: 'number'},
                    personId: {type: 'number'},
                  }
                }
              }
            }
          }
        },
      },
    })
    expense: {
      date: string;
      expenseDetails?: Array<{
        weight_kg: number;
        productId: number;
        personId: number;
      }>;
    },
  ): Promise<Expense> {
    const details = expense.expenseDetails ?? [];
    const newExpense = {
      date: expense.date,
      details: details
    } as Partial<Expense> & {details?: Array<{weight_kg: number; productId: number; personId: number}>};
    return this.transactionService.createWithDetails<Expense, {
      weight_kg: number;
      productId: number;
      personId: number;
    }>(
      newExpense,
      this.expenseRepository,
      'expense_details'
    );
  }

  @get('/expenses/count')
  @response(200, {
    description: 'Expense model count',
    content: {'application/json': {schema: CountSchema}},
  })
  async count(
    @param.where(Expense) where?: Where<Expense>,
  ): Promise<Count> {
    return this.expenseRepository.count(where);
  }

  // @requireAuth() // Cualquier usuario autenticado puede leer
  @get('/expenses')
  @response(200, {
    description: 'Array of Expense model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(Expense, {includeRelations: true}),
        },
      },
    },
  })
  async find(
    @param.filter(Expense) filter?: Filter<Expense>,
    @param.query.number('page') page: number = 1,
    @param.query.number('limit') limit: number = 10,
  ): Promise<Pagination<Expense>> {
    const expenses = await this.expenseRepository.find({
      ...filter,
      skip: (page - 1) * limit,
      limit: limit
    });
    const count = await this.expenseRepository.count(filter?.where);
    return new Pagination<Expense>({
      count: count.count,
      data: expenses,
      page: page,
      limit: limit
    });
  }

  // O usar por separado si prefieres
  // @requireAuth()
  // @requireRoles('admin')
  @patch('/expenses')
  @response(200, {
    description: 'Expense PATCH success count',
    content: {'application/json': {schema: CountSchema}},
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, {partial: true}),
        },
      },
    })
    expense: Expense,
    @param.where(Expense) where?: Where<Expense>,
  ): Promise<Count> {
    return this.expenseRepository.updateAll(expense, where);
  }

  @get('/expenses/{id}')
  @response(200, {
    description: 'Expense model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Expense, {includeRelations: true}),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(Expense, {exclude: 'where'}) filter?: FilterExcludingWhere<Expense>
  ): Promise<Expense> {
    return this.expenseRepository.findById(id, filter);
  }

  @patch('/expenses/{id}')
  @response(200, {
    description: 'Expense PATCH success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Expense, {includeRelations: true}),
      },
    },
  })
  async updateById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, {partial: true}),
        },
      },
    })
    expense: Partial<Expense>,
  ): Promise<Expense> {
    await this.expenseRepository.updateById(id, expense);
    return this.expenseRepository.findById(id, {include: ["expense_details"]});
  }

  @put('/expenses/{id}')
  @response(200, {
    description: 'Expense PUT success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Expense, {includeRelations: true}),
      },
    },
  })
  async replaceById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Expense, {
            title: 'ExpenseReplace',
            exclude: ['id'],
          }),
        },
      },
    })
    expense: Omit<Expense, 'id'>,
  ): Promise<Expense> {
    await this.expenseRepository.replaceById(id, expense);
    return this.expenseRepository.findById(id, {include: ["expense_details"]});
  }

  // @requireAuthAndRoles('admin') // Solo admin puede eliminar
  @del('/expenses/{id}')
  @response(204, {
    description: 'Expense DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    await this.expenseRepository.deleteById(id);
  }

}
