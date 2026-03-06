import { Entity, hasMany, model, property } from '@loopback/repository'
import { ExpenseDetails } from './expense-details.model'
import { Expense } from './expense.model'
import { Kardex } from './kardex.model'
import { Person } from './person.model'
import { PurchaseDetails } from './purchase-details.model'
import { Purchase } from './purchase.model'

@model()
export class Product extends Entity {
  @property({
    type: 'number',
    id: true,
    generated: true,
  })
  id?: number

  @property({
    type: 'string',
    required: true,
  })
  name: string

  @property({
    type: 'number',
  })
  stock?: number

  @property({
    type: 'boolean',
    required: true,
    default: true,
  })
  active: boolean

  @hasMany(() => Person, { through: { model: () => ExpenseDetails } })
  people_expense_details: Person[]

  @hasMany(() => Person, { through: { model: () => PurchaseDetails } })
  people_purchase_details: Person[]

  @hasMany(() => Kardex)
  kardexes: Kardex[]

  @hasMany(() => Purchase, { through: { model: () => PurchaseDetails } })
  purchases: Purchase[]

  @hasMany(() => Expense, { through: { model: () => ExpenseDetails } })
  expenses: Expense[]

  constructor(data?: Partial<Product>) {
    super(data)
  }
}

export interface ProductRelations {
  // describe navigational properties here
}

export type ProductWithRelations = Product & ProductRelations
