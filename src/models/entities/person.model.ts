import { Entity, hasMany, model, property } from '@loopback/repository'
import { PaymentDetails } from './payment-details.model'
import { Payment } from './payment.model'
import { Product } from './product.model'
import { PurchaseDetails } from './purchase-details.model'
import { Purchase } from './purchase.model'

@model()
export class Person extends Entity {
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

  @hasMany(() => Product, { through: { model: () => PaymentDetails } })
  products_payment_details: Product[]

  @hasMany(() => Product, { through: { model: () => PurchaseDetails } })
  products_purchase_details: Product[]

  @hasMany(() => Payment, { through: { model: () => PaymentDetails } })
  payments: Payment[]

  @hasMany(() => Purchase, { through: { model: () => PurchaseDetails } })
  purchases: Purchase[]

  constructor(data?: Partial<Person>) {
    super(data)
  }
}

export interface PersonRelations {
  // describe navigational properties here
}

export type PersonWithRelations = Person & PersonRelations
