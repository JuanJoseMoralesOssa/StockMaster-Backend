import { belongsTo, Entity, model, property } from '@loopback/repository'
import { Expense } from './expense.model'
import { Person } from './person.model'
import { Product } from './product.model'

@model({
  settings: {
    indexes: {
      idx_expense_details_expense: {
        keys: { expenseId: 1 },
      },
      idx_expense_details_product: {
        keys: { productId: 1 },
      },
      idx_expense_details_person: {
        keys: { personId: 1 },
      },
    },
  },
})
export class ExpenseDetails extends Entity {
  @property({
    type: 'number',
    id: true,
    generated: true,
  })
  id?: number

  @property({
    type: 'number',
    required: true,
    jsonSchema: {
      exclusiveMinimum: 0,
    },
  })
  weight_kg: number

  @belongsTo(() => Product)
  productId: number

  @belongsTo(() => Person)
  personId: number

  @belongsTo(() => Expense)
  expenseId: number

  constructor(data?: Partial<ExpenseDetails>) {
    super(data)
  }
}

export interface ExpenseDetailsRelations {
  // describe navigational properties here
}

export type ExpenseDetailsWithRelations = ExpenseDetails &
  ExpenseDetailsRelations
