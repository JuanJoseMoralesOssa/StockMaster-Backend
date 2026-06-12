import { TransactionKind } from './transaction-kind.enum'

export interface TransactionTypeConfig {
  relationName: string
  parentTable: 'purchase' | 'expense'
  detailTable: 'purchasedetails' | 'expensedetails'
  parentFk: 'purchaseId' | 'expenseId'
  stockDirection: 1 | -1
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
  },
  [TransactionKind.EXPENSE]: {
    relationName: 'expense_details',
    parentTable: 'expense',
    detailTable: 'expensedetails',
    parentFk: 'expenseId',
    stockDirection: -1,
  },
}

export const TRANSACTION_TYPE_LABEL = {
  [TransactionKind.PURCHASE]: 'Compra',
  [TransactionKind.EXPENSE]: 'Gasto',
} as const

export function getTransactionConfig(
  kind: TransactionKind,
): TransactionTypeConfig {
  return TRANSACTION_CONFIG[kind]
}
