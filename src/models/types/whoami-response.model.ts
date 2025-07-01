import {Model, model, property} from '@loopback/repository';

@model()
export class WhoAmIResponse extends Model {
  @property({
    type: 'string',
    required: true,
  })
  id: string;

  @property({
    type: 'string',
    required: true,
  })
  name: string;

  @property({
    type: 'string',
    required: true,
  })
  email: string;

  @property({
    type: 'string',
    required: true,
  })
  role: string;

  constructor(data?: Partial<WhoAmIResponse>) {
    super(data);
  }
}
