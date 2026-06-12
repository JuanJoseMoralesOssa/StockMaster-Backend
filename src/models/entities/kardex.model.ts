import { Entity, model, property, belongsTo } from '@loopback/repository'
import { Product } from './product.model'

export enum KardexOperation {
  PurchaseApply = 1,
  PurchaseUndo = 2,
  ExpenseApply = 3,
  ExpenseUndo = 4,
}

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
    type: 'number',
    required: true,
  })
  operation: number

  @belongsTo(() => Product)
  productId: number

  // --- Provenance: which document/line caused the movement, and who did it.
  // Nullable because historical rows predate these columns.

  /** 'purchase' | 'expense' — kind of the source document. */
  @property({
    type: 'string',
    jsonSchema: { enum: ['purchase', 'expense'] },
  })
  sourceKind?: string

  /** Id of the source purchase/expense document. */
  @property({
    type: 'number',
  })
  sourceId?: number

  /** Id of the detail line that produced the movement, when known. */
  @property({
    type: 'number',
  })
  sourceDetailId?: number

  /** Id of the authenticated user who performed the operation. */
  @property({
    type: 'number',
  })
  userId?: number

  constructor(data?: Partial<Kardex>) {
    super(data)
  }
}

export interface KardexRelations {
  // describe navigational properties here
}

export type KardexWithRelations = Kardex & KardexRelations
