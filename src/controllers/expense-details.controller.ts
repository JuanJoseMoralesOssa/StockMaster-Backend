import {
  Count,
  CountSchema,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from '@loopback/repository';
import {
  post,
  param,
  get,
  getModelSchemaRef,
  patch,
  put,
  del,
  requestBody,
  response,
} from '@loopback/rest';
import {ExpenseDetails} from '../models';
import {ExpenseDetailsRepository} from '../repositories';

export class ExpenseDetailsController {
  constructor(
    @repository(ExpenseDetailsRepository)
    public expenseDetailsRepository : ExpenseDetailsRepository,
  ) {}

  @post('/expense-details')
  @response(200, {
    description: 'ExpenseDetails model instance',
    content: {'application/json': {schema: getModelSchemaRef(ExpenseDetails)}},
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
    return this.expenseDetailsRepository.create(expenseDetails);
  }

  @get('/expense-details/count')
  @response(200, {
    description: 'ExpenseDetails model count',
    content: {'application/json': {schema: CountSchema}},
  })
  async count(
    @param.where(ExpenseDetails) where?: Where<ExpenseDetails>,
  ): Promise<Count> {
    return this.expenseDetailsRepository.count(where);
  }

  @get('/expense-details')
  @response(200, {
    description: 'Array of ExpenseDetails model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(ExpenseDetails, {includeRelations: true}),
        },
      },
    },
  })
  async find(
    @param.filter(ExpenseDetails) filter?: Filter<ExpenseDetails>,
  ): Promise<ExpenseDetails[]> {
    return this.expenseDetailsRepository.find(filter);
  }

  @patch('/expense-details')
  @response(200, {
    description: 'ExpenseDetails PATCH success count',
    content: {'application/json': {schema: CountSchema}},
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(ExpenseDetails, {partial: true}),
        },
      },
    })
    expenseDetails: ExpenseDetails,
    @param.where(ExpenseDetails) where?: Where<ExpenseDetails>,
  ): Promise<Count> {
    return this.expenseDetailsRepository.updateAll(expenseDetails, where);
  }

  @get('/expense-details/{id}')
  @response(200, {
    description: 'ExpenseDetails model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(ExpenseDetails, {includeRelations: true}),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(ExpenseDetails, {exclude: 'where'}) filter?: FilterExcludingWhere<ExpenseDetails>
  ): Promise<ExpenseDetails> {
    return this.expenseDetailsRepository.findById(id, filter);
  }

  @patch('/expense-details/{id}')
  @response(204, {
    description: 'ExpenseDetails PATCH success',
  })
  async updateById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(ExpenseDetails, {partial: true}),
        },
      },
    })
    expenseDetails: ExpenseDetails,
  ): Promise<void> {
    await this.expenseDetailsRepository.updateById(id, expenseDetails);
  }

  @put('/expense-details/{id}')
  @response(204, {
    description: 'ExpenseDetails PUT success',
  })
  async replaceById(
    @param.path.number('id') id: number,
    @requestBody() expenseDetails: ExpenseDetails,
  ): Promise<void> {
    await this.expenseDetailsRepository.replaceById(id, expenseDetails);
  }

  @del('/expense-details/{id}')
  @response(204, {
    description: 'ExpenseDetails DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    await this.expenseDetailsRepository.deleteById(id);
  }
}
