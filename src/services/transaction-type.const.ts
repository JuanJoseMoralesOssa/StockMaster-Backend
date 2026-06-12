import { KardexOperation } from '../models'
import { TransactionKind } from './transaction-kind.enum'
import { DetailBase } from './transaction.types'

export type StockMutationMode = 'apply' | 'undo'

export interface TransactionTypeConfig {
  relationName: string
  parentTable: 'purchase' | 'expense'
  detailTable: 'purchasedetails' | 'expensedetails'
  parentFk: 'purchaseId' | 'expenseId'
  stockDirection: 1 | -1
  kardexOperations: Record<StockMutationMode, KardexOperation>
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
    stockDirection: 1,
    kardexOperations: {
      apply: KardexOperation.PurchaseApply,
      undo: KardexOperation.PurchaseUndo,
    },
  },
  [TransactionKind.EXPENSE]: {
    relationName: 'expense_details',
    parentTable: 'expense',
    detailTable: 'expensedetails',
    parentFk: 'expenseId',
    stockDirection: -1,
    kardexOperations: {
      apply: KardexOperation.ExpenseApply,
      undo: KardexOperation.ExpenseUndo,
    },
  },
}

/**
 * Sign matrix for stock mutations: a purchase applies stock in (+) and undoes
 * out (-); an expense is the mirror image. Pure function so the
 * highest-consequence decision in the system is unit-testable in isolation.
 */
export function getStockOperator(
  transactionKind: TransactionKind,
  mode: StockMutationMode,
): '+' | '-' {
  const direction = TRANSACTION_CONFIG[transactionKind].stockDirection
  const signedDirection = mode === 'apply' ? direction : -direction
  return signedDirection > 0 ? '+' : '-'
}

/** Kardex operation code for a kind × mode combination, driven by config. */
export function getKardexOperation(
  transactionKind: TransactionKind,
  mode: StockMutationMode,
): KardexOperation {
  return TRANSACTION_CONFIG[transactionKind].kardexOperations[mode]
}

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
  [TransactionKind.EXPENSE]: 'Gasto',
} as const
