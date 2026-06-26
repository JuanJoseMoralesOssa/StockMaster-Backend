import { expect } from '@loopback/testlab'
import {
  validateDate,
  validateDateRange,
} from '../../services/date-validation.utils'

describe('validateDate', () => {
  it('accepts a well-formed YYYY-MM-DD date in range', () => {
    expect(() => validateDate('2020-05-15')).to.not.throw()
  })

  it('rejects an empty date', () => {
    expect(() => validateDate('')).to.throw()
  })

  it('rejects a calendar-invalid date (Feb 30) caught by the UTC rollover check', () => {
    expect(() => validateDate('2026-02-30')).to.throw()
  })

  it('rejects a year below the 2000 lower bound', () => {
    expect(() => validateDate('1999-12-31')).to.throw()
  })

  it('rejects a year above the current-year upper bound', () => {
    const nextYear = new Date().getUTCFullYear() + 1
    expect(() => validateDate(`${nextYear}-01-01`)).to.throw()
  })
})

describe('validateDateRange', () => {
  it('accepts a valid range', () => {
    expect(() => validateDateRange('2020-01-01', '2020-03-01')).to.not.throw()
  })

  it('accepts start equal to end', () => {
    expect(() => validateDateRange('2020-06-01', '2020-06-01')).to.not.throw()
  })

  it('requires both endpoints', () => {
    expect(() => validateDateRange('', '2020-06-01')).to.throw()
    expect(() => validateDateRange('2020-06-01', '')).to.throw()
  })

  it('rejects a malformed endpoint', () => {
    expect(() => validateDateRange('2020/06/01', '2020-06-02')).to.throw()
  })

  it('rejects start after end', () => {
    expect(() => validateDateRange('2020-05-10', '2020-05-01')).to.throw()
  })

  it('rejects a calendar-invalid endpoint', () => {
    expect(() => validateDateRange('2021-02-29', '2021-03-01')).to.throw()
  })

  it('accepts a range of exactly 365 days', () => {
    // 2020 is a leap year, so Jan 1 → Dec 31 spans exactly 365 days.
    expect(() => validateDateRange('2020-01-01', '2020-12-31')).to.not.throw()
  })

  it('rejects a range exceeding 365 days', () => {
    // 2020-01-01 → 2021-01-01 is 366 days (2020 has 366 days).
    expect(() => validateDateRange('2020-01-01', '2021-01-01')).to.throw()
  })
})
