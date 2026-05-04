import { Entity, hasMany, model, property } from '@loopback/repository'
import { Person } from './person.model'
import { Product } from './product.model'
import { PurchaseDetails } from './purchase-details.model'

@model({
  settings: {
    indexes: {
      idx_purchase_date: {
        keys: { date: 1 },
      },
    },
  },
})
export class Purchase extends Entity {
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

  @hasMany(() => PurchaseDetails)
  purchase_details?: PurchaseDetails[]

  @hasMany(() => Person, { through: { model: () => PurchaseDetails } })
  people: Person[]

  @hasMany(() => Product, { through: { model: () => PurchaseDetails } })
  products: Product[]

  @property({
    type: 'number',
    required: true,
    default: 1,
  })
  version: number

  constructor(data?: Partial<Purchase>) {
    super(data)
  }
}

export interface PurchaseRelations {
  // describe navigational properties here
}

export type PurchaseWithRelations = Purchase & PurchaseRelations
