import { belongsTo, Entity, model, property } from '@loopback/repository'
import { Person } from './person.model'
import { Product } from './product.model'
import { Purchase } from './purchase.model'

@model()
export class PurchaseDetails extends Entity {
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
  weight_kg: number

  @belongsTo(() => Product)
  productId: number

  @belongsTo(() => Person)
  personId: number

  @belongsTo(() => Purchase)
  purchaseId: number

  constructor(data?: Partial<PurchaseDetails>) {
    super(data)
  }
}

export interface PurchaseDetailsRelations {
  // describe navigational properties here
}

export type PurchaseDetailsWithRelations = PurchaseDetails &
  PurchaseDetailsRelations
