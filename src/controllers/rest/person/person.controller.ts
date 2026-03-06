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
import { Pagination, Person } from '../../../models'
import {
  ExpenseDetailsRepository,
  PersonRepository,
  PurchaseDetailsRepository,
} from '../../../repositories'

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
    return this.personRepository.create({
      ...person,
      active: person.active ?? true,
    })
  }

  @get('/people/count')
  @response(200, {
    description: 'Person model count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async count(@param.where(Person) where?: Where<Person>): Promise<Count> {
    return this.personRepository.count(this.withActiveWhere(where))
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
    @param.query.number('page') page: number = 1,
    @param.query.number('limit') limit: number = 10,
  ): Promise<Pagination<Person>> {
    const newFilter: Filter<Person> = {
      ...(filter ?? {}),
      where: this.withActiveWhere(filter?.where),
      order: ['name ASC'],
    }
    const people = await this.personRepository.find({
      ...newFilter,
      skip: (page - 1) * limit,
      limit: limit,
    })
    const count = await this.personRepository.count(newFilter?.where)
    return new Pagination<Person>({
      count: count.count,
      data: people,
      page: page,
      limit: limit,
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
      where: this.withActiveWhere(filter?.where),
      order: ['name ASC'],
    }
    return this.personRepository.find(newFilter)
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

    if (!person.active) {
      return
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

    await this.personRepository.updateById(id, { active: false })
  }

  @patch('/people/{id}/reactivate')
  @response(200, {
    description: 'Person reactivation success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Person, { includeRelations: true }),
      },
    },
  })
  async reactivateById(@param.path.number('id') id: number): Promise<Person> {
    const person = await this.personRepository.findById(id)
    if (!person) {
      throw new HttpErrors.NotFound(`Person with id ${id} not found`)
    }

    if (person.active) {
      return person
    }

    await this.personRepository.updateById(id, { active: true })
    return this.personRepository.findById(id, { include: [] })
  }

  private withActiveWhere(where?: Where<Person>): Where<Person> {
    if (!where) {
      return { active: true }
    }

    if ('active' in where) {
      return where
    }

    return { and: [where, { active: true }] }
  }
}
