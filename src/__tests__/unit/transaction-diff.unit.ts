import { expect } from '@loopback/testlab'
import { computeDetailsDiff } from '../../services/transaction-diff.utils'

type Detail = {
  id?: number
  weight_kg: number
  productId: number
  personId: number
}

describe('computeDetailsDiff()', () => {
  it('marks details with no id (or id <= 0) as creates', () => {
    const { toCreate, toUpdate, toDelete } = computeDetailsDiff<Detail>(
      [],
      [
        { weight_kg: 10, productId: 1, personId: 1 },
        { id: 0, weight_kg: 5, productId: 2, personId: 2 },
      ],
    )
    expect(toCreate).have.length(2)
    expect(toUpdate).have.length(0)
    expect(toDelete).have.length(0)
  })

  it('treats an unchanged existing detail as a no-op', () => {
    const existing: Detail[] = [
      { id: 1, weight_kg: 10, productId: 1, personId: 1 },
    ]
    const { toCreate, toUpdate, toDelete } = computeDetailsDiff(existing, [
      { id: 1, weight_kg: 10, productId: 1, personId: 1 },
    ])
    expect(toCreate).have.length(0)
    expect(toUpdate).have.length(0)
    expect(toDelete).have.length(0)
  })

  it('detects a weight change as an update', () => {
    const existing: Detail[] = [
      { id: 1, weight_kg: 10, productId: 1, personId: 1 },
    ]
    const { toUpdate } = computeDetailsDiff(existing, [
      { id: 1, weight_kg: 20, productId: 1, personId: 1 },
    ])
    expect(toUpdate).have.length(1)
    expect(toUpdate[0].old.weight_kg).equal(10)
    expect(toUpdate[0].new.weight_kg).equal(20)
  })

  it('detects a productId change as an update', () => {
    const existing: Detail[] = [
      { id: 1, weight_kg: 5, productId: 1, personId: 1 },
    ]
    const { toUpdate } = computeDetailsDiff(existing, [
      { id: 1, weight_kg: 5, productId: 2, personId: 1 },
    ])
    expect(toUpdate).have.length(1)
    expect(toUpdate[0].old.productId).equal(1)
    expect(toUpdate[0].new.productId).equal(2)
  })

  it('detects a personId change as an update', () => {
    const existing: Detail[] = [
      { id: 1, weight_kg: 5, productId: 1, personId: 1 },
    ]
    const { toUpdate } = computeDetailsDiff(existing, [
      { id: 1, weight_kg: 5, productId: 1, personId: 99 },
    ])
    expect(toUpdate).have.length(1)
  })

  it('marks an omitted existing detail for deletion', () => {
    const existing: Detail[] = [
      { id: 1, weight_kg: 10, productId: 1, personId: 1 },
      { id: 2, weight_kg: 5, productId: 2, personId: 1 },
    ]
    const { toDelete } = computeDetailsDiff(existing, [
      { id: 1, weight_kg: 10, productId: 1, personId: 1 },
    ])
    expect(toDelete).have.length(1)
    expect(toDelete[0].id).equal(2)
  })

  it('handles a mixed create/update/delete in one pass', () => {
    const existing: Detail[] = [
      { id: 1, weight_kg: 5, productId: 1, personId: 1 },
      { id: 2, weight_kg: 10, productId: 2, personId: 1 },
    ]
    const incoming: Detail[] = [
      { id: 1, weight_kg: 5, productId: 1, personId: 1 }, // unchanged → no-op
      { weight_kg: 15, productId: 3, personId: 2 }, // no id → create
      // id:2 omitted → delete
    ]
    const { toCreate, toUpdate, toDelete } = computeDetailsDiff(
      existing,
      incoming,
    )
    expect(toCreate).have.length(1)
    expect(toUpdate).have.length(0)
    expect(toDelete).have.length(1)
    expect(toDelete[0].id).equal(2)
  })

  it('handles deleting all existing details', () => {
    const existing: Detail[] = [
      { id: 1, weight_kg: 5, productId: 1, personId: 1 },
      { id: 2, weight_kg: 8, productId: 2, personId: 2 },
    ]
    const { toCreate, toUpdate, toDelete } = computeDetailsDiff(existing, [])
    expect(toCreate).have.length(0)
    expect(toUpdate).have.length(0)
    expect(toDelete).have.length(2)
  })

  it('throws Forbidden when an incoming id does not belong to the parent', () => {
    const existing: Detail[] = [
      { id: 1, weight_kg: 5, productId: 1, personId: 1 },
    ]
    const incoming: Detail[] = [
      { id: 99, weight_kg: 5, productId: 1, personId: 1 },
    ]
    let threw = false
    try {
      computeDetailsDiff(existing, incoming)
    } catch (err: unknown) {
      threw = true
      const e = err as { statusCode?: number; message?: string }
      expect(e.statusCode).equal(403)
      expect(e.message).match(/99/)
    }
    expect(threw).true()
  })
})
