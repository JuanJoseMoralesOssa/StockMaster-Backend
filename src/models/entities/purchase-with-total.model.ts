import { Entity, hasMany, model, property } from '@loopback/repository'
import { Person } from './person.model'
import { Product } from './product.model'
import { PurchaseDetails } from './purchase-details.model'

/**
 * READ twin of {@link Purchase}, mapped to the `purchase_with_total` DB view so
 * it can expose the computed `total_kg`. Read-only: never create/update through
 * this model (its id is not generated and the view is not writable). Shares the
 * date/version/relation columns with the write model — change them in both
 * files. See CLAUDE.md › "Dual-model read pattern".
 */
@model({
  settings: {
    postgresql: { table: 'purchase_with_total' },
  },
})
export class PurchaseWithTotal extends Entity {
  @property({
    type: 'number',
    id: true,
  })
  id: number

  @property({
    type: 'date',
  })
  date: string

  @property({
    type: 'number',
  })
  total_kg: number

  @hasMany(() => PurchaseDetails, { keyTo: 'purchaseId' })
  purchase_details: PurchaseDetails[]

  @hasMany(() => Person, {
    through: {
      model: () => PurchaseDetails,
      keyFrom: 'purchaseId',
      keyTo: 'personId',
    },
  })
  people: Person[]

  @hasMany(() => Product, {
    through: {
      model: () => PurchaseDetails,
      keyFrom: 'purchaseId',
      keyTo: 'productId',
    },
  })
  products: Product[]

  @property({
    type: 'number',
  })
  version: number

  constructor(data?: Partial<PurchaseWithTotal>) {
    super(data)
  }
}

export interface PurchaseWithTotalRelations {
  // describe navigational properties here
}

export type PurchaseWithTotalWithRelations = PurchaseWithTotal &
  PurchaseWithTotalRelations
