import { Entity, hasMany, model, property } from '@loopback/repository'
import { ExpenseDetails } from './expense-details.model'
import { Person } from './person.model'
import { Product } from './product.model'

@model()
export class Expense extends Entity {
  @property({
    type: 'number',
    id: true,
    generated: true,
  })
  id?: number

  @property({
    type: 'number',
    required: true,
  })
  total_kg: number

  @property({
    type: 'date',
    jsonSchema: {
      format: 'date',
    },
    required: true,
    mysql: {
      columnName: 'date',
      dataType: 'date',
      dataLength: null,
      dataPrecision: null,
      dataScale: null,
      nullable: 'N',
    },
  })
  date: string

  @hasMany(() => ExpenseDetails)
  expense_details: ExpenseDetails[]

  @hasMany(() => Person, { through: { model: () => ExpenseDetails } })
  people: Person[]

  @hasMany(() => Product, { through: { model: () => ExpenseDetails } })
  products: Product[]

  constructor(data?: Partial<Expense>) {
    super(data)
  }
}

export interface ExpenseRelations {
  // describe navigational properties here
}

export type ExpenseWithRelations = Expense & ExpenseRelations
