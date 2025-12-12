import { Entity, model, property, belongsTo } from '@loopback/repository'
import { Product } from './product.model'

@model()
export class Kardex extends Entity {
  @property({
    type: 'number',
    id: true,
    generated: true,
  })
  id?: number

  @property({
    type: 'date',
    required: true,
  })
  date: string

  @property({
    type: 'number',
    required: true,
  })
  input: number

  @property({
    type: 'number',
    required: true,
  })
  output: number

  @property({
    type: 'number',
    required: true,
  })
  balance: number

  @property({
    type: 'boolean',
    required: true,
  })
  balance_record: boolean

  @property({
    type: 'number',
    required: true,
  })
  operation: number

  @belongsTo(() => Product)
  productId: number

  constructor(data?: Partial<Kardex>) {
    super(data)
  }
}

export interface KardexRelations {
  // describe navigational properties here
}

export type KardexWithRelations = Kardex & KardexRelations
