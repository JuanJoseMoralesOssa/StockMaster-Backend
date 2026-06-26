import { Entity, hasMany, model, property } from '@loopback/repository'
import { ExpenseDetails } from './expense-details.model'
import { Person } from './person.model'
import { Product } from './product.model'

/**
 * WRITE model for expenses (table `expense`). All mutations go through this
 * model; reads that need the computed `total_kg` use its twin
 * {@link ExpenseWithTotal}, backed by the `expense_with_total` DB view. Shares
 * columns with the twin but cannot be merged (generated id + physical table vs
 * read-only view). Keep the shared columns in sync across both files. See
 * CLAUDE.md › "Dual-model read pattern".
 */
@model({
  settings: {
    indexes: {
      idx_expense_date: {
        keys: { date: 1 },
      },
    },
  },
})
export class Expense extends Entity {
  @property({
    type: 'number',
    id: true,
    generated: true,
  })
  id?: number

  @property({
    type: 'date',
    jsonSchema: {
      format: 'date',
    },
    required: true,
    postgresql: {
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

  @property({
    type: 'number',
    required: true,
    default: 1,
  })
  version: number

  constructor(data?: Partial<Expense>) {
    super(data)
  }
}

export interface ExpenseRelations {
  // describe navigational properties here
}

export type ExpenseWithRelations = Expense & ExpenseRelations
