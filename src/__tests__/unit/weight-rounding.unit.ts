import { expect } from '@loopback/testlab'
import { roundWeightKg } from '../../services/transaction.service'

describe('roundWeightKg (unit)', () => {
  it('redondea a 3 decimales', () => {
    expect(roundWeightKg(1.23456)).to.equal(1.235)
    expect(roundWeightKg(1.2344)).to.equal(1.234)
  })

  it('deja intactos valores con <= 3 decimales', () => {
    expect(roundWeightKg(10)).to.equal(10)
    expect(roundWeightKg(2.5)).to.equal(2.5)
    expect(roundWeightKg(0.001)).to.equal(0.001)
  })

  it('redondea medios hacia arriba', () => {
    expect(roundWeightKg(0.0005)).to.equal(0.001)
  })
})
