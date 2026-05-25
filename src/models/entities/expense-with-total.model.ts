import { Entity, hasMany, model, property } from '@loopback/repository'
import { ExpenseDetails } from './expense-details.model'
import { Person } from './person.model'
import { Product } from './product.model'

@model({
  settings: {
    postgresql: { table: 'expense_with_total' },
  },
})
export class ExpenseWithTotal extends Entity {
  @property({
    type: 'number',
    id: true,
  })
  id: number

  @property({
    type: 'number',
  })
  total_kg: number

  @property({
    type: 'date',
  })
  date: string

  @hasMany(() => ExpenseDetails, { keyTo: 'expenseId' })
  expense_details: ExpenseDetails[]

  @hasMany(() => Person, {
    through: {
      model: () => ExpenseDetails,
      keyFrom: 'expenseId',
      keyTo: 'personId',
    },
  })
  people: Person[]

  @hasMany(() => Product, {
    through: {
      model: () => ExpenseDetails,
      keyFrom: 'expenseId',
      keyTo: 'productId',
    },
  })
  products: Product[]

  @property({
    type: 'number',
  })
  version: number

  constructor(data?: Partial<ExpenseWithTotal>) {
    super(data)
  }
}

export interface ExpenseWithTotalRelations {
  // describe navigational properties here
}

export type ExpenseWithTotalWithRelations = ExpenseWithTotal &
  ExpenseWithTotalRelations
