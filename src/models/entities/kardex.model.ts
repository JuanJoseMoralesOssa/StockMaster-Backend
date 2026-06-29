import { Entity, model, property, belongsTo } from '@loopback/repository'
import { Product } from './product.model'

export enum KardexOperation {
  PurchaseApply = 1,
  PurchaseUndo = 2,
  PaymentApply = 3,
  PaymentUndo = 4,
  /**
   * Opening balance recorded when a product is created with non-zero balance.
   * Without it the Kardex could not reconstruct current balance from its
   * movements (sum of inputs − outputs would miss the starting quantity).
   */
  OpeningBalance = 5,
  /**
   * Manual balance adjustment ("ajuste de inventario"): a correction made by a
   * user to reconcile the system balance with a physical count, not derived from a
   * purchase/payment. Written through BalanceReconciliationService so Product.balance
   * and this row stay consistent. Carries a `note` (the reason) and no source*.
   */
  Manual = 6,
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

  // input/output/balance track fractional kg movements (see roundWeightKg).
  // MUST stay numeric: an integer column rejects decimal weights with PG 22P02.
  @property({
    type: 'number',
    required: true,
    postgresql: {
      dataType: 'numeric',
      dataPrecision: 14,
      dataScale: 3,
    },
  })
  input: number

  @property({
    type: 'number',
    required: true,
    postgresql: {
      dataType: 'numeric',
      dataPrecision: 14,
      dataScale: 3,
    },
  })
  output: number

  @property({
    type: 'number',
    required: true,
    postgresql: {
      dataType: 'numeric',
      dataPrecision: 14,
      dataScale: 3,
    },
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

  /** 'purchase' | 'payment' — kind of the source document. */
  @property({
    type: 'string',
    jsonSchema: { enum: ['purchase', 'payment'] },
  })
  sourceKind?: string

  /** Id of the source purchase/payment document. */
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

  /**
   * Free-text reason for a manual adjustment (operation = Manual). Null for
   * system-generated rows (purchase/payment/opening). Lets the audit trail
   * explain why a balance correction was made (e.g. 'conteo físico', 'merma').
   */
  @property({
    type: 'string',
  })
  note?: string

  constructor(data?: Partial<Kardex>) {
    super(data)
  }
}

export interface KardexRelations {
  // describe navigational properties here
}

export type KardexWithRelations = Kardex & KardexRelations
