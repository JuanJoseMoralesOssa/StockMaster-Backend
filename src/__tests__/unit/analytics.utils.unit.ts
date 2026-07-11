import { expect } from '@loopback/testlab'
import { toFiniteNumber, toIsoDate } from '../../domain/coercion'
import { TransactionKind } from '../../modules/transactions/transaction-kind.enum'
import {
  accumulateEntity,
  EntityAggregate,
  summarizeInventory,
  topByTransactionCount,
  topByWeight,
} from '../../services/analytics.utils'

describe('toFiniteNumber', () => {
  it('passes numbers through', () => {
    expect(toFiniteNumber(12.5)).to.equal(12.5)
  })

  it('parses a numeric string (an unparsed Postgres NUMERIC column)', () => {
    expect(toFiniteNumber('12.5')).to.equal(12.5)
  })

  it('collapses null, undefined and junk to 0 instead of NaN', () => {
    // A NaN entering a running sum blanks the ENTIRE dashboard figure, not just
    // the offending row — degrade one line to 0 rather than lose the report.
    expect(toFiniteNumber(null)).to.equal(0)
    expect(toFiniteNumber(undefined)).to.equal(0)
    expect(toFiniteNumber('abc')).to.equal(0)
    expect(toFiniteNumber({})).to.equal(0)
  })

  it('collapses Infinity to 0', () => {
    expect(toFiniteNumber(Infinity)).to.equal(0)
  })
})

describe('toIsoDate', () => {
  it('renders a Date as a calendar day', () => {
    expect(toIsoDate(new Date('2026-03-04T22:15:00Z'))).to.equal('2026-03-04')
  })

  it('truncates a timestamp string to its date part', () => {
    expect(toIsoDate('2026-03-04T22:15:00.000Z')).to.equal('2026-03-04')
  })

  it('returns null for a missing value', () => {
    expect(toIsoDate(null)).to.be.null()
    expect(toIsoDate(undefined)).to.be.null()
  })
})

describe('accumulateEntity', () => {
  const purchase = TransactionKind.PURCHASE
  const payment = TransactionKind.PAYMENT

  it('seeds a purchase line on the purchase side only', () => {
    const aggregates = new Map<number, EntityAggregate>()

    accumulateEntity(
      aggregates,
      { id: 1, name: 'Ana' },
      10,
      purchase,
      'Proveedor',
    )

    expect(aggregates.get(1)).to.eql({
      id: 1,
      name: 'Ana',
      purchaseWeight: 10,
      paymentWeight: 0,
      purchaseCount: 1,
      paymentCount: 0,
    })
  })

  it('seeds a payment line on the payment side only', () => {
    const aggregates = new Map<number, EntityAggregate>()

    accumulateEntity(
      aggregates,
      { id: 1, name: 'Ana' },
      10,
      payment,
      'Proveedor',
    )

    expect(aggregates.get(1)).to.eql({
      id: 1,
      name: 'Ana',
      purchaseWeight: 0,
      paymentWeight: 10,
      purchaseCount: 0,
      paymentCount: 1,
    })
  })

  it('keeps compra and pago apart when both hit the same entity', () => {
    // The whole reason the sides are separate: mixing an entrada with a salida
    // into one number would report 30 kg "moved" as if it were 30 kg bought.
    const aggregates = new Map<number, EntityAggregate>()

    accumulateEntity(
      aggregates,
      { id: 1, name: 'Ana' },
      20,
      purchase,
      'Proveedor',
    )
    accumulateEntity(
      aggregates,
      { id: 1, name: 'Ana' },
      10,
      payment,
      'Proveedor',
    )

    expect(aggregates.get(1)).to.eql({
      id: 1,
      name: 'Ana',
      purchaseWeight: 20,
      paymentWeight: 10,
      purchaseCount: 1,
      paymentCount: 1,
    })
  })

  it('accumulates repeated lines for the same entity and side', () => {
    const aggregates = new Map<number, EntityAggregate>()

    accumulateEntity(aggregates, { id: 2 }, 5, purchase, 'Producto')
    accumulateEntity(aggregates, { id: 2 }, 7, purchase, 'Producto')

    expect(aggregates.get(2)).to.containEql({
      purchaseWeight: 12,
      purchaseCount: 2,
    })
  })

  it('labels an unnamed entity with its fallback label and id', () => {
    const aggregates = new Map<number, EntityAggregate>()

    accumulateEntity(aggregates, { id: 9 }, 1, purchase, 'Producto')

    expect(aggregates.get(9)?.name).to.equal('Producto 9')
  })

  it('skips a line whose related entity did not resolve', () => {
    // An unattributable line must not invent a bucket: that would inflate
    // totalSuppliers/totalProducts with a phantom entity.
    const aggregates = new Map<number, EntityAggregate>()

    accumulateEntity(aggregates, undefined, 10, purchase, 'Proveedor')
    accumulateEntity(aggregates, { name: 'sin id' }, 10, purchase, 'Proveedor')

    expect(aggregates.size).to.equal(0)
  })
})

describe('topByWeight', () => {
  const rows = [
    { id: 1, totalWeight: 5 },
    { id: 2, totalWeight: 30 },
    { id: 3, totalWeight: 12 },
  ]

  it('ranks heaviest-first in max mode', () => {
    expect(topByWeight(rows, 'max', 2).map(r => r.id)).to.eql([2, 3])
  })

  it('ranks lightest-first in min mode', () => {
    expect(topByWeight(rows, 'min', 2).map(r => r.id)).to.eql([1, 3])
  })

  it('does not mutate the caller array (both rankings read the same source)', () => {
    topByWeight(rows, 'max', 3)
    expect(rows.map(r => r.id)).to.eql([1, 2, 3])
  })

  it('returns everything when the limit exceeds the row count', () => {
    expect(topByWeight(rows, 'max', 99)).to.have.length(3)
  })

  it('returns an empty list for no rows', () => {
    expect(topByWeight([], 'max', 5)).to.eql([])
  })
})

describe('topByTransactionCount', () => {
  it('ranks busiest-first', () => {
    const rows = [
      { id: 1, transactionCount: 2 },
      { id: 2, transactionCount: 9 },
      { id: 3, transactionCount: 4 },
    ]

    expect(topByTransactionCount(rows, 2).map(r => r.id)).to.eql([2, 3])
  })

  it('drops entities with no transactions rather than listing them with 0', () => {
    const rows = [
      { id: 1, transactionCount: 0 },
      { id: 2, transactionCount: 3 },
    ]

    expect(topByTransactionCount(rows, 5).map(r => r.id)).to.eql([2])
  })

  it('returns an empty list for no rows', () => {
    expect(topByTransactionCount([], 5)).to.eql([])
  })
})

describe('summarizeInventory', () => {
  it('disables the low-balance list when the threshold is non-finite', () => {
    // Non-finite (NaN/Infinity) means "no threshold supplied" — the feature
    // turns off rather than letting an unparseable value leak through.
    const products = [{ id: 1, name: 'Sal', balance: 5 }]

    const result = summarizeInventory(products, NaN)

    expect(result.lowBalanceThreshold).to.equal(0)
    expect(result.lowBalanceProducts).to.eql([])
    expect(result.lowBalanceCount).to.equal(0)
  })

  it('disables the low-balance list when the threshold is zero or negative', () => {
    const products = [{ id: 1, name: 'Sal', balance: 5 }]

    expect(summarizeInventory(products, 0).lowBalanceProducts).to.eql([])
    expect(summarizeInventory(products, -3).lowBalanceProducts).to.eql([])
  })

  it('counts a zero or negative balance as out-of-balance', () => {
    const products = [
      { id: 1, name: 'Cero', balance: 0 },
      { id: 2, name: 'Negativo', balance: -2 },
    ]

    const result = summarizeInventory(products, 10)

    expect(result.outOfBalanceCount).to.equal(2)
    expect(result.inBalanceCount).to.equal(0)
    expect(result.lowBalanceProducts).to.eql([])
  })

  it('lists a positive balance at or under the threshold, ascending', () => {
    const products = [
      { id: 1, name: 'Alto', balance: 9 },
      { id: 2, name: 'Bajo', balance: 1 },
      { id: 3, name: 'Medio', balance: 5 },
      // Above the threshold: in balance, but not "low".
      { id: 4, name: 'Fuera de rango', balance: 20 },
    ]

    const result = summarizeInventory(products, 10)

    expect(result.lowBalanceProducts.map(p => p.productName)).to.eql([
      'Bajo',
      'Medio',
      'Alto',
    ])
    expect(result.lowBalanceCount).to.equal(3)
    expect(result.inBalanceCount).to.equal(4)
  })

  it('treats a missing or null balance as 0', () => {
    const products = [
      { id: 1, name: 'Sin balance' },
      { id: 2, name: 'Balance null', balance: null as unknown as number },
    ]

    const result = summarizeInventory(products, 10)

    expect(result.totalBalance).to.equal(0)
    expect(result.outOfBalanceCount).to.equal(2)
  })

  it('sums every balance into totalBalance regardless of bucket', () => {
    const products = [
      { id: 1, name: 'A', balance: 3 },
      { id: 2, name: 'B', balance: -1 },
      { id: 3, name: 'C', balance: 50 },
    ]

    expect(summarizeInventory(products, 10).totalBalance).to.equal(52)
  })

  it('falls back a missing productId to 0, preserving current behavior', () => {
    const products = [{ name: 'Sin id', balance: 4 }]

    const result = summarizeInventory(products, 10)

    expect(result.lowBalanceProducts[0].productId).to.equal(0)
  })
})
