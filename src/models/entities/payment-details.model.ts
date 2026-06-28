import { belongsTo, Entity, model, property } from '@loopback/repository'
import { Payment } from './payment.model'
import { Person } from './person.model'
import { Product } from './product.model'

@model({
  settings: {
    indexes: {
      idx_payment_details_payment: {
        keys: { paymentId: 1 },
      },
      idx_payment_details_product: {
        keys: { productId: 1 },
      },
      idx_payment_details_person: {
        keys: { personId: 1 },
      },
    },
  },
})
export class PaymentDetails extends Entity {
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

  @belongsTo(() => Payment)
  paymentId: number

  constructor(data?: Partial<PaymentDetails>) {
    super(data)
  }
}

export interface PaymentDetailsRelations {
  // describe navigational properties here
}

export type PaymentDetailsWithRelations = PaymentDetails &
  PaymentDetailsRelations
