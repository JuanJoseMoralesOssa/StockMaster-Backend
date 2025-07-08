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
  response,
} from '@loopback/rest';
import {Expense, Pagination} from '../../../models';
import {ExpenseRepository} from '../../../repositories';
// import {requireAuth, requireAuthAndRoles} from '../auth';

export class ExpenseController {
  constructor(
    @repository(ExpenseRepository)
    public expenseRepository: ExpenseRepository,
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
    return this.expenseRepository.create(expense);
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
