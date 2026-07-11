import { expect } from '@loopback/testlab'
import { buildPendingTrend } from '../../repositories/pending-analytics.repository'

/**
 * The running-balance walk behind /analytics/pending-trend. It was previously
 * buried inside the SQL-issuing method and therefore only reachable with a live
 * database; it is the one real decision in that file — the series reports the
 * ABSOLUTE pending at the end of each bucket, carrying forward the balance that
 * already existed BEFORE the requested range.
 */
describe('buildPendingTrend', () => {
  const bucket = (entries: Array<[string, number]>) => new Map(entries)

  it('carries the pre-range baseline into the first point', () => {
    // 40 kg were already owed before the range; the first bucket buys 10 more.
    const points = buildPendingTrend(
      40,
      bucket([['2026-01-01', 10]]),
      bucket([]),
    )

    expect(points).to.eql([
      { period: '2026-01-01', purchased: 10, paid: 0, pending: 50 },
    ])
  })

  it('accumulates purchases and payments across buckets in date order', () => {
    const points = buildPendingTrend(
      0,
      bucket([
        ['2026-01-02', 30],
        ['2026-01-01', 100],
      ]),
      bucket([['2026-01-02', 50]]),
    )

    expect(points).to.eql([
      { period: '2026-01-01', purchased: 100, paid: 0, pending: 100 },
      { period: '2026-01-02', purchased: 30, paid: 50, pending: 80 },
    ])
  })

  it('emits a bucket that only has payments', () => {
    // A period with payments and no purchases must still appear, driving the
    // pending DOWN — dropping it would make the debt look flat.
    const points = buildPendingTrend(
      100,
      bucket([]),
      bucket([['2026-02-01', 25]]),
    )

    expect(points).to.eql([
      { period: '2026-02-01', purchased: 0, paid: 25, pending: 75 },
    ])
  })

  it('can go negative when payments exceed what was bought', () => {
    // Over-delivery is a real state (it means we owe them nothing and then some);
    // clamping it at 0 would hide the discrepancy from the operator.
    const points = buildPendingTrend(0, bucket([]), bucket([['2026-03-01', 5]]))

    expect(points[0].pending).to.equal(-5)
  })

  it('rounds each point to the domain weight precision', () => {
    const points = buildPendingTrend(
      0,
      bucket([['2026-01-01', 0.1234]]),
      bucket([]),
    )

    expect(points[0].purchased).to.equal(0.123)
    expect(points[0].pending).to.equal(0.123)
  })

  it('returns no points when nothing moved in the range', () => {
    expect(buildPendingTrend(99, bucket([]), bucket([]))).to.eql([])
  })
})
