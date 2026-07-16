import { Model, model, property } from '@loopback/repository'
import { User } from '../entities/user.model'

// El JWT ya no viaja en el body: /sign-in lo entrega vía cookie httpOnly
// (ver src/auth/auth-cookie.ts). Este modelo solo describe el body público.
@model()
export class LoginResult extends Model {
  @property({
    type: 'object',
    required: true,
  })
  user: User

  constructor(data?: Partial<LoginResult>) {
    super(data)
  }
}

export interface LoginResultRelations {
  // describe navigational properties here
}

export type LoginResultWithRelations = LoginResult & LoginResultRelations
