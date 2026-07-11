import { expect } from '@loopback/testlab'
import { roundWeight } from '../../domain/weight'

describe('roundWeight (unit)', () => {
  it('redondea a 3 decimales', () => {
    expect(roundWeight(1.23456)).to.equal(1.235)
    expect(roundWeight(1.2344)).to.equal(1.234)
  })

  it('deja intactos valores con <= 3 decimales', () => {
    expect(roundWeight(10)).to.equal(10)
    expect(roundWeight(2.5)).to.equal(2.5)
    expect(roundWeight(0.001)).to.equal(0.001)
  })

  it('redondea medios hacia arriba', () => {
    expect(roundWeight(0.0005)).to.equal(0.001)
  })
})
