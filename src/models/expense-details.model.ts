import {Entity, model, property} from '@loopback/repository';

@model()
export class ExpenseDetails extends Entity {
  @property({
    type: 'number',
    id: true,
    generated: true,
  })
  id?: number;

  @property({
    type: 'number',
    required: true,
  })
  weight_kg: number;

  @property({
    type: 'number',
  })
  personId?: number;

  @property({
    type: 'number',
  })
  productId?: number;

  @property({
    type: 'number',
  })
  expenseId?: number;

  constructor(data?: Partial<ExpenseDetails>) {
    super(data);
  }
}

export interface ExpenseDetailsRelations {
  // describe navigational properties here
}

export type ExpenseDetailsWithRelations = ExpenseDetails &
  ExpenseDetailsRelations;
