import {belongsTo, Entity, model, property} from '@loopback/repository';
import {Expense} from './expense.model';
import {Person} from './person.model';
import {Product} from './product.model';

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

  @belongsTo(() => Product)
  productId: number;

  @belongsTo(() => Person)
  personId: number;

  @belongsTo(() => Expense)
  expenseId: number;

  constructor(data?: Partial<ExpenseDetails>) {
    super(data);
  }
}

export interface ExpenseDetailsRelations {
  // describe navigational properties here
}

export type ExpenseDetailsWithRelations = ExpenseDetails &
  ExpenseDetailsRelations;
