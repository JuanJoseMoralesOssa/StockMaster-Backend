import { Entity, hasMany, model, property } from '@loopback/repository'
import { PaymentDetails } from './payment-details.model'
import { Person } from './person.model'
import { Product } from './product.model'

/**
 * WRITE model for payments (table `payment`). All mutations go through this
 * model; reads that need the computed `total_kg` use its twin
 * {@link PaymentWithTotal}, backed by the `payment_with_total` DB view. Shares
 * columns with the twin but cannot be merged (generated id + physical table vs
 * read-only view). Keep the shared columns in sync across both files. See
 * CLAUDE.md › "Dual-model read pattern".
 */
@model({
  settings: {
    indexes: {
      idx_payment_date: {
        keys: { date: 1 },
      },
    },
  },
})
export class Payment extends Entity {
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

  @hasMany(() => PaymentDetails)
  payment_details: PaymentDetails[]

  @hasMany(() => Person, { through: { model: () => PaymentDetails } })
  people: Person[]

  @hasMany(() => Product, { through: { model: () => PaymentDetails } })
  products: Product[]

  @property({
    type: 'number',
    required: true,
    default: 1,
  })
  version: number

  constructor(data?: Partial<Payment>) {
    super(data)
  }
}

export interface PaymentRelations {
  // describe navigational properties here
}

export type PaymentWithRelations = Payment & PaymentRelations
