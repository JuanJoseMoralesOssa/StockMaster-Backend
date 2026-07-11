import { expect } from '@loopback/testlab'
import {
  mapPaymentDetailsToRows,
  mapPurchaseDetailsToRows,
  mergeTransactionRowsByDate,
} from '../../modules/transactions/transaction-detail-mapping.utils'

describe('mapPurchaseDetailsToRows()', () => {
  it('skips a detail whose purchase relation was not loaded', () => {
    const rows = mapPurchaseDetailsToRows(
      [{ weight_kg: 10, productId: 1 }],
      detail => ({ productId: detail.productId }),
    )
    expect(rows).to.have.length(0)
  })

  it('skips a detail with weight_kg 0', () => {
    const rows = mapPurchaseDetailsToRows(
      [{ weight_kg: 0, purchase: { date: '2026-01-01' }, productId: 1 }],
      detail => ({ productId: detail.productId }),
    )
    expect(rows).to.have.length(0)
  })

  it('skips a detail with weight_kg undefined', () => {
    const rows = mapPurchaseDetailsToRows(
      [
        {
          weight_kg: undefined as unknown as number,
          purchase: { date: '2026-01-01' },
          productId: 1,
        },
      ],
      detail => ({ productId: detail.productId }),
    )
    expect(rows).to.have.length(0)
  })

  it('maps a valid detail to a row labeled as a purchase', () => {
    const rows = mapPurchaseDetailsToRows(
      [{ weight_kg: 5, purchase: { date: '2026-01-05' }, productId: 2 }],
      detail => ({ productId: detail.productId }),
    )
    expect(rows).to.eql([
      { date: '2026-01-05', weight_kg: 5, type: 'Compra', productId: 2 },
    ])
  })
})

describe('mapPaymentDetailsToRows()', () => {
  it('skips a detail whose payment relation was not loaded', () => {
    const rows = mapPaymentDetailsToRows(
      [{ weight_kg: 10, productId: 1 }],
      detail => ({ productId: detail.productId }),
    )
    expect(rows).to.have.length(0)
  })

  it('skips a detail with weight_kg 0', () => {
    const rows = mapPaymentDetailsToRows(
      [{ weight_kg: 0, payment: { date: '2026-01-01' }, productId: 1 }],
      detail => ({ productId: detail.productId }),
    )
    expect(rows).to.have.length(0)
  })

  it('maps a valid detail to a row labeled as a payment', () => {
    const rows = mapPaymentDetailsToRows(
      [{ weight_kg: 8, payment: { date: '2026-02-10' }, productId: 3 }],
      detail => ({ productId: detail.productId }),
    )
    expect(rows).to.eql([
      { date: '2026-02-10', weight_kg: 8, type: 'Pago', productId: 3 },
    ])
  })
})

describe('mergeTransactionRowsByDate()', () => {
  it('merges purchase and payment rows sorted ascending by date', () => {
    const purchaseRows = mapPurchaseDetailsToRows(
      [{ weight_kg: 10, purchase: { date: '2026-03-15' }, productId: 1 }],
      detail => ({ productId: detail.productId }),
    )
    const paymentRows = mapPaymentDetailsToRows(
      [{ weight_kg: 4, payment: { date: '2026-01-20' }, productId: 1 }],
      detail => ({ productId: detail.productId }),
    )

    const merged = mergeTransactionRowsByDate(purchaseRows, paymentRows)

    expect(merged.map(row => row.date)).to.eql(['2026-01-20', '2026-03-15'])
    expect(merged.map(row => row.type)).to.eql(['Pago', 'Compra'])
  })

  it('returns an empty report when both sides are empty', () => {
    expect(mergeTransactionRowsByDate([], [])).to.eql([])
  })
})
