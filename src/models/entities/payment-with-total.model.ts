import { Entity, hasMany, model, property } from '@loopback/repository'
import { PaymentDetails } from './payment-details.model'
import { Person } from './person.model'
import { Product } from './product.model'

/**
 * READ twin of {@link Payment}, mapped to the `payment_with_total` DB view to
 * expose the computed `total_kg`. Read-only: never create/update through this
 * model. Shares the date/version/relation columns with the write model — change
 * them in both files. See CLAUDE.md › "Dual-model read pattern".
 */
@model({
  settings: {
    postgresql: { table: 'payment_with_total' },
  },
})
export class PaymentWithTotal extends Entity {
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

  @hasMany(() => PaymentDetails, { keyTo: 'paymentId' })
  payment_details: PaymentDetails[]

  @hasMany(() => Person, {
    through: {
      model: () => PaymentDetails,
      keyFrom: 'paymentId',
      keyTo: 'personId',
    },
  })
  people: Person[]

  @hasMany(() => Product, {
    through: {
      model: () => PaymentDetails,
      keyFrom: 'paymentId',
      keyTo: 'productId',
    },
  })
  products: Product[]

  @property({
    type: 'number',
  })
  version: number

  constructor(data?: Partial<PaymentWithTotal>) {
    super(data)
  }
}

export interface PaymentWithTotalRelations {
  // describe navigational properties here
}

export type PaymentWithTotalWithRelations = PaymentWithTotal &
  PaymentWithTotalRelations
