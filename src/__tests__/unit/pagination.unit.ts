import { expect } from '@loopback/testlab'
import {
  normalizeLimit,
  normalizePagination,
  paginationConfig,
} from '../../config/pagination'

/**
 * Every list endpoint funnels its `page`/`limit` query params through these two
 * functions, so they are the one place that stops a client from asking for
 * `limit=100000` (a table scan serialized to JSON) or a negative `skip` (a SQL
 * error). The clamping and the coercion of junk input to defaults are the whole
 * point of the abstraction; both are pinned here.
 */
describe('normalizeLimit', () => {
  it('falls back to the default limit when none is given', () => {
    expect(normalizeLimit()).to.equal(paginationConfig.DEFAULT_LIMIT)
  })

  it('passes through a limit inside the allowed range', () => {
    expect(normalizeLimit(25)).to.equal(25)
  })

  it('accepts exactly MAX_LIMIT', () => {
    expect(normalizeLimit(paginationConfig.MAX_LIMIT)).to.equal(
      paginationConfig.MAX_LIMIT,
    )
  })

  it('clamps a limit above MAX_LIMIT', () => {
    expect(normalizeLimit(paginationConfig.MAX_LIMIT + 900)).to.equal(
      paginationConfig.MAX_LIMIT,
    )
  })

  it('floors a fractional limit', () => {
    expect(normalizeLimit(10.9)).to.equal(10)
  })

  it('falls back to the default for zero and negative limits', () => {
    expect(normalizeLimit(0)).to.equal(paginationConfig.DEFAULT_LIMIT)
    expect(normalizeLimit(-5)).to.equal(paginationConfig.DEFAULT_LIMIT)
  })

  it('falls back to the default for non-finite limits', () => {
    // `?limit=abc` reaches the controller as NaN; Infinity would otherwise slip
    // past a naive `> 0` check and ask the DB for every row.
    expect(normalizeLimit(NaN)).to.equal(paginationConfig.DEFAULT_LIMIT)
    expect(normalizeLimit(Infinity)).to.equal(paginationConfig.DEFAULT_LIMIT)
  })
})

describe('normalizePagination', () => {
  it('defaults to the first page with the default limit and no skip', () => {
    expect(normalizePagination()).to.eql({
      page: paginationConfig.DEFAULT_PAGE,
      limit: paginationConfig.DEFAULT_LIMIT,
      skip: 0,
    })
  })

  it('derives skip from the (1-based) page and the limit', () => {
    expect(normalizePagination(3, 20)).to.eql({ page: 3, limit: 20, skip: 40 })
  })

  it('falls back to the first page for zero, negative and non-finite pages', () => {
    // A page of 0 or -1 would otherwise produce a negative skip and a SQL error.
    expect(normalizePagination(0, 10).skip).to.equal(0)
    expect(normalizePagination(-2, 10).skip).to.equal(0)
    expect(normalizePagination(NaN, 10).page).to.equal(
      paginationConfig.DEFAULT_PAGE,
    )
  })

  it('floors a fractional page', () => {
    expect(normalizePagination(2.7, 10)).to.eql({
      page: 2,
      limit: 10,
      skip: 10,
    })
  })

  it('computes skip from the CLAMPED limit, not the requested one', () => {
    // Skipping by the raw limit would jump 500 rows ahead while returning 100 —
    // the page-2 window would silently miss 400 rows.
    const pagination = normalizePagination(2, 500)
    expect(pagination.limit).to.equal(paginationConfig.MAX_LIMIT)
    expect(pagination.skip).to.equal(paginationConfig.MAX_LIMIT)
  })
})
