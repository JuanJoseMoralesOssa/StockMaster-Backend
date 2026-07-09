import { expect } from '@loopback/testlab'
import { computeBalanceDeltas } from '../../modules/transactions/balance-delta.utils'

describe('computeBalanceDeltas', () => {
  it('applies the positive magnitude when the same product gains weight', () => {
    const deltas = computeBalanceDeltas(
      { productId: 1, weight_kg: 10 },
      { productId: 1, weight_kg: 15 },
    )
    expect(deltas).to.eql([{ productId: 1, weightKg: 5, mode: 'apply' }])
  })

  it('undoes the positive magnitude when the same product loses weight', () => {
    const deltas = computeBalanceDeltas(
      { productId: 1, weight_kg: 15 },
      { productId: 1, weight_kg: 10 },
    )
    expect(deltas).to.eql([{ productId: 1, weightKg: 5, mode: 'undo' }])
  })

  it('returns no movements for an exact no-op', () => {
    const deltas = computeBalanceDeltas(
      { productId: 1, weight_kg: 10 },
      { productId: 1, weight_kg: 10 },
    )
    expect(deltas).to.eql([])
  })

  it('treats a sub-milligram change (rounds to 0) as a no-op', () => {
    // 0.0004 kg rounds to 0 at 3-decimal precision → no balance movement.
    const deltas = computeBalanceDeltas(
      { productId: 1, weight_kg: 10 },
      { productId: 1, weight_kg: 10.0004 },
    )
    expect(deltas).to.eql([])
  })

  it('applies a rounding-boundary change just above the threshold', () => {
    // 0.0006 kg rounds up to 0.001 → a real apply.
    const deltas = computeBalanceDeltas(
      { productId: 1, weight_kg: 10 },
      { productId: 1, weight_kg: 10.0006 },
    )
    expect(deltas).to.eql([{ productId: 1, weightKg: 0.001, mode: 'apply' }])
  })

  it('undoes the whole old weight and applies the whole new weight on a product switch', () => {
    const deltas = computeBalanceDeltas(
      { productId: 1, weight_kg: 10 },
      { productId: 2, weight_kg: 20 },
    )
    expect(deltas).to.eql([
      { productId: 1, weightKg: 10, mode: 'undo' },
      { productId: 2, weightKg: 20, mode: 'apply' },
    ])
  })

  it('switches product even when the weight is unchanged', () => {
    const deltas = computeBalanceDeltas(
      { productId: 1, weight_kg: 7.5 },
      { productId: 3, weight_kg: 7.5 },
    )
    expect(deltas).to.eql([
      { productId: 1, weightKg: 7.5, mode: 'undo' },
      { productId: 3, weightKg: 7.5, mode: 'apply' },
    ])
  })
})
