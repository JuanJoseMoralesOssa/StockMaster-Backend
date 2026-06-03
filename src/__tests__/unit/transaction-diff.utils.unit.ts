import { expect } from '@loopback/testlab'
import { HttpErrors } from '@loopback/rest'
import { computeDetailsDiff } from '../../services/transaction-diff.utils'

type TestDetail = {
  id?: number
  weight_kg: number
  productId: number
  personId: number
}

describe('computeDetailsDiff (unit)', () => {
  it('detecta detalles nuevos sin id o con id no positivo', () => {
    const existing: TestDetail[] = []
    const incoming: TestDetail[] = [
      { weight_kg: 5, productId: 10, personId: 20 },
      { id: 0, weight_kg: 7, productId: 11, personId: 21 },
    ]

    const diff = computeDetailsDiff(existing, incoming)

    expect(diff.toCreate).to.deepEqual(incoming)
    expect(diff.toUpdate).to.deepEqual([])
    expect(diff.toDelete).to.deepEqual([])
  })

  it('detecta actualizaciones y omite detalles sin cambios', () => {
    const existing: TestDetail[] = [
      { id: 1, weight_kg: 5, productId: 10, personId: 20 },
      { id: 2, weight_kg: 8, productId: 11, personId: 21 },
    ]
    const changed = { id: 1, weight_kg: 6, productId: 10, personId: 20 }
    const unchanged = { id: 2, weight_kg: 8, productId: 11, personId: 21 }

    const diff = computeDetailsDiff(existing, [changed, unchanged])

    expect(diff.toCreate).to.deepEqual([])
    expect(diff.toUpdate).to.deepEqual([{ old: existing[0], new: changed }])
    expect(diff.toDelete).to.deepEqual([])
  })

  it('detecta detalles existentes omitidos como eliminaciones', () => {
    const keep = { id: 1, weight_kg: 5, productId: 10, personId: 20 }
    const remove = { id: 2, weight_kg: 8, productId: 11, personId: 21 }

    const diff = computeDetailsDiff([keep, remove], [keep])

    expect(diff.toCreate).to.deepEqual([])
    expect(diff.toUpdate).to.deepEqual([])
    expect(diff.toDelete).to.deepEqual([remove])
  })

  it('rechaza un id entrante que no pertenece a la transacción', () => {
    const existing: TestDetail[] = [
      { id: 1, weight_kg: 5, productId: 10, personId: 20 },
    ]
    const incoming: TestDetail[] = [
      { id: 999, weight_kg: 6, productId: 10, personId: 20 },
    ]

    expect(() => computeDetailsDiff(existing, incoming)).to.throw(
      HttpErrors.Forbidden,
    )
  })
})
