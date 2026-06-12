import { expect } from '@loopback/testlab'
import { KardexOperation } from '../../models'
import { TransactionKind } from '../../services/transaction-kind.enum'
import {
  getKardexOperation,
  getStockOperator,
} from '../../services/transaction-type.const'

/**
 * Table tests for the sign matrix — the highest-consequence decision in the
 * system. A flipped sign here silently corrupts every stock balance.
 */
describe('getStockOperator()', () => {
  const cases: Array<{
    kind: TransactionKind
    mode: 'apply' | 'undo'
    expected: '+' | '-'
  }> = [
    { kind: TransactionKind.PURCHASE, mode: 'apply', expected: '+' },
    { kind: TransactionKind.PURCHASE, mode: 'undo', expected: '-' },
    { kind: TransactionKind.EXPENSE, mode: 'apply', expected: '-' },
    { kind: TransactionKind.EXPENSE, mode: 'undo', expected: '+' },
  ]

  for (const { kind, mode, expected } of cases) {
    it(`returns '${expected}' for ${kind} ${mode}`, () => {
      expect(getStockOperator(kind, mode)).to.equal(expected)
    })
  }
})

describe('getKardexOperation()', () => {
  const cases: Array<{
    kind: TransactionKind
    mode: 'apply' | 'undo'
    expected: KardexOperation
  }> = [
    {
      kind: TransactionKind.PURCHASE,
      mode: 'apply',
      expected: KardexOperation.PurchaseApply,
    },
    {
      kind: TransactionKind.PURCHASE,
      mode: 'undo',
      expected: KardexOperation.PurchaseUndo,
    },
    {
      kind: TransactionKind.EXPENSE,
      mode: 'apply',
      expected: KardexOperation.ExpenseApply,
    },
    {
      kind: TransactionKind.EXPENSE,
      mode: 'undo',
      expected: KardexOperation.ExpenseUndo,
    },
  ]

  for (const { kind, mode, expected } of cases) {
    it(`maps ${kind} ${mode} to operation ${expected}`, () => {
      expect(getKardexOperation(kind, mode)).to.equal(expected)
    })
  }
})
