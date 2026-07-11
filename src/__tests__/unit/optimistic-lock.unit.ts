import { expect } from '@loopback/testlab'
import { ValidationError } from '../../errors'
import { requireVersion } from '../../modules/transactions/optimistic-lock.utils'

/** Runs `fn`, returning the thrown error so callers can assert on it. */
function captureThrown(fn: () => void): Error {
  try {
    fn()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected function to throw')
}

describe('requireVersion()', () => {
  // The real guard is `value < 1`, not "must be a whole number": 0.5 is < 1,
  // so it is rejected right alongside undefined/null/NaN/zero/negatives.
  const invalidValues: Array<[label: string, value: number | undefined]> = [
    ['undefined', undefined],
    ['NaN', NaN],
    ['zero', 0],
    ['negative integer', -1],
    ['negative fraction', -0.5],
    ['fraction below 1', 0.5],
  ]

  for (const [label, value] of invalidValues) {
    it(`throws a ValidationError for ${label} (${String(value)})`, () => {
      const err = captureThrown(() => requireVersion(value, 'version'))
      expect(err).to.be.instanceOf(ValidationError)
    })
  }

  it('throws a ValidationError for null (client sends no version)', () => {
    const err = captureThrown(() =>
      requireVersion(null as unknown as number, 'version'),
    )
    expect(err).to.be.instanceOf(ValidationError)
  })

  it('returns the value unchanged for the minimum valid version (1)', () => {
    expect(requireVersion(1, 'version')).to.equal(1)
  })

  it('returns the value unchanged for a larger valid version', () => {
    expect(requireVersion(42, 'version')).to.equal(42)
  })

  it('identifies "version" as the failing parameter in the error message', () => {
    const err = captureThrown(() => requireVersion(undefined, 'version'))
    expect(err.message).to.match(/version/)
    expect(err.message).to.not.match(/parentVersion/)
  })

  it('identifies "parentVersion" as the failing parameter in the error message', () => {
    const err = captureThrown(() => requireVersion(undefined, 'parentVersion'))
    expect(err.message).to.match(/parentVersion/)
  })

  it('produces a validation-kind domain error (maps to 400, not 404/409)', () => {
    const err = captureThrown(() => requireVersion(undefined, 'version'))
    expect((err as ValidationError).kind).to.equal('validation')
  })
})
