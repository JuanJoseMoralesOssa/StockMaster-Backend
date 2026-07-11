import { expect } from '@loopback/testlab'
import { USER_MESSAGES, ValidationError } from '../../errors'
import {
  assertDetailValid,
  assertDetailsValid,
} from '../../modules/transactions/detail-validation.utils'

const validDetail = { productId: 1, personId: 1, weight_kg: 10 }

/** Runs `fn`, returning the thrown error so callers can assert on it. */
function captureThrown(fn: () => void): Error {
  try {
    fn()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected function to throw')
}

describe('assertDetailValid()', () => {
  it('throws DETAIL_FIELDS_REQUIRED when productId is missing (undefined)', () => {
    const err = captureThrown(() =>
      assertDetailValid({ ...validDetail, productId: undefined }),
    )
    expect(err).to.be.instanceOf(ValidationError)
    expect(err.message).to.equal(USER_MESSAGES.DETAIL_FIELDS_REQUIRED)
  })

  it('throws DETAIL_FIELDS_REQUIRED when productId is null', () => {
    const err = captureThrown(() =>
      assertDetailValid({
        ...validDetail,
        productId: null as unknown as number,
      }),
    )
    expect(err).to.be.instanceOf(ValidationError)
    expect(err.message).to.equal(USER_MESSAGES.DETAIL_FIELDS_REQUIRED)
  })

  it('throws DETAIL_FIELDS_REQUIRED when personId is missing (undefined)', () => {
    const err = captureThrown(() =>
      assertDetailValid({ ...validDetail, personId: undefined }),
    )
    expect(err).to.be.instanceOf(ValidationError)
    expect(err.message).to.equal(USER_MESSAGES.DETAIL_FIELDS_REQUIRED)
  })

  it('throws DETAIL_FIELDS_REQUIRED when personId is null', () => {
    const err = captureThrown(() =>
      assertDetailValid({
        ...validDetail,
        personId: null as unknown as number,
      }),
    )
    expect(err).to.be.instanceOf(ValidationError)
    expect(err.message).to.equal(USER_MESSAGES.DETAIL_FIELDS_REQUIRED)
  })

  it('throws WEIGHT_POSITIVE when weight_kg is null', () => {
    const err = captureThrown(() =>
      assertDetailValid({
        ...validDetail,
        weight_kg: null as unknown as number,
      }),
    )
    expect(err).to.be.instanceOf(ValidationError)
    expect(err.message).to.equal(USER_MESSAGES.WEIGHT_POSITIVE)
  })

  it('throws WEIGHT_POSITIVE when weight_kg is zero', () => {
    const err = captureThrown(() =>
      assertDetailValid({ ...validDetail, weight_kg: 0 }),
    )
    expect(err).to.be.instanceOf(ValidationError)
    expect(err.message).to.equal(USER_MESSAGES.WEIGHT_POSITIVE)
  })

  it('throws WEIGHT_POSITIVE when weight_kg is negative', () => {
    const err = captureThrown(() =>
      assertDetailValid({ ...validDetail, weight_kg: -5 }),
    )
    expect(err).to.be.instanceOf(ValidationError)
    expect(err.message).to.equal(USER_MESSAGES.WEIGHT_POSITIVE)
  })

  it('does not throw for a well-formed detail', () => {
    expect(() => assertDetailValid(validDetail)).to.not.throw()
  })
})

describe('assertDetailsValid()', () => {
  it('does not throw for an empty array', () => {
    expect(() => assertDetailsValid([])).to.not.throw()
  })

  it('throws when an invalid detail is in the middle of the array', () => {
    const err = captureThrown(() =>
      assertDetailsValid([
        validDetail,
        { ...validDetail, weight_kg: -1 },
        validDetail,
      ]),
    )
    expect(err).to.be.instanceOf(ValidationError)
    expect(err.message).to.equal(USER_MESSAGES.WEIGHT_POSITIVE)
  })
})
