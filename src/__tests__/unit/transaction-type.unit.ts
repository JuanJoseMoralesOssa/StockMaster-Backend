import { expect } from '@loopback/testlab'
import { KardexOperation } from '../../models'
import { TransactionKind } from '../../services/transaction-kind.enum'
import {
  getKardexOperation,
  getBalanceOperator,
} from '../../services/transaction-type.const'

/**
 * Table tests for the sign matrix — the highest-consequence decision in the
 * system. A flipped sign here silently corrupts every balance balance.
 */
describe('getBalanceOperator()', () => {
  const cases: Array<{
    kind: TransactionKind
    mode: 'apply' | 'undo'
    expected: '+' | '-'
  }> = [
    { kind: TransactionKind.PURCHASE, mode: 'apply', expected: '+' },
    { kind: TransactionKind.PURCHASE, mode: 'undo', expected: '-' },
    { kind: TransactionKind.PAYMENT, mode: 'apply', expected: '-' },
    { kind: TransactionKind.PAYMENT, mode: 'undo', expected: '+' },
  ]

  for (const { kind, mode, expected } of cases) {
    it(`returns '${expected}' for ${kind} ${mode}`, () => {
      expect(getBalanceOperator(kind, mode)).to.equal(expected)
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
      kind: TransactionKind.PAYMENT,
      mode: 'apply',
      expected: KardexOperation.PaymentApply,
    },
    {
      kind: TransactionKind.PAYMENT,
      mode: 'undo',
      expected: KardexOperation.PaymentUndo,
    },
  ]

  for (const { kind, mode, expected } of cases) {
    it(`maps ${kind} ${mode} to operation ${expected}`, () => {
      expect(getKardexOperation(kind, mode)).to.equal(expected)
    })
  }
})
