import { belongsTo, Entity, model, property } from '@loopback/repository'
import { Person } from './person.model'
import { Product } from './product.model'
import { Purchase } from './purchase.model'

@model({
  settings: {
    indexes: {
      idx_purchase_details_purchase: {
        keys: { purchaseId: 1 },
      },
      idx_purchase_details_product: {
        keys: { productId: 1 },
      },
      idx_purchase_details_person: {
        keys: { personId: 1 },
      },
    },
  },
})
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
    jsonSchema: {
      exclusiveMinimum: 0,
    },
    // Fractional kg with gram precision (see roundWeight). MUST stay numeric:
    // an integer column rejects decimal weights with PG error 22P02.
    postgresql: {
      dataType: 'numeric',
      dataPrecision: 14,
      dataScale: 3,
    },
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
