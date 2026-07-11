import { expect } from '@loopback/testlab'
import {
  buildParentUpdatePayload,
  hasParentMutations,
  toDateOnly,
} from '../../modules/transactions/parent-mutation.utils'

describe('buildParentUpdatePayload()', () => {
  it('strips details, id, version and undefined-valued keys, keeping date', () => {
    const payload = buildParentUpdatePayload<{ date?: string }>({
      id: 5,
      version: 3,
      date: '2026-07-11',
      details: [{ weight_kg: 10, productId: 1, personId: 1 }],
    })
    expect(payload).to.eql({ date: '2026-07-11' })
  })

  it('drops keys whose value is explicitly undefined', () => {
    const payload = buildParentUpdatePayload<{ date?: string }>({
      id: 1,
      version: 1,
      date: undefined,
    })
    expect(payload).to.eql({})
  })
})

/**
 * `date` is declared `unknown` so the same fixture shape can hold a `Date`,
 * an ISO string, or a plain string across all cases below — mirroring how
 * the real payload can arrive as either a `Date` (ORM read) or a string
 * (raw client JSON).
 */
type Parent = { date?: unknown }

describe('hasParentMutations()', () => {
  it('treats the same day expressed as a Date vs an ISO string as a no-op', () => {
    const current: Parent = { date: new Date('2026-07-11T00:00:00.000Z') }
    const incoming: Parent = { date: '2026-07-11T15:30:00.000Z' }
    expect(hasParentMutations(incoming, current)).to.be.false()
  })

  it('detects a different day as a mutation', () => {
    const current: Parent = { date: new Date('2026-07-10T00:00:00.000Z') }
    const incoming: Parent = { date: '2026-07-11' }
    expect(hasParentMutations(incoming, current)).to.be.true()
  })

  it('treats a field absent from the incoming payload as a no-op', () => {
    const current: Parent = { date: '2026-07-11' }
    const incoming: Parent = {}
    expect(hasParentMutations(incoming, current)).to.be.false()
  })

  it('compares a non-date-prefixed string raw (equal case is a no-op)', () => {
    const current: Parent = { date: 'not-a-date' }
    const incoming: Parent = { date: 'not-a-date' }
    expect(hasParentMutations(incoming, current)).to.be.false()
  })

  it('compares a non-date-prefixed string raw (different values mutate)', () => {
    const current: Parent = { date: 'abc' }
    const incoming: Parent = { date: 'xyz' }
    expect(hasParentMutations(incoming, current)).to.be.true()
  })
})

describe('toDateOnly()', () => {
  it('formats a Date as YYYY-MM-DD', () => {
    expect(toDateOnly(new Date('2026-07-11T13:45:00.000Z'))).to.equal(
      '2026-07-11',
    )
  })

  it('truncates an ISO string with a time component to the day', () => {
    expect(toDateOnly('2026-07-11T13:45:00.000Z')).to.equal('2026-07-11')
  })

  it('passes a non-date value through unchanged', () => {
    expect(toDateOnly(42)).to.equal(42)
    expect(toDateOnly(null)).to.equal(null)
    expect(toDateOnly(undefined)).to.equal(undefined)
  })
})
