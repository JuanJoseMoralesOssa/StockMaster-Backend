import { BindingScope, injectable, service } from '@loopback/core'
import { Count, repository, Where } from '@loopback/repository'
import { isRole } from '../auth/roles'
import { ValidationError } from '../errors'
import { User } from '../models'
import { UserRepository } from '../repositories'
import { SecurityService } from './security.service'

/**
 * The projection every read of a user must use: the bcrypt hash never leaves the
 * server, not even to an admin. One constant instead of the four hand-copied
 * `fields` blocks the controller used to carry — a fifth endpoint that forgot
 * one of them would have leaked the hash.
 */
export const PUBLIC_USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  password: false,
} as const

/**
 * Owns every write to a user, the way ProductService owns every write to a
 * product. Three rules live here because they were previously scattered across
 * four controller methods and two of them were simply missing:
 *
 *  1. a password is REQUIRED on create/replace and, whenever supplied, must not
 *     be blank — a `PUT` with `password: ""` used to store an empty credential;
 *  2. a role must be one of the canonical roles — a typo used to reach the DB
 *     and produce a user who authenticates but can reach no endpoint at all,
 *     because `roleSatisfies` rejects an unknown role;
 *  3. a password is ALWAYS hashed before it is persisted.
 *
 * Controllers delegate here and never call the repository's write methods, so a
 * new endpoint cannot bypass the rules by accident.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class UserService {
  constructor(
    @repository(UserRepository)
    private readonly userRepository: UserRepository,
    @service(SecurityService)
    private readonly securityService: SecurityService,
  ) {}

  async create(data: Omit<User, 'id'>): Promise<User> {
    this.assertRoleValid(data.role)
    const password = await this.hashRequiredPassword(data.password)

    const created = await this.userRepository.create({ ...data, password })
    return this.withoutPassword(created)
  }

  /** PATCH: every field optional, but a supplied one must still be valid. */
  async updateById(id: number, data: Partial<User>): Promise<User> {
    const payload = await this.buildWritePayload(data)

    await this.userRepository.updateById(id, payload)
    return this.findPublicById(id)
  }

  /** PUT: full representation, so the password is as mandatory as on create. */
  async replaceById(id: number, data: Omit<User, 'id'>): Promise<User> {
    this.assertRoleValid(data.role)
    const password = await this.hashRequiredPassword(data.password)

    await this.userRepository.replaceById(id, { ...data, password } as User)
    return this.findPublicById(id)
  }

  async updateAll(data: Partial<User>, where?: Where<User>): Promise<Count> {
    const payload = await this.buildWritePayload(data)
    return this.userRepository.updateAll(payload, where)
  }

  /**
   * Validates and hashes whatever subset of protected fields a partial write
   * carries. Absent fields are left absent (a PATCH must not blank them).
   */
  private async buildWritePayload(data: Partial<User>): Promise<Partial<User>> {
    const payload: Partial<User> = { ...data }

    if (payload.role !== undefined) {
      this.assertRoleValid(payload.role)
    }
    if (payload.password !== undefined) {
      payload.password = await this.hashRequiredPassword(payload.password)
    }

    return payload
  }

  private assertRoleValid(role: string | undefined): void {
    if (!isRole(role)) {
      throw new ValidationError(
        `Rol inválido: "${role ?? ''}". Debe ser admin, office u operator.`,
      )
    }
  }

  private async hashRequiredPassword(
    password: string | undefined,
  ): Promise<string> {
    if (!password?.trim()) {
      throw new ValidationError('La contraseña es obligatoria.')
    }
    return this.securityService.hashPassword(password)
  }

  private async findPublicById(id: number): Promise<User> {
    return this.userRepository.findById(id, {
      include: [],
      fields: { ...PUBLIC_USER_FIELDS },
    })
  }

  private withoutPassword(user: User): User {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...rest } = user
    return rest as User
  }
}
