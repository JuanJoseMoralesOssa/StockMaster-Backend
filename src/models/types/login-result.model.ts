import {Model, model, property} from '@loopback/repository';
import {User} from '../entities/user.model';

@model()
export class LoginResult extends Model {
  @property({
    type: 'object',
    required: true,
  })
  user: User;

  @property({
    type: 'string',
    required: true,
  })
  token: string;


  constructor(data?: Partial<LoginResult>) {
    super(data);
  }
}

export interface LoginResultRelations {
  // describe navigational properties here
}

export type LoginResultWithRelations = LoginResult & LoginResultRelations;
