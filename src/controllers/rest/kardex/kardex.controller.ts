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
  param,
  patch,
  post,
  put,
  requestBody,
  response,
} from '@loopback/rest'
import { Kardex, Pagination } from '../../../models'
import { KardexRepository } from '../../../repositories'

export class KardexController {
  constructor(
    @repository(KardexRepository)
    public kardexRepository: KardexRepository,
  ) {}

  @post('/kardexes')
  @response(200, {
    description: 'Kardex model instance',
    content: { 'application/json': { schema: getModelSchemaRef(Kardex) } },
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
    kardex: Omit<Kardex, 'id'>,
  ): Promise<Kardex> {
    return this.kardexRepository.create(kardex)
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
    @param.query.number('page') page: number = 1,
    @param.query.number('limit') limit: number = 10,
  ): Promise<Pagination<Kardex>> {
    const kardexes = await this.kardexRepository.find({
      ...filter,
      skip: (page - 1) * limit,
      limit: limit,
    })
    const count = await this.kardexRepository.count(filter?.where)
    return new Pagination<Kardex>({
      count: count.count,
      data: kardexes,
      page: page,
      limit: limit,
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
    kardex: Kardex,
    @param.where(Kardex) where?: Where<Kardex>,
  ): Promise<Count> {
    return this.kardexRepository.updateAll(kardex, where)
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
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Kardex, { partial: true }),
        },
      },
    })
    kardex: Kardex,
  ): Promise<void> {
    await this.kardexRepository.updateById(id, kardex)
  }

  @put('/kardexes/{id}')
  @response(204, {
    description: 'Kardex PUT success',
  })
  async replaceById(
    @param.path.number('id') id: number,
    @requestBody() kardex: Kardex,
  ): Promise<void> {
    await this.kardexRepository.replaceById(id, kardex)
  }

  @del('/kardexes/{id}')
  @response(204, {
    description: 'Kardex DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    await this.kardexRepository.deleteById(id)
  }
}
