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
import { Pagination, Person } from '../../../models'
import {
  ExpenseDetailsRepository,
  PersonRepository,
  PurchaseDetailsRepository,
} from '../../../repositories'

// Personas: lectura y mutaciones para Oficina y Admin.
@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PersonController {
  constructor(
    @repository(PersonRepository)
    public personRepository: PersonRepository,
    @repository(ExpenseDetailsRepository)
    public expenseDetailsRepository: ExpenseDetailsRepository,
    @repository(PurchaseDetailsRepository)
    public purchaseDetailsRepository: PurchaseDetailsRepository,
  ) {}

  @post('/people')
  @response(200, {
    description: 'Person model instance',
    content: { 'application/json': { schema: getModelSchemaRef(Person) } },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, {
            title: 'NewPerson',
            exclude: ['id'],
          }),
        },
      },
    })
    person: Omit<Person, 'id'>,
  ): Promise<Person> {
    return this.personRepository.create(person)
  }

  @get('/people/count')
  @response(200, {
    description: 'Person model count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async count(@param.where(Person) where?: Where<Person>): Promise<Count> {
    return this.personRepository.count(where)
  }

  @get('/people')
  @response(200, {
    description: 'Array of Person model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(Person, { includeRelations: true }),
        },
      },
    },
  })
  async find(
    @param.filter(Person) filter?: Filter<Person>,
    @param.query.number('page') page: number = paginationConfig.DEFAULT_PAGE,
    @param.query.number('limit') limit: number = paginationConfig.DEFAULT_LIMIT,
  ): Promise<Pagination<Person>> {
    const pagination = normalizePagination(page, limit)
    const newFilter: Filter<Person> = {
      ...(filter ?? {}),
      order: ['name ASC'],
    }
    const people = await this.personRepository.find({
      ...newFilter,
      skip: pagination.skip,
      limit: pagination.limit,
    })
    const count = await this.personRepository.count(filter?.where)
    return new Pagination<Person>({
      count: count.count,
      data: people,
      page: pagination.page,
      limit: pagination.limit,
    })
  }

  @get('/people/all')
  @response(200, {
    description: 'Array of Person model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(Person, { includeRelations: true }),
        },
      },
    },
  })
  async findAll(
    @param.filter(Person) filter?: Filter<Person>,
  ): Promise<Person[]> {
    const newFilter: Filter<Person> = {
      ...(filter ?? {}),
      order: ['name ASC'],
    }
    return this.personRepository.find(newFilter)
  }

  @get('/people/filtered')
  @response(200, {
    description: 'Array of filtered Person model instances with pagination',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            data: {
              type: 'array',
              items: getModelSchemaRef(Person, { includeRelations: true }),
            },
            page: { type: 'number' },
            limit: { type: 'number' },
          },
        },
      },
    },
  })
  async findFiltered(
    @param.query.string('name') name?: string,
    @param.query.number('page') page: number = paginationConfig.DEFAULT_PAGE,
    @param.query.number('limit') limit: number = paginationConfig.DEFAULT_LIMIT,
  ): Promise<Pagination<Person>> {
    const pagination = normalizePagination(page, limit)
    const trimmedName = name?.trim()
    const where: Where<Person> = trimmedName
      ? { name: { ilike: `%${trimmedName}%` } }
      : {}

    const [data, count] = await Promise.all([
      this.personRepository.find({
        where,
        order: ['name ASC'],
        skip: pagination.skip,
        limit: pagination.limit,
      }),
      this.personRepository.count(where),
    ])

    return new Pagination<Person>({
      count: count.count,
      data,
      page: pagination.page,
      limit: pagination.limit,
    })
  }

  @patch('/people')
  @response(200, {
    description: 'Person PATCH success count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, { partial: true }),
        },
      },
    })
    person: Person,
    @param.where(Person) where?: Where<Person>,
  ): Promise<Count> {
    return this.personRepository.updateAll(person, where)
  }

  @get('/people/{id}')
  @response(200, {
    description: 'Person model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Person, { includeRelations: true }),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(Person, { exclude: 'where' })
    filter?: FilterExcludingWhere<Person>,
  ): Promise<Person> {
    return this.personRepository.findById(id, filter)
  }

  @patch('/people/{id}')
  @response(200, {
    description: 'Person PATCH success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Person, { includeRelations: true }),
      },
    },
  })
  async updateById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, { partial: true }),
        },
      },
    })
    person: Partial<Person>,
  ): Promise<Person> {
    await this.personRepository.updateById(id, person)
    return this.personRepository.findById(id, { include: [] })
  }

  @put('/people/{id}')
  @response(200, {
    description: 'Person PUT success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Person, { includeRelations: true }),
      },
    },
  })
  async replaceById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, {
            title: 'PersonReplace',
            exclude: ['id'],
          }),
        },
      },
    })
    person: Omit<Person, 'id'>,
  ): Promise<Person> {
    await this.personRepository.replaceById(id, person)
    return this.personRepository.findById(id, { include: [] })
  }

  @del('/people/{id}')
  @response(204, {
    description: 'Person DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    const person = await this.personRepository.findById(id)
    if (!person) {
      throw new HttpErrors.NotFound(`Person with id ${id} not found`)
    }

    const [expenseDetailsCount, purchaseDetailsCount] = await Promise.all([
      this.expenseDetailsRepository.count({ personId: id }),
      this.purchaseDetailsRepository.count({ personId: id }),
    ])

    const totalReferences =
      expenseDetailsCount.count + purchaseDetailsCount.count

    if (totalReferences > 0) {
      throw new HttpErrors.Conflict(
        'Cannot deactivate person with transaction history',
      )
    }
    await this.personRepository.deleteById(id)
  }
}
