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
import { Pagination, User } from '../../../models'
import { UserRepository } from '../../../repositories'
import { SecurityService } from '../../../services'

// Usuarios: lectura Oficina+Admin; escrituras (crear/editar/borrar) solo Admin.
@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class UserController {
  constructor(
    @repository(UserRepository)
    public userRepository: UserRepository,
    @service(SecurityService)
    public securityService: SecurityService,
  ) {}

  @requireRoles(Roles.ADMIN)
  @post('/users')
  @response(200, {
    description: 'User model instance',
    content: { 'application/json': { schema: getModelSchemaRef(User) } },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(User, {
            title: 'NewUser',
            exclude: ['id'],
          }),
        },
      },
    })
    user: Omit<User, 'id'>,
  ): Promise<User> {
    if (user.password) {
      // Hash the password before saving the user
      user.password = await this.securityService.hashPassword(user.password)
    } else if (
      !user.password ||
      user.password.trim() === '' ||
      user.password.length === 0
    ) {
      throw new HttpErrors.BadRequest('Password is required')
    }
    const createdUser = await this.userRepository.create(user)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...userWithoutPassword } = createdUser
    return userWithoutPassword as User
  }

  @get('/users/count')
  @response(200, {
    description: 'User model count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async count(@param.where(User) where?: Where<User>): Promise<Count> {
    return this.userRepository.count(where)
  }

  @get('/users')
  @response(200, {
    description: 'Array of User model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(User, { includeRelations: true }),
        },
      },
    },
  })
  async find(
    @param.filter(User) filter?: Filter<User>,
    @param.query.number('page') page: number = 1,
    @param.query.number('limit') limit: number = 10,
  ): Promise<Pagination<User>> {
    const users = await this.userRepository.find({
      ...filter,
      fields: {
        id: true,
        name: true,
        email: true,
        role: true,
        password: false,
      },
      skip: (page - 1) * limit,
      limit: limit,
    })
    const count = await this.userRepository.count(filter?.where)
    return new Pagination<User>({
      count: count.count,
      data: users,
      page: page,
      limit: limit,
    })
  }

  @get('/users/filtered')
  @response(200, {
    description: 'Array of filtered User model instances with pagination',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            data: {
              type: 'array',
              items: getModelSchemaRef(User, { includeRelations: true }),
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
    @param.query.string('email') email?: string,
    @param.query.string('role') role?: string,
    @param.query.number('page') page: number = 1,
    @param.query.number('limit') limit: number = 10,
  ): Promise<Pagination<User>> {
    const conditions: Where<User>[] = []
    const trimmedName = name?.trim()
    const trimmedEmail = email?.trim()
    const trimmedRole = role?.trim()
    if (trimmedName) conditions.push({ name: { ilike: `%${trimmedName}%` } })
    if (trimmedEmail) conditions.push({ email: { ilike: `%${trimmedEmail}%` } })
    if (trimmedRole) conditions.push({ role: trimmedRole })
    const where: Where<User> = conditions.length ? { and: conditions } : {}

    const [users, count] = await Promise.all([
      this.userRepository.find({
        where,
        fields: {
          id: true,
          name: true,
          email: true,
          role: true,
          password: false,
        },
        skip: (page - 1) * limit,
        limit,
      }),
      this.userRepository.count(where),
    ])

    return new Pagination<User>({
      count: count.count,
      data: users,
      page,
      limit,
    })
  }

  @requireRoles(Roles.ADMIN)
  @patch('/users')
  @response(200, {
    description: 'User PATCH success count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(User, { partial: true }),
        },
      },
    })
    user: User,
    @param.where(User) where?: Where<User>,
  ): Promise<Count> {
    return this.userRepository.updateAll(user, where)
  }

  @get('/users/{id}')
  @response(200, {
    description: 'User model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(User, { includeRelations: true }),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(User, { exclude: 'where' })
    filter?: FilterExcludingWhere<User>,
  ): Promise<User> {
    return this.userRepository.findById(id, filter)
  }

  @requireRoles(Roles.ADMIN)
  @patch('/users/{id}')
  @response(200, {
    description: 'User PATCH success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(User, { includeRelations: true }),
      },
    },
  })
  async updateById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(User, { partial: true }),
        },
      },
    })
    user: Partial<User>,
  ): Promise<User> {
    if (user.password) {
      // Hash the password before updating the user
      user.password = await this.securityService.hashPassword(user.password)
    }
    await this.userRepository.updateById(id, user)
    return this.userRepository.findById(id, {
      include: [],
      fields: {
        password: false,
      },
    })
  }

  @requireRoles(Roles.ADMIN)
  @put('/users/{id}')
  @response(200, {
    description: 'User PUT success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(User, { includeRelations: true }),
      },
    },
  })
  async replaceById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(User, {
            title: 'UserReplace',
            exclude: ['id'],
          }),
        },
      },
    })
    user: Omit<User, 'id'>,
  ): Promise<User> {
    if (user.password) {
      // Hash the password before saving the user
      user.password = await this.securityService.hashPassword(user.password)
    }
    await this.userRepository.replaceById(id, user)
    return this.userRepository.findById(id, {
      include: [],
      fields: {
        password: false,
      },
    })
  }

  @requireRoles(Roles.ADMIN)
  @del('/users/{id}')
  @response(204, {
    description: 'User DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    await this.userRepository.deleteById(id)
  }
}
