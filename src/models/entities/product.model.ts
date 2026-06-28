import { Entity, hasMany, model, property } from '@loopback/repository'
import { PaymentDetails } from './payment-details.model'
import { Payment } from './payment.model'
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
  balance?: number

  @hasMany(() => Person, { through: { model: () => PaymentDetails } })
  people_payment_details: Person[]

  @hasMany(() => Person, { through: { model: () => PurchaseDetails } })
  people_purchase_details: Person[]

  @hasMany(() => Kardex)
  kardexes: Kardex[]

  @hasMany(() => Purchase, { through: { model: () => PurchaseDetails } })
  purchases: Purchase[]

  @hasMany(() => Payment, { through: { model: () => PaymentDetails } })
  payments: Payment[]

  constructor(data?: Partial<Product>) {
    super(data)
  }
}

export interface ProductRelations {
  // describe navigational properties here
}

export type ProductWithRelations = Product & ProductRelations
