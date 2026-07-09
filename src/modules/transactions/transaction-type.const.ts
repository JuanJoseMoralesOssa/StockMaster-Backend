import { KardexOperation } from '../../models'
import { TransactionKind } from './transaction-kind.enum'
import { DetailBase } from './transaction.types'

export type BalanceMutationMode = 'apply' | 'undo'

export interface TransactionTypeConfig {
  relationName: string
  parentTable: 'purchase' | 'payment'
  detailTable: 'purchasedetails' | 'paymentdetails'
  parentFk: 'purchaseId' | 'paymentId'
  balanceDirection: 1 | -1
  kardexOperations: Record<BalanceMutationMode, KardexOperation>
}

export const TRANSACTION_CONFIG: Record<
  TransactionKind,
  TransactionTypeConfig
> = {
  [TransactionKind.PURCHASE]: {
    relationName: 'purchase_details',
    parentTable: 'purchase',
    detailTable: 'purchasedetails',
    parentFk: 'purchaseId',
    balanceDirection: 1,
    kardexOperations: {
      apply: KardexOperation.PurchaseApply,
      undo: KardexOperation.PurchaseUndo,
    },
  },
  [TransactionKind.PAYMENT]: {
    relationName: 'payment_details',
    parentTable: 'payment',
    detailTable: 'paymentdetails',
    parentFk: 'paymentId',
    balanceDirection: -1,
    kardexOperations: {
      apply: KardexOperation.PaymentApply,
      undo: KardexOperation.PaymentUndo,
    },
  },
}

/**
 * Sign matrix for balance mutations: a purchase applies balance in (+) and undoes
 * out (-); a payment is the mirror image. Pure function so the
 * highest-consequence decision in the system is unit-testable in isolation.
 */
export function getBalanceOperator(
  transactionKind: TransactionKind,
  mode: BalanceMutationMode,
): '+' | '-' {
  const direction = TRANSACTION_CONFIG[transactionKind].balanceDirection
  const signedDirection = mode === 'apply' ? direction : -direction
  return signedDirection > 0 ? '+' : '-'
}

/** Kardex operation code for a kind × mode combination, driven by config. */
export function getKardexOperation(
  transactionKind: TransactionKind,
  mode: BalanceMutationMode,
): KardexOperation {
  return TRANSACTION_CONFIG[transactionKind].kardexOperations[mode]
}

/**
 * The only parent-document columns a `with-details` update may write. This is
 * the SINGLE source of truth shared by the raw-SQL whitelist
 * (`updateParentWithVersionCheck`) and the no-op/version-skip detector
 * (`hasParentMutations`). Adding a column here must be a conscious act because
 * the no-op comparison and the SQL writer both consume it — they cannot drift.
 */
export const UPDATABLE_PARENT_FIELDS = ['date'] as const

export type UpdatableParentField = (typeof UPDATABLE_PARENT_FIELDS)[number]

// Column names used in raw SQL UPDATE statements. The `satisfies` checks
// enforce that each value is a valid DetailBase property key — TypeScript will
// error here if the model property is renamed without updating this constant.
export const DETAIL_COLUMNS = {
  weight: 'weight_kg' satisfies keyof DetailBase,
  product: 'productId' satisfies keyof DetailBase,
  person: 'personId' satisfies keyof DetailBase,
} as const

export const TRANSACTION_TYPE_LABEL = {
  [TransactionKind.PURCHASE]: 'Compra',
  [TransactionKind.PAYMENT]: 'Pago',
} as const
